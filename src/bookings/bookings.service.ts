import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BookingStatus, Prisma, TruckStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { UpdateTrackingLocationDto } from './dto/update-tracking-location.dto';

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
  payment: true,
  dispute: true,
} satisfies Prisma.BookingInclude;

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
  ) {}

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
    if (truck.priceRwf === null) {
      throw new BadRequestException(
        'This truck has no price and cannot be booked. Ask the owner to update its RWF price.',
      );
    }
    if (dto.cargoWeight > truck.capacity)
      throw new BadRequestException(
        'Cargo weight exceeds this truck capacity.',
      );

    // One atomic statement claims the truck and inserts the booking. It does
    // not need an interactive transaction, which Neon poolers can drop.
    const bookingId = randomUUID();
    const created = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH claimed_truck AS (
        UPDATE "Truck"
        SET "status" = CAST(${TruckStatus.UNAVAILABLE} AS "TruckStatus")
        WHERE "id" = ${truck.id}
          AND "status" = CAST(${TruckStatus.AVAILABLE} AS "TruckStatus")
        RETURNING "id"
      )
      INSERT INTO "Booking" (
        "id", "truckId", "importerId", "cargoType", "cargoDescription",
        "cargoWeight", "pickupLocation", "destination", "pickupDate",
        "expectedDeliveryDate", "additionalInstructions", "agreedPrice",
        "agreedPriceRwf", "updatedAt"
      )
      SELECT
        ${bookingId}, "id", ${actor.id}, ${dto.cargoType}, ${dto.cargoDescription ?? null},
        ${dto.cargoWeight}, ${dto.pickupLocation}, ${dto.destination}, ${pickupDate},
        ${expectedDeliveryDate}, ${dto.additionalInstructions ?? null},
        ${`RWF ${truck.priceRwf.toLocaleString('en-RW')}`}, ${truck.priceRwf}, NOW()
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

  async getTrackingLocation(actor: Actor, id: string) {
    const booking = await this.findOne(actor, id);
    if (
      booking.status !== BookingStatus.IN_PROGRESS ||
      booking.trackingLatitude === null ||
      booking.trackingLongitude === null ||
      booking.trackingUpdatedAt === null
    ) {
      return null;
    }
    return {
      latitude: booking.trackingLatitude,
      longitude: booking.trackingLongitude,
      accuracy: booking.trackingAccuracy,
      updatedAt: booking.trackingUpdatedAt,
    };
  }

  async updateTrackingLocation(
    actor: Actor,
    id: string,
    dto: UpdateTrackingLocationDto,
  ) {
    const booking = await this.findOne(actor, id);
    if (
      actor.role !== UserRole.TRUCK_OWNER ||
      booking.truck.ownerId !== actor.id
    ) {
      throw new ForbiddenException(
        'Only this booking’s truck owner can share its location.',
      );
    }
    if (booking.status !== BookingStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Location sharing is available only during an active trip.',
      );
    }

    const updated = await this.prisma.booking.updateMany({
      where: { id, status: BookingStatus.IN_PROGRESS },
      data: {
        trackingLatitude: dto.latitude,
        trackingLongitude: dto.longitude,
        trackingAccuracy: dto.accuracy,
        trackingUpdatedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new BadRequestException(
        'Location sharing is available only during an active trip.',
      );
    }
    return this.getTrackingLocation(actor, id);
  }

  async clearTrackingLocation(actor: Actor, id: string) {
    const booking = await this.findOne(actor, id);
    if (
      actor.role !== UserRole.TRUCK_OWNER ||
      booking.truck.ownerId !== actor.id
    ) {
      throw new ForbiddenException(
        'Only this booking’s truck owner can stop location sharing.',
      );
    }
    await this.prisma.booking.update({
      where: { id },
      data: {
        trackingLatitude: null,
        trackingLongitude: null,
        trackingAccuracy: null,
        trackingUpdatedAt: null,
      },
    });
    return { cleared: true };
  }

  async update(actor: Actor, id: string, dto: UpdateBookingDto) {
    if (!dto.status) throw new BadRequestException('Provide a booking status.');
    const booking = await this.findOne(actor, id);
    const isOwner = booking.truck.ownerId === actor.id;
    const isImporter = booking.importerId === actor.id;
    const disputeResolved = booking.dispute?.status === 'RESOLVED';
    this.assertStatusChange(
      actor,
      booking.status,
      dto.status,
      isOwner,
      isImporter,
      booking.agreedPriceRwf,
      disputeResolved,
    );

    if (dto.status === BookingStatus.IN_PROGRESS) {
      const payment = await this.prisma.bookingPayment.findUnique({
        where: { bookingId: id },
      });
      if (payment?.status !== 'FUNDED') {
        throw new BadRequestException(
          'The importer must pay the agreed price before the trip starts.',
        );
      }
    }

    if (dto.status === BookingStatus.COMPLETED) {
      if (!isImporter) {
        throw new ForbiddenException(
          'Only the importer can confirm delivery and release the held payment.',
        );
      }
      const payment = await this.prisma.bookingPayment.findUnique({
        where: { bookingId: id },
      });
      if (payment?.status !== 'FUNDED') {
        throw new BadRequestException(
          'The booking has no held payment to release.',
        );
      }
      await this.payments.releaseBookingFunds(id);
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === BookingStatus.IN_PROGRESS
          ? {}
          : {
              trackingLatitude: null,
              trackingLongitude: null,
              trackingAccuracy: null,
              trackingUpdatedAt: null,
            }),
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
    agreedPriceRwf: number | null,
    disputeResolved: boolean,
  ) {
    if (actor.role === UserRole.ADMIN) return;
    const ownerTransitions: Partial<Record<BookingStatus, BookingStatus[]>> = {
      PENDING: [BookingStatus.ACCEPTED, BookingStatus.REJECTED],
      ACCEPTED: [BookingStatus.IN_PROGRESS],
      IN_PROGRESS: [BookingStatus.DELIVERED],
    };
    const allowed = isOwner
      ? ownerTransitions[current]
      : isImporter &&
          (current === BookingStatus.DELIVERED ||
            (current === BookingStatus.DISPUTED && disputeResolved))
        ? [BookingStatus.COMPLETED]
        : [];
    if (!allowed?.includes(next))
      throw new ForbiddenException(
        'That booking status change is not allowed.',
      );
    if (next === BookingStatus.ACCEPTED && !agreedPriceRwf)
      throw new BadRequestException(
        'This truck has no agreed RWF price and cannot be accepted.',
      );
  }
}
