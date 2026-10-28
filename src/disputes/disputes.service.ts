import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, DisputeStatus, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';

type Actor = { id: string; role: UserRole };
const INCLUDE = {
  booking: { include: { truck: { omit: { photos: true } } } },
} satisfies Prisma.DisputeInclude;

@Injectable()
export class DisputesService {
  constructor(private prisma: PrismaService) {}

  async create(actor: Actor, dto: CreateDisputeDto) {
    if (actor.role !== UserRole.IMPORTER) {
      throw new ForbiddenException(
        'Only importers can report a booking problem.',
      );
    }
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: { truck: { select: { ownerId: true, plateNumber: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.importerId !== actor.id)
      throw new ForbiddenException(
        'You cannot report a problem on this booking.',
      );
    if (booking.status !== BookingStatus.DELIVERED) {
      throw new BadRequestException(
        'A problem can be reported after the truck marks delivery.',
      );
    }
    const dispute = await this.prisma.dispute.create({
      data: {
        bookingId: booking.id,
        raisedBy: actor.id,
        reason: dto.reason.trim(),
      },
      include: INCLUDE,
    });
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.DISPUTED },
    });
    await this.notifyReported(booking, dispute.reason);
    return dispute;
  }

  /** Tells every administrator (who decides it) and the truck owner that a problem was reported. */
  private async notifyReported(
    booking: {
      id: string;
      pickupLocation: string;
      destination: string;
      truck: { ownerId: string; plateNumber: string };
    },
    reason: string,
  ) {
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN, active: true },
      select: { id: true },
    });
    const route = `${booking.pickupLocation} to ${booking.destination}`;
    const createdAt = new Date().toISOString();
    const notices = [
      ...admins.map((admin) => ({
        userId: admin.id,
        title: 'Importer reported a problem',
        body: `${route} (${booking.truck.plateNumber}): "${reason}". The payment stays in escrow until you settle the dispute.`,
        href: `/dashboard/admin/bookings/${booking.id}`,
      })),
      {
        userId: booking.truck.ownerId,
        title: 'Importer reported a problem',
        body: `The importer reported a problem with ${route}: "${reason}". An administrator will decide the dispute.`,
        href: `/dashboard/owner/bookings/${booking.id}`,
      },
    ];
    await this.prisma.operationsRecord.createMany({
      data: notices.map(({ userId, title, body, href }) => {
        const id = randomUUID();
        return {
          domain: 'notifications',
          recordId: id,
          ownerId: userId,
          searchText: `${title} ${body}`,
          data: {
            id,
            userId,
            category: 'DISPUTE',
            title,
            body,
            href,
            read: false,
            createdAt,
          },
        };
      }),
    });
  }

  findAll(actor: Actor) {
    const where: Prisma.DisputeWhereInput =
      actor.role === UserRole.ADMIN
        ? {}
        : {
            OR: [
              { raisedBy: actor.id },
              { booking: { truck: { ownerId: actor.id } } },
            ],
          };
    return this.prisma.dispute.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolve(actor: Actor, id: string, resolutionNotes: string) {
    if (actor.role !== UserRole.ADMIN)
      throw new ForbiddenException('Only admins can resolve disputes.');
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!dispute) throw new NotFoundException('Dispute not found.');
    if (dispute.status === DisputeStatus.RESOLVED)
      throw new BadRequestException('This dispute is already resolved.');
    return this.prisma.dispute.update({
      where: { id },
      data: {
        status: DisputeStatus.RESOLVED,
        resolutionNotes: resolutionNotes.trim(),
        resolvedAt: new Date(),
      },
      include: INCLUDE,
    });
  }
}
