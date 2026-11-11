import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, UserRole } from '@prisma/client';
import { decodeDataUrl } from '../common/data-url';
import { notify } from '../common/notify';
import { PrismaService } from '../prisma/prisma.service';
import { type Actor, drivesTruck } from './booking-access';
import { UploadBookingDocumentDto } from './dto/upload-booking-document.dto';

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_BYTES = 5 * 1024 * 1024;
const KIND_LABEL: Record<string, string> = {
  CARGO: 'cargo',
  TAX: 'tax',
  OTHER: 'supporting',
};

/**
 * Cargo and tax documents for a booking. The importer uploads them after paying the deposit and
 * before the trip starts (the trip cannot start without a cargo and a tax document). The owner,
 * the truck's driver and administrators can read them.
 */
@Injectable()
export class BookingDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async booking(actor: Actor, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        importerId: true,
        truckId: true,
        truck: { select: { ownerId: true } },
        payment: { select: { status: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    const allowed =
      actor.role === UserRole.ADMIN ||
      booking.importerId === actor.id ||
      booking.truck.ownerId === actor.id ||
      (await drivesTruck(this.prisma, actor, booking.truckId));
    if (!allowed)
      throw new ForbiddenException('You cannot access this booking.');
    return booking;
  }

  async list(actor: Actor, bookingId: string) {
    await this.booking(actor, bookingId);
    return this.prisma.bookingDocument.findMany({
      where: { bookingId },
      omit: { dataUrl: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async file(actor: Actor, bookingId: string, documentId: string) {
    await this.booking(actor, bookingId);
    const document = await this.prisma.bookingDocument.findFirst({
      where: { id: documentId, bookingId },
    });
    const decoded = decodeDataUrl(document?.dataUrl);
    if (!document || !decoded)
      throw new NotFoundException('Document not found.');
    return { ...decoded, name: document.name };
  }

  async upload(actor: Actor, bookingId: string, dto: UploadBookingDocumentDto) {
    const booking = await this.booking(actor, bookingId);
    if (booking.importerId !== actor.id) {
      throw new ForbiddenException(
        'Only the importer who made this booking can upload its documents.',
      );
    }
    if (booking.payment?.status !== 'FUNDED') {
      throw new BadRequestException(
        'Upload the cargo and tax documents after paying the 50% deposit.',
      );
    }
    if (booking.status !== BookingStatus.ACCEPTED) {
      throw new BadRequestException(
        'Documents are added after the deposit and before the trip starts.',
      );
    }
    const decoded = decodeDataUrl(dto.dataUrl);
    if (!decoded || !ALLOWED_TYPES.has(decoded.contentType)) {
      throw new BadRequestException('Upload a PDF, JPG, PNG or WebP file.');
    }
    if (decoded.body.length > MAX_BYTES) {
      throw new BadRequestException('Each document must be 5 MB or smaller.');
    }
    const created = await this.prisma.bookingDocument.create({
      data: {
        bookingId,
        uploadedById: actor.id,
        kind: dto.kind,
        name: dto.name.trim(),
        mimeType: decoded.contentType,
        sizeBytes: decoded.body.length,
        dataUrl: dto.dataUrl,
      },
      omit: { dataUrl: true },
    });

    const kinds = await this.prisma.bookingDocument.findMany({
      where: { bookingId },
      select: { kind: true },
      distinct: ['kind'],
    });
    const ready = ['CARGO', 'TAX'].every((kind) =>
      kinds.some((row) => row.kind === kind),
    );
    const drivers = await this.prisma.operationsRecord.findMany({
      where: {
        domain: 'drivers',
        data: { path: ['assignedTruckId'], equals: booking.truckId },
      },
      select: { data: true },
    });
    const driverIds = drivers.flatMap((record) => {
      const data = record.data as { userId?: unknown };
      return typeof data.userId === 'string' ? [data.userId] : [];
    });
    const body = ready
      ? `The importer uploaded the cargo and tax documents for booking ${bookingId}. The trip can start.`
      : `The importer uploaded "${created.name}" (${KIND_LABEL[dto.kind]} document) for booking ${bookingId}.`;
    await notify(this.prisma, [
      {
        userId: booking.importerId,
        category: 'BOOKING',
        title: ready
          ? 'Cargo and tax documents uploaded'
          : 'Booking document uploaded',
        body: ready
          ? `Your cargo and tax documents are uploaded. The owner or driver can now start the trip.`
          : `Your "${created.name}" document was uploaded successfully.`,
        href: `/dashboard/importer/bookings/${bookingId}`,
        searchText: bookingId,
      },
      {
        userId: booking.truck.ownerId,
        category: 'BOOKING',
        title: ready
          ? 'Cargo and tax documents ready: the trip can start'
          : `New ${KIND_LABEL[dto.kind]} document for a booking`,
        body,
        href: `/dashboard/owner/bookings/${bookingId}`,
        searchText: bookingId,
      },
      ...driverIds.map((userId) => ({
        userId,
        category: 'BOOKING',
        title: ready
          ? 'Cargo documents ready for your trip'
          : 'New booking document',
        body: ready
          ? `The cargo and tax documents for booking ${bookingId} are ready.`
          : `The importer uploaded "${created.name}" (${KIND_LABEL[dto.kind]} document) for booking ${bookingId}.`,
        href: `/dashboard/driver`,
        searchText: bookingId,
      })),
    ]);
    return created;
  }

  async remove(actor: Actor, bookingId: string, documentId: string) {
    const booking = await this.booking(actor, bookingId);
    if (booking.importerId !== actor.id) {
      throw new ForbiddenException('Only the importer can remove documents.');
    }
    if (booking.status !== BookingStatus.ACCEPTED) {
      throw new BadRequestException(
        'Documents can no longer be changed once the trip has started.',
      );
    }
    const document = await this.prisma.bookingDocument.findFirst({
      where: { id: documentId, bookingId },
      select: { name: true, kind: true },
    });
    if (!document) throw new NotFoundException('Document not found.');
    await this.prisma.bookingDocument.delete({ where: { id: documentId } });
    const drivers = await this.prisma.operationsRecord.findMany({
      where: {
        domain: 'drivers',
        data: { path: ['assignedTruckId'], equals: booking.truckId },
      },
      select: { data: true },
    });
    const driverIds = drivers.flatMap((record) => {
      const data = record.data as { userId?: unknown };
      return typeof data.userId === 'string' ? [data.userId] : [];
    });
    await notify(this.prisma, [
      {
        userId: booking.importerId,
        category: 'BOOKING',
        title: 'Booking document removed',
        body: `You removed "${document.name}" from booking ${bookingId}.`,
        href: `/dashboard/importer/bookings/${bookingId}`,
        searchText: bookingId,
      },
      {
        userId: booking.truck.ownerId,
        category: 'BOOKING',
        title: 'Booking document removed',
        body: `The importer removed "${document.name}" from booking ${bookingId}.`,
        href: `/dashboard/owner/bookings/${bookingId}`,
        searchText: bookingId,
      },
      ...driverIds.map((userId) => ({
        userId,
        category: 'BOOKING',
        title: 'Booking document removed',
        body: `The importer removed "${document.name}" from booking ${bookingId}.`,
        href: `/dashboard/driver`,
        searchText: bookingId,
      })),
    ]);
    return { removed: true };
  }
}
