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
import { TruckPhotos } from '../trucks/truck-photos';
import { verificationByTruck } from '../trucks/truck-verification';

type Actor = { id: string; role: UserRole };
const BOOKING_INCLUDE = {
  truck: {
    // Inline photos are large; lists point at the cover photo URL instead.
    omit: { photos: true },
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
    private truckPhotos: TruckPhotos = new TruckPhotos(prisma),
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
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: created[0].id },
      include: BOOKING_INCLUDE,
    });
    await this.notifyUsers(
      [
        {
          userId: truck.ownerId,
          role: UserRole.TRUCK_OWNER,
          title: 'New truck booking',
          body: `A customer booked your truck for cargo from ${dto.pickupLocation} to ${dto.destination}.`,
        },
      ],
      bookingId,
    );
    return booking;
  }

  async findAll(actor: Actor) {
    const where: Prisma.BookingWhereInput =
      actor.role === UserRole.ADMIN
        ? {}
        : actor.role === UserRole.IMPORTER
          ? { importerId: actor.id }
          : { truck: { ownerId: actor.id } };
    const bookings = await this.prisma.booking.findMany({
      where,
      include: BOOKING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const trucks = bookings.map((booking) => booking.truck);
    const [covers, verification] = await Promise.all([
      this.truckPhotos.covers(trucks),
      verificationByTruck(this.prisma, [
        ...new Set(trucks.map((truck) => truck.id)),
      ]),
    ]);
    return bookings.map((booking) => ({
      ...booking,
      truck: {
        ...booking.truck,
        ...(covers.get(booking.truck.id) ?? { photos: [], photoCount: 0 }),
        verification: verification.get(booking.truck.id) ?? 'NOT_SUBMITTED',
      },
    }));
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
    if (
      booking.payment?.status === 'RELEASED' &&
      dto.status !== BookingStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'A booking with released payment must remain completed.',
      );
    }
    if (
      booking.status === BookingStatus.COMPLETED &&
      dto.status !== BookingStatus.COMPLETED
    ) {
      throw new BadRequestException('Completed bookings cannot be reopened.');
    }
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
      const canReconcileReleasedPayment =
        actor.role === UserRole.ADMIN && booking.payment?.status === 'RELEASED';
      if (!isImporter && !canReconcileReleasedPayment) {
        throw new ForbiddenException(
          'Only the importer can confirm delivery and release the held payment.',
        );
      }
      const paymentStatus =
        booking.payment?.status ??
        (
          await this.prisma.bookingPayment.findUnique({
            where: { bookingId: id },
            select: { status: true },
          })
        )?.status;
      if (paymentStatus === 'FUNDED' && isImporter) {
        await this.payments.releaseBookingFunds(id);
      } else if (paymentStatus !== 'RELEASED') {
        throw new BadRequestException(
          'The booking has no held payment to release.',
        );
      }
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
      dto.status === BookingStatus.ACCEPTED &&
      booking.status !== BookingStatus.ACCEPTED
    ) {
      await this.ensureShipmentRecord(updated);
    }
    if (
      dto.status === BookingStatus.REJECTED ||
      dto.status === BookingStatus.COMPLETED
    ) {
      await this.prisma.truck.update({
        where: { id: booking.truckId },
        data: { status: TruckStatus.AVAILABLE },
      });
    }
    if (updated.status !== booking.status) {
      const noticeByStatus = {
        [BookingStatus.ACCEPTED]: {
          recipients: [UserRole.IMPORTER],
          title: 'Owner accepted your booking',
          body: `The truck owner accepted booking ${id}. You can now arrange payment.`,
        },
        [BookingStatus.REJECTED]: {
          recipients: [UserRole.IMPORTER],
          title: 'Booking declined',
          body: `The truck owner declined booking ${id}.`,
        },
        [BookingStatus.IN_PROGRESS]: {
          recipients: [UserRole.IMPORTER],
          title: 'Trip started',
          body: `Booking ${id} has left pickup and is now in transit.`,
        },
        [BookingStatus.DELIVERED]: {
          recipients: [UserRole.IMPORTER],
          title: 'Cargo delivered',
          body: `Booking ${id} is marked delivered. Confirm receipt or report a problem.`,
        },
        [BookingStatus.COMPLETED]: {
          recipients: [UserRole.TRUCK_OWNER, UserRole.IMPORTER],
          title: 'Receipt confirmed and booking completed',
          body: `Receipt for booking ${id} was confirmed and the booking is complete.`,
        },
        [BookingStatus.DISPUTED]: {
          recipients: [UserRole.TRUCK_OWNER],
          title: 'Booking disputed',
          body: `The importer reported a problem with booking ${id}.`,
        },
        [BookingStatus.PENDING]: {
          recipients: [],
          title: 'Booking updated',
          body: `Booking ${id} was updated.`,
        },
      } satisfies Record<
        BookingStatus,
        { recipients: UserRole[]; title: string; body: string }
      >;
      const notice = noticeByStatus[dto.status];
      await this.notifyUsers(
        notice.recipients.map((role) => ({
          ...notice,
          role,
          userId:
            role === UserRole.IMPORTER
              ? booking.importerId
              : booking.truck.ownerId,
        })),
        id,
      );
    }
    return updated;
  }

  private async ensureShipmentRecord(booking: {
    id: string;
    truckId: string;
    importerId: string;
    expectedDeliveryDate: Date;
    createdAt: Date;
    cargoRequestId?: string | null;
    driverId?: string | null;
    truck: { ownerId: string };
  }) {
    const shipmentId = `sh-${booking.id}`;
    const createdAt = booking.createdAt.toISOString();
    const data = {
      id: shipmentId,
      ref: `SHP-${new Date().getFullYear()}-${booking.id
        .replace(/[^a-z0-9]/gi, '')
        .slice(-8)
        .toUpperCase()}`,
      bookingId: booking.id,
      ...(booking.cargoRequestId
        ? { cargoRequestId: booking.cargoRequestId }
        : {}),
      ownerId: booking.truck.ownerId,
      importerId: booking.importerId,
      truckId: booking.truckId,
      ...(booking.driverId ? { driverId: booking.driverId } : {}),
      status: 'SCHEDULED',
      etaDate: booking.expectedDeliveryDate.toISOString(),
      milestones: [],
      createdAt,
    };

    await this.prisma.operationsRecord.upsert({
      where: {
        domain_recordId: { domain: 'shipments', recordId: shipmentId },
      },
      create: {
        domain: 'shipments',
        recordId: shipmentId,
        ownerId: booking.truck.ownerId,
        parentId: booking.id,
        status: 'SCHEDULED',
        truckId: booking.truckId,
        searchText: `${data.ref} ${booking.id} ${booking.truckId}`,
        data,
      },
      update: {},
    });
  }

  private notifyUsers(
    notices: { userId: string; role: UserRole; title: string; body: string }[],
    bookingId: string,
  ) {
    if (!notices.length) return Promise.resolve();
    const createdAt = new Date().toISOString();
    return this.prisma.operationsRecord
      .createMany({
        data: notices.map(({ userId, role, title, body }) => {
          const notificationId = randomUUID();
          return {
            domain: 'notifications',
            recordId: notificationId,
            ownerId: userId,
            searchText: `${title} ${body} ${bookingId}`,
            data: {
              id: notificationId,
              userId,
              category: 'BOOKING',
              title,
              body,
              href: `/dashboard/${role === UserRole.IMPORTER ? 'importer' : 'owner'}/bookings/${bookingId}`,
              read: false,
              createdAt,
            },
          };
        }),
      })
      .then(() => undefined);
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
