import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, TruckStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

type Actor = { id: string; role: UserRole };
const BOOKING_INCLUDE = {
  truck: {
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          location: true,
        },
      },
    },
  },
  importer: {
    select: { id: true, name: true, email: true, phone: true, location: true },
  },
} satisfies Prisma.BookingInclude;

@Injectable()
export class BookingsService {
  constructor(private prisma: PrismaService) {}

  async create(actor: Actor, dto: CreateBookingDto) {
    if (actor.role !== UserRole.IMPORTER)
      throw new ForbiddenException('Only importers can create bookings.');
    const pickupDate = new Date(dto.pickupDate);
    const expectedDeliveryDate = new Date(dto.expectedDeliveryDate);
    if (expectedDeliveryDate < pickupDate)
      throw new BadRequestException('Expected delivery must be after pickup.');

    const truck = await this.prisma.truck.findUnique({
      where: { id: dto.truckId },
    });
    if (!truck) throw new NotFoundException('Truck not found.');
    if (truck.status !== TruckStatus.AVAILABLE)
      throw new BadRequestException('This truck is not available to book.');
    if (dto.cargoWeight > truck.capacity)
      throw new BadRequestException(
        'Cargo weight exceeds this truck capacity.',
      );

    // One atomic statement claims the truck and inserts the booking. It does
    // not need an interactive transaction, which Neon poolers can drop.
    const created = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH claimed_truck AS (
        UPDATE "Truck"
        SET "status" = CAST(${TruckStatus.UNAVAILABLE} AS "TruckStatus")
        WHERE "id" = ${truck.id}
          AND "status" = CAST(${TruckStatus.AVAILABLE} AS "TruckStatus")
        RETURNING "id"
      )
      INSERT INTO "Booking" (
        "truckId", "importerId", "cargoType", "cargoDescription",
        "cargoWeight", "pickupLocation", "destination", "pickupDate",
        "expectedDeliveryDate", "additionalInstructions"
      )
      SELECT
        "id", ${actor.id}, ${dto.cargoType}, ${dto.cargoDescription ?? null},
        ${dto.cargoWeight}, ${dto.pickupLocation}, ${dto.destination}, ${pickupDate},
        ${expectedDeliveryDate}, ${dto.additionalInstructions ?? null}
      FROM claimed_truck
      RETURNING "id"
    `;
    if (created.length !== 1) {
      throw new BadRequestException(
        'This truck was just booked by another importer.',
      );
    }
    return this.prisma.booking.findUniqueOrThrow({
      where: { id: created[0].id },
      include: BOOKING_INCLUDE,
    });
  }

  findAll(actor: Actor) {
    const where: Prisma.BookingWhereInput =
      actor.role === UserRole.ADMIN
        ? {}
        : actor.role === UserRole.IMPORTER
          ? { importerId: actor.id }
          : { truck: { ownerId: actor.id } };
    return this.prisma.booking.findMany({
      where,
      include: BOOKING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(actor: Actor, id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    this.assertCanView(actor, booking);
    return booking;
  }

  async update(actor: Actor, id: string, dto: UpdateBookingDto) {
    if (!dto.status && dto.agreedPrice === undefined)
      throw new BadRequestException('Provide a status or agreed price.');
    const booking = await this.findOne(actor, id);
    const isOwner = booking.truck.ownerId === actor.id;
    const isImporter = booking.importerId === actor.id;
    if (
      dto.agreedPrice !== undefined &&
      (!isOwner || booking.status !== BookingStatus.PENDING)
    ) {
      throw new ForbiddenException(
        'Only the truck owner can set the price on a pending booking.',
      );
    }
    if (dto.status)
      this.assertStatusChange(
        actor,
        booking.status,
        dto.status,
        isOwner,
        isImporter,
        booking.agreedPrice,
        dto.agreedPrice,
      );

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        ...(dto.agreedPrice !== undefined
          ? { agreedPrice: dto.agreedPrice.trim() }
          : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
      include: BOOKING_INCLUDE,
    });
    if (
      dto.status === BookingStatus.REJECTED ||
      dto.status === BookingStatus.COMPLETED
    ) {
      await this.prisma.truck.update({
        where: { id: booking.truckId },
        data: { status: TruckStatus.AVAILABLE },
      });
    }
    return updated;
  }

  private assertCanView(
    actor: Actor,
    booking: { importerId: string; truck: { ownerId: string } },
  ) {
    if (
      actor.role !== UserRole.ADMIN &&
      booking.importerId !== actor.id &&
      booking.truck.ownerId !== actor.id
    ) {
      throw new ForbiddenException('You cannot access this booking.');
    }
  }

  private assertStatusChange(
    actor: Actor,
    current: BookingStatus,
    next: BookingStatus,
    isOwner: boolean,
    isImporter: boolean,
    agreedPrice: string,
    nextPrice?: string,
  ) {
    if (actor.role === UserRole.ADMIN) return;
    const ownerTransitions: Partial<Record<BookingStatus, BookingStatus[]>> = {
      PENDING: [BookingStatus.ACCEPTED, BookingStatus.REJECTED],
      ACCEPTED: [BookingStatus.IN_PROGRESS],
      IN_PROGRESS: [BookingStatus.DELIVERED],
    };
    const allowed = isOwner
      ? ownerTransitions[current]
      : isImporter && current === BookingStatus.DELIVERED
        ? [BookingStatus.COMPLETED]
        : [];
    if (!allowed?.includes(next))
      throw new ForbiddenException(
        'That booking status change is not allowed.',
      );
    if (next === BookingStatus.ACCEPTED && !(nextPrice ?? agreedPrice).trim())
      throw new BadRequestException(
        'Agree a price before accepting this booking.',
      );
  }
}
