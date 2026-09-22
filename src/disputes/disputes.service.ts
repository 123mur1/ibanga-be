import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  DisputeStatus,
  Prisma,
  TruckStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';

type Actor = { id: string; role: UserRole };
const INCLUDE = {
  booking: { include: { truck: true } },
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
    return dispute;
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
    await this.prisma.booking.update({
      where: { id: dispute.bookingId },
      data: { status: BookingStatus.COMPLETED },
    });
    await this.prisma.truck.update({
      where: { id: dispute.booking.truckId },
      data: { status: TruckStatus.AVAILABLE },
    });
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
