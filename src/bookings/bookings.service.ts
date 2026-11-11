import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { BookingStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { notify } from '../common/notify';
import { PaymentsService } from '../payments/payments.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { SettleDisputeDto } from './dto/settle-dispute.dto';
import { UpdateTrackingLocationDto } from './dto/update-tracking-location.dto';
import { TruckPhotos } from '../trucks/truck-photos';
import {
  bookedRangesByTruck,
  dayKey,
  isRangeFree,
} from '../trucks/availability';
import { quoteTrip } from './trip-quote';
import { paymentWindowMinutes, windowLabel } from './payment-window';
import { driverTruckIds, drivesTruck } from './booking-access';
import type { PayBookingDto } from '../payments/wallet.dto';
import {
  assertTruckVerified,
  verificationByTruck,
} from '../trucks/truck-verification';

type Actor = { id: string; role: UserRole };

/** Bookings an importer may still cancel without a fee: nothing has been paid yet. */
const UNPAID_CANCELLABLE: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
];
/** How often unpaid bookings past the payment window are looked for. */
const EXPIRY_SWEEP_MS = 30_000;

export { paymentWindowMinutes };

/** Document kinds the importer must upload before the trip can start. */
export const REQUIRED_DOCUMENT_KINDS = ['CARGO', 'TAX'] as const;

type CancelledBooking = {
  id: string;
  truckId: string;
  importerId: string;
  ownerId: string;
};

type ShipmentSource = {
  id: string;
  truckId: string;
  importerId: string;
  expectedDeliveryDate: Date;
  createdAt: Date;
  cargoRequestId?: string | null;
  driverId?: string | null;
  truck: { ownerId: string };
};

/** The shipment step each booking status implies; the frontend uses the same order. */
const SHIPMENT_STEP_FOR_BOOKING: Partial<Record<BookingStatus, string>> = {
  [BookingStatus.ACCEPTED]: 'SCHEDULED',
  [BookingStatus.IN_PROGRESS]: 'IN_TRANSIT',
  [BookingStatus.DELIVERED]: 'ARRIVED',
  [BookingStatus.COMPLETED]: 'COMPLETED',
};
const SHIPMENT_ORDER = [
  'SCHEDULED',
  'PICKUP_CONFIRMED',
  'LOADED',
  'DEPARTED',
  'IN_TRANSIT',
  'DELAYED',
  'ARRIVED',
  'UNLOADING',
  'DELIVERED',
  'COMPLETED',
];
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
  // File contents stay out of lists; GET /bookings/:id/documents/:documentId/file serves them.
  documents: { omit: { dataUrl: true }, orderBy: { createdAt: 'asc' } },
  delays: { orderBy: { createdAt: 'asc' } },
  delayImpacts: {
    include: {
      delay: {
        select: {
          id: true,
          bookingId: true,
          delayDays: true,
          reason: true,
          newEndDate: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.BookingInclude;

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsService.name);
  private expiryTimer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
    private truckPhotos: TruckPhotos = new TruckPhotos(prisma),
  ) {}

  onModuleInit() {
    this.expiryTimer = setInterval(() => {
      void this.expireUnpaidBookings();
    }, EXPIRY_SWEEP_MS);
    this.expiryTimer.unref();
    void this.expireUnpaidBookings();
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = null;
  }

  /**
   * Cancels every booking still unpaid once the payment window has passed since it was made,
   * and frees its truck. Runs in the background; a failure is logged and retried next sweep.
   */
  async expireUnpaidBookings(now = new Date()) {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const minutes = paymentWindowMinutes();
      const cutoff = new Date(now.getTime() - minutes * 60_000);
      const expired = await this.prisma.booking.findMany({
        where: {
          status: BookingStatus.ACCEPTED,
          payment: { is: null },
          OR: [
            { acceptedAt: { lte: cutoff } },
            // Accepted before acceptedAt was recorded: the last update was the acceptance.
            { acceptedAt: null, updatedAt: { lte: cutoff } },
          ],
        },
        select: { id: true },
        take: 100,
      });
      let count = 0;
      for (const { id } of expired) {
        const cancelled = await this.cancelIfUnpaid(id, cutoff);
        if (!cancelled) continue;
        count += 1;
        await this.closeCancelledBooking(cancelled, [
          {
            userId: cancelled.importerId,
            role: UserRole.IMPORTER,
            title: 'Booking cancelled: deposit not paid in time',
            body: `The 50% deposit for booking ${id} was not paid within ${windowLabel(minutes)} of the owner's acceptance, so the booking was cancelled and its days released. You can book again if the dates are still free.`,
          },
          {
            userId: cancelled.ownerId,
            role: UserRole.TRUCK_OWNER,
            title: 'Booking expired unpaid',
            body: `The importer did not pay the deposit for booking ${id} within ${windowLabel(minutes)}, so it was cancelled. Those days are free on your truck's calendar again.`,
          },
        ]);
      }
      if (count) this.logger.log(`Cancelled ${count} unpaid booking(s).`);
      return count;
    } catch (error) {
      this.logger.error(`Unpaid booking sweep failed: ${String(error)}`);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  /** The importer cancels their own booking before paying. No fee; the truck is freed at once. */
  async cancelUnpaid(actor: Actor, id: string) {
    const booking = await this.findOne(actor, id);
    if (actor.role !== UserRole.ADMIN && booking.importerId !== actor.id) {
      throw new ForbiddenException(
        'Only the importer who made this booking can cancel it.',
      );
    }
    const cancelled = await this.cancelIfUnpaid(id);
    if (!cancelled) {
      throw new BadRequestException(
        booking.payment
          ? 'This booking is already paid. Request a cancellation instead; an administrator reviews paid cancellations.'
          : 'Only a pending or confirmed booking that has not been paid can be cancelled.',
      );
    }
    await this.closeCancelledBooking(cancelled, [
      {
        userId: cancelled.importerId,
        role: UserRole.IMPORTER,
        title: 'Booking request cancelled',
        body: `Your unpaid booking request ${id} was cancelled. No payment was taken and the truck dates were released.`,
      },
      {
        userId: cancelled.ownerId,
        role: UserRole.TRUCK_OWNER,
        title: 'Booking cancelled by the importer',
        body: `The importer cancelled booking ${id} before paying. Those days are free on your truck's calendar again.`,
      },
    ]);
    return this.findOne(actor, id);
  }

  /**
   * Cancels the booking and frees its truck only if it is still pending or confirmed with no
   * payment. The booking row is locked first, and payment locks the same row, so a booking that
   * is being paid at the same moment ends up either paid or cancelled, never both.
   * `acceptedBefore` limits it to accepted bookings past the payment window. Only the booked days
   * are freed; the vehicle itself stays listed.
   */
  private cancelIfUnpaid(
    id: string,
    acceptedBefore?: Date,
  ): Promise<CancelledBooking | null> {
    return this.prisma.$transaction(async (transaction) => {
      const [booking] = await transaction.$queryRaw<
        {
          id: string;
          truckId: string;
          importerId: string;
          status: BookingStatus;
          acceptedAt: Date | null;
          updatedAt: Date;
        }[]
      >`
        SELECT "id", "truckId", "importerId", "status", "acceptedAt", "updatedAt"
        FROM "Booking" WHERE "id" = ${id} FOR UPDATE
      `;
      if (!booking || !UNPAID_CANCELLABLE.includes(booking.status)) return null;
      if (
        acceptedBefore &&
        (booking.status !== BookingStatus.ACCEPTED ||
          (booking.acceptedAt ?? booking.updatedAt) > acceptedBefore)
      ) {
        return null;
      }
      const payments = await transaction.bookingPayment.count({
        where: { bookingId: id },
      });
      if (payments) return null;
      await transaction.booking.update({
        where: { id },
        data: {
          status: BookingStatus.CANCELLED,
          trackingLatitude: null,
          trackingLongitude: null,
          trackingAccuracy: null,
          trackingUpdatedAt: null,
        },
      });
      // A cancelled booking no longer counts in the booked days, so its dates are free again.
      const truck = await transaction.truck.findUniqueOrThrow({
        where: { id: booking.truckId },
        select: { ownerId: true },
      });
      return {
        id: booking.id,
        truckId: booking.truckId,
        importerId: booking.importerId,
        ownerId: truck.ownerId,
      };
    });
  }

  /**
   * Marks the booking's shipment (scheduled when it was accepted) and any cargo request it was
   * booked from as cancelled, then notifies.
   */
  /** Public so delay refunds close the shipment and cargo request the same way. */
  async closeCancelledBooking(
    booking: CancelledBooking,
    notices: { userId: string; role: UserRole; title: string; body: string }[],
  ) {
    const shipment = await this.prisma.operationsRecord.findUnique({
      where: {
        domain_recordId: { domain: 'shipments', recordId: `sh-${booking.id}` },
      },
    });
    const cargoRequests = await this.prisma.operationsRecord.findMany({
      where: {
        domain: 'cargo-requests',
        status: 'BOOKED',
        data: { path: ['bookingId'], equals: booking.id },
      },
    });
    const now = new Date().toISOString();
    for (const record of [shipment, ...cargoRequests]) {
      if (!record || record.status === 'CANCELLED') continue;
      await this.prisma.operationsRecord.update({
        where: { id: record.id },
        data: {
          status: 'CANCELLED',
          data: {
            ...(record.data as Prisma.JsonObject),
            status: 'CANCELLED',
            updatedAt: now,
          },
        },
      });
    }
    await this.notifyUsers(notices, booking.id);
  }

  /**
   * An importer books a vehicle for a span of days. The vehicle stays listed: the booking only
   * takes the days from pickup to expected delivery, and overlapping requests are refused. The
   * price is set here, never by the client: road distance from the vehicle's location to the
   * chosen destination, times the vehicle's rate per km.
   */
  async create(actor: Actor, dto: CreateBookingDto) {
    if (actor.role !== UserRole.IMPORTER)
      throw new ForbiddenException('Only importers can create bookings.');
    const start = dayKey(new Date(dto.pickupDate));
    const end = dayKey(new Date(dto.expectedDeliveryDate));
    if (end < start)
      throw new BadRequestException(
        'The last day must be on or after the first day.',
      );
    if (start < dayKey(new Date()))
      throw new BadRequestException('Choose dates from today onwards.');

    const truck = await this.prisma.truck.findUnique({
      where: { id: dto.truckId },
    });
    if (!truck) throw new NotFoundException('Truck not found.');
    if (dto.cargoWeight > truck.capacity)
      throw new BadRequestException(
        'Cargo weight exceeds this truck capacity.',
      );
    await assertTruckVerified(this.prisma, truck.id);

    const quote = await quoteTrip(truck, {
      pickupCity: dto.pickupCity ?? dto.pickupLocation,
      pickupArea: dto.pickupArea,
      destinationCity: dto.destinationCity ?? dto.destination,
      destinationArea: dto.destinationArea,
    });
    const priceRwf = quote.priceRwf;
    const destination = quote.destinationCity;
    const distance = { km: quote.km };

    const bookingId = await this.prisma.$transaction(async (transaction) => {
      // Lock the vehicle so two importers cannot book overlapping days at the same moment.
      await transaction.$queryRaw`
        SELECT "id" FROM "Truck" WHERE "id" = ${truck.id} FOR UPDATE
      `;
      const booked = await bookedRangesByTruck(
        transaction,
        [truck.id],
        new Date(`${start}T00:00:00.000Z`),
      );
      if (!isRangeFree(start, end, booked.get(truck.id) ?? [])) {
        throw new BadRequestException(
          'Someone booked this vehicle on some of those dates. Choose other dates.',
        );
      }
      const created = await transaction.booking.create({
        data: {
          truckId: truck.id,
          importerId: actor.id,
          cargoType: dto.cargoType,
          cargoDescription: dto.cargoDescription ?? null,
          cargoWeight: dto.cargoWeight,
          pickupLocation: quote.pickupCity,
          destination,
          truckLocation: quote.truckLocation,
          pickupCountry: quote.pickupCountry,
          pickupCity: quote.pickupCity,
          pickupArea: quote.pickupArea,
          destinationCountry: quote.destinationCountry,
          destinationCity: quote.destinationCity,
          destinationArea: quote.destinationArea,
          routeLegs: quote.legs,
          pickupDate: new Date(`${start}T00:00:00.000Z`),
          expectedDeliveryDate: new Date(`${end}T00:00:00.000Z`),
          additionalInstructions: dto.additionalInstructions ?? null,
          distanceKm: distance.km,
          pricePerKmRwf: truck.pricePerKmRwf,
          agreedPriceRwf: priceRwf,
          agreedPrice: `RWF ${priceRwf.toLocaleString('en-RW')}`,
        },
        select: { id: true },
      });
      return created.id;
    });

    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: BOOKING_INCLUDE,
    });
    await this.notifyUsers(
      [
        {
          userId: actor.id,
          role: UserRole.IMPORTER,
          title: 'Booking request sent',
          body: `Your request to book truck ${truck.plateNumber ?? truck.id} from ${start} to ${end} has been sent. The owner must accept it before your 1-hour deposit payment window starts.`,
        },
        {
          userId: truck.ownerId,
          role: UserRole.TRUCK_OWNER,
          title: 'New truck booking',
          body: `A customer asks for your truck from ${start} to ${end}: pickup in ${quote.pickupArea ? `${quote.pickupArea}, ` : ''}${quote.pickupCity}, delivery to ${quote.destinationArea ? `${quote.destinationArea}, ` : ''}${destination} (${distance.km} km round trip, RWF ${priceRwf.toLocaleString('en-RW')}). Accept or decline it from your dashboard.`,
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
          : actor.role === UserRole.DRIVER
            ? // A driver sees the trips of the truck they drive, never other trucks.
              {
                truckId: { in: await driverTruckIds(this.prisma, actor.id) },
                status: { notIn: [BookingStatus.REJECTED] },
              }
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
    if (!(await drivesTruck(this.prisma, actor, booking.truckId))) {
      this.assertCanView(actor, booking);
    }
    return booking;
  }

  /**
   * The importer confirms the cargo arrived and pays the remaining 50% in the same step; the whole
   * held amount is then released to the owner and the booking completed. If completing fails
   * after the balance is paid, trying again does not charge twice.
   */
  async confirmReceipt(actor: Actor, id: string, checkout: PayBookingDto) {
    const booking = await this.findOne(actor, id);
    if (booking.importerId !== actor.id) {
      throw new ForbiddenException(
        'Only the importer who made this booking can confirm receipt.',
      );
    }
    await this.payments.payBalance(actor, id, checkout);
    return this.update(actor, id, { status: BookingStatus.COMPLETED });
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
    const ownsTruck =
      actor.role === UserRole.TRUCK_OWNER && booking.truck.ownerId === actor.id;
    if (
      !ownsTruck &&
      !(await drivesTruck(this.prisma, actor, booking.truckId))
    ) {
      throw new ForbiddenException(
        'Only this bookingâ€™s truck owner or driver can share its location.',
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
        'Only this bookingâ€™s truck owner can stop location sharing.',
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
    if (dto.status === BookingStatus.CANCELLED) {
      return this.cancelUnpaid(actor, id);
    }
    const booking = await this.findOne(actor, id);
    const isOwner = booking.truck.ownerId === actor.id;
    const isImporter = booking.importerId === actor.id;
    const isDriver = await drivesTruck(this.prisma, actor, booking.truckId);
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
      isDriver,
    );

    if (dto.status === BookingStatus.IN_PROGRESS) {
      const payment = await this.prisma.bookingPayment.findUnique({
        where: { bookingId: id },
      });
      if (payment?.status !== 'FUNDED') {
        throw new BadRequestException(
          'The importer must pay the 50% deposit before the trip starts.',
        );
      }
      const kinds = await this.prisma.bookingDocument.findMany({
        where: { bookingId: id },
        select: { kind: true },
        distinct: ['kind'],
      });
      const missing = REQUIRED_DOCUMENT_KINDS.filter(
        (kind) => !kinds.some((document) => document.kind === kind),
      );
      if (missing.length) {
        throw new BadRequestException(
          `The importer must upload the ${missing
            .map((kind) => (kind === 'CARGO' ? 'cargo' : 'tax'))
            .join(' and ')} documents before the trip starts.`,
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
      if (
        paymentStatus === 'FUNDED' &&
        booking.payment?.depositRwf &&
        !booking.payment.balancePaidAt
      ) {
        throw new BadRequestException(
          'Pay the remaining 50% to confirm receipt and complete the booking.',
        );
      }
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
        ...(dto.status === BookingStatus.ACCEPTED
          ? { acceptedAt: new Date() }
          : {}),
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
    if (updated.status !== booking.status) {
      await this.syncShipmentRecord(updated);
    }
    if (updated.status !== booking.status) {
      const deposit = booking.agreedPriceRwf
        ? `RWF ${Math.ceil(booking.agreedPriceRwf / 2).toLocaleString('en-RW')}`
        : 'half the price';
      const noticeByStatus = {
        [BookingStatus.ACCEPTED]: {
          recipients: [UserRole.IMPORTER, UserRole.TRUCK_OWNER],
          title: 'Owner accepted your booking: pay the deposit within 1 hour',
          body: `The truck owner accepted booking ${id}. Pay the 50% deposit (${deposit}) within ${windowLabel()}, or the booking is cancelled and the dates released. Then upload your cargo and tax documents before the trip starts.`,
        },
        [BookingStatus.REJECTED]: {
          recipients: [UserRole.IMPORTER, UserRole.TRUCK_OWNER],
          title: 'Booking declined',
          body: `The truck owner declined booking ${id}.`,
        },
        [BookingStatus.IN_PROGRESS]: {
          recipients: [UserRole.IMPORTER, UserRole.TRUCK_OWNER],
          title: 'Trip started',
          body: `Booking ${id} has left pickup and is now in transit.`,
        },
        [BookingStatus.DELIVERED]: {
          recipients: [UserRole.IMPORTER, UserRole.TRUCK_OWNER],
          title: 'Cargo delivered: confirm receipt and pay the balance',
          body: `Booking ${id} is marked delivered. Confirm you received the cargo and pay the remaining 50%, or report a problem.`,
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
        [BookingStatus.CANCELLED]: {
          recipients: [UserRole.TRUCK_OWNER, UserRole.IMPORTER],
          title: 'Booking cancelled',
          body: `Booking ${id} was cancelled.`,
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
      const notice: {
        recipients: UserRole[];
        title: string;
        body: string;
      } = noticeByStatus[dto.status];
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
      if (
        dto.status === BookingStatus.IN_PROGRESS ||
        dto.status === BookingStatus.DELIVERED ||
        dto.status === BookingStatus.COMPLETED
      ) {
        const driverRecords = await this.prisma.operationsRecord.findMany({
          where: {
            domain: 'drivers',
            data: { path: ['assignedTruckId'], equals: booking.truckId },
          },
          select: { data: true },
        });
        const driverIds = driverRecords.flatMap((record) => {
          const data = record.data as Prisma.JsonObject;
          return typeof data.userId === 'string' ? [data.userId] : [];
        });
        await notify(
          this.prisma,
          driverIds.map((userId) => ({
            userId,
            category: 'BOOKING',
            title: notice.title,
            body: notice.body,
            href: '/dashboard/driver',
            searchText: id,
          })),
        );
      }
    }
    return updated;
  }

  /**
   * An administrator settles a disputed booking. The held payment is refunded to the importer in
   * full or in part, and whatever is not refunded is released to the owner. The booking is then
   * closed, its truck freed and the dispute marked resolved.
   */
  async settleDispute(actor: Actor, id: string, dto: SettleDisputeDto) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only an administrator can settle a dispute.',
      );
    }
    const booking = await this.findOne(actor, id);
    const openCase = await this.prisma.operationsRecord.count({
      where: {
        domain: 'dispute-cases',
        data: { path: ['bookingId'], equals: id },
        NOT: { status: { in: ['RESOLVED', 'REJECTED'] } },
      },
    });
    if (booking.status !== BookingStatus.DISPUTED && !openCase) {
      throw new BadRequestException(
        'Only a booking under dispute can be settled this way.',
      );
    }
    const settlement = await this.payments.settleHeldPayment(
      id,
      dto.refundRwf,
      async (transaction) => {
        await transaction.booking.update({
          where: { id },
          data: {
            status: BookingStatus.COMPLETED,
            trackingLatitude: null,
            trackingLongitude: null,
            trackingAccuracy: null,
            trackingUpdatedAt: null,
          },
        });
        await transaction.dispute.updateMany({
          where: { bookingId: id, status: 'OPEN' },
          data: {
            status: 'RESOLVED',
            resolutionNotes: dto.resolutionNotes,
            resolvedAt: new Date(),
          },
        });
        await this.closeRefundRequests(transaction, actor, id, dto);
      },
    );

    const rwf = (amount: number) => `${amount.toLocaleString('en-US')} RWF`;
    const outcome =
      settlement.refundRwf === settlement.amountRwf
        ? 'refunded in full'
        : settlement.refundRwf
          ? `settled: ${rwf(settlement.refundRwf)} refunded, the rest paid to the owner`
          : 'released to the truck owner';
    await this.notifyUsers(
      [
        {
          userId: booking.importerId,
          role: UserRole.IMPORTER,
          title: settlement.refundRwf
            ? 'Refund issued after your dispute'
            : 'Dispute decided',
          body: settlement.refundRwf
            ? `${rwf(settlement.refundRwf)} for booking ${id} was returned to your iBanga wallet. ${dto.resolutionNotes}`
            : `The payment for booking ${id} was ${outcome}. ${dto.resolutionNotes}`,
        },
        {
          userId: booking.truck.ownerId,
          role: UserRole.TRUCK_OWNER,
          title: 'Dispute decided',
          body: `The payment for booking ${id} was ${outcome}. ${dto.resolutionNotes}`,
        },
      ],
      id,
    );
    const settled = await this.findOne(actor, id);
    await this.syncShipmentRecord(settled);
    return { ...settlement, booking: settled };
  }

  /**
   * An administrator completes an approved cancellation request. A paid booking is settled by
   * the cancellation policy, worked out here rather than taken from the request: 10% is kept as a
   * fee (50% once the trip has started) and paid to the owner, the rest is refunded to the
   * importer's wallet. The booking is cancelled and the request closed in the same transaction.
   * An unpaid booking is simply cancelled.
   */
  async completeCancellation(actor: Actor, bookingId: string) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only an administrator can complete a cancellation.',
      );
    }
    const booking = await this.findOne(actor, bookingId);
    const request = await this.prisma.operationsRecord.findFirst({
      where: {
        domain: 'cancellations',
        data: { path: ['bookingId'], equals: bookingId },
        status: 'APPROVED',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!request) {
      throw new BadRequestException(
        'Approve the cancellation request before completing it.',
      );
    }
    const closeRequest = (
      client: Prisma.TransactionClient | PrismaService,
      amounts: { feeRwf: number; refundRwf: number },
    ) =>
      client.operationsRecord.update({
        where: { id: request.id },
        data: {
          status: 'COMPLETED',
          data: {
            ...(request.data as Prisma.JsonObject),
            ...amounts,
            status: 'COMPLETED',
            resolvedAt: new Date().toISOString(),
          },
        },
      });

    const paid = booking.payment?.status === 'FUNDED';
    let feeRwf = 0;
    let refundRwf = 0;
    let cancelled: CancelledBooking;
    if (paid) {
      if (
        booking.status !== BookingStatus.ACCEPTED &&
        booking.status !== BookingStatus.IN_PROGRESS
      ) {
        throw new BadRequestException(
          'Only a confirmed or in-transit booking can be cancelled. Delivered or disputed bookings are settled through a dispute.',
        );
      }
      const stage = (request.data as Prisma.JsonObject).stage;
      const pickedUp =
        booking.status === BookingStatus.IN_PROGRESS ||
        stage === 'AFTER_PICKUP';
      const amount = booking.payment!.amountRwf;
      feeRwf = Math.round(amount * (pickedUp ? 0.5 : 0.1));
      refundRwf = amount - feeRwf;
      await this.payments.settleHeldPayment(
        bookingId,
        refundRwf,
        async (transaction) => {
          await transaction.booking.update({
            where: { id: bookingId },
            data: {
              status: BookingStatus.CANCELLED,
              trackingLatitude: null,
              trackingLongitude: null,
              trackingAccuracy: null,
              trackingUpdatedAt: null,
            },
          });
          await closeRequest(transaction, { feeRwf, refundRwf });
        },
      );
      cancelled = {
        id: booking.id,
        truckId: booking.truckId,
        importerId: booking.importerId,
        ownerId: booking.truck.ownerId,
      };
    } else {
      const result = await this.cancelIfUnpaid(bookingId);
      if (!result) {
        throw new BadRequestException(
          'This booking can no longer be cancelled.',
        );
      }
      await closeRequest(this.prisma, { feeRwf, refundRwf });
      cancelled = result;
    }

    const rwf = (value: number) => `RWF ${value.toLocaleString('en-RW')}`;
    await this.closeCancelledBooking(cancelled, [
      {
        userId: cancelled.importerId,
        role: UserRole.IMPORTER,
        title: 'Booking cancelled',
        body: paid
          ? `Booking ${bookingId} is cancelled. ${rwf(refundRwf)} was returned to your iBanga wallet; the ${rwf(feeRwf)} cancellation fee went to the truck owner.`
          : `Booking ${bookingId} is cancelled. Nothing was charged.`,
      },
      {
        userId: cancelled.ownerId,
        role: UserRole.TRUCK_OWNER,
        title: 'Booking cancelled',
        body: paid
          ? `Booking ${bookingId} was cancelled by the importer. You receive the ${rwf(feeRwf)} cancellation fee, less commission.`
          : `Booking ${bookingId} was cancelled before payment.`,
      },
    ]);
    return {
      bookingId,
      feeRwf,
      refundRwf,
      booking: await this.findOne(actor, bookingId),
    };
  }

  /** A settled dispute answers any refund request still waiting on the booking. */
  private async closeRefundRequests(
    transaction: Prisma.TransactionClient,
    actor: Actor,
    bookingId: string,
    dto: SettleDisputeDto,
  ) {
    const pending = await transaction.operationsRecord.findMany({
      where: { domain: 'refunds', parentId: bookingId, status: 'REQUESTED' },
    });
    const approved = dto.refundRwf > 0;
    for (const record of pending) {
      const data = {
        ...(record.data as Prisma.JsonObject),
        status: approved ? 'APPROVED' : 'REJECTED',
        decisionNote: dto.resolutionNotes,
        decidedBy: actor.id,
        resolvedAt: new Date().toISOString(),
        ...(approved
          ? { approvedAmountRwf: dto.refundRwf, payoutState: 'COMPLETED' }
          : {}),
      };
      await transaction.operationsRecord.update({
        where: { id: record.id },
        data: { status: data.status, data },
      });
    }
  }

  /**
   * Moves the booking's shipment forward to match the booking (trip started, delivered, receipt
   * confirmed), creating it first if needed. Never moves a shipment backwards: steps the owner
   * recorded in more detail are kept.
   */
  private async syncShipmentRecord(
    booking: ShipmentSource & { status: BookingStatus; destination: string },
  ) {
    const target = SHIPMENT_STEP_FOR_BOOKING[booking.status];
    if (!target) return;
    await this.ensureShipmentRecord(booking);
    const recordId = `sh-${booking.id}`;
    const record = await this.prisma.operationsRecord.findUnique({
      where: { domain_recordId: { domain: 'shipments', recordId } },
    });
    if (!record) return;
    const data = record.data as Prisma.JsonObject;
    const current = typeof data.status === 'string' ? data.status : 'SCHEDULED';
    if (
      current === 'CANCELLED' ||
      SHIPMENT_ORDER.indexOf(current) >= SHIPMENT_ORDER.indexOf(target)
    ) {
      return;
    }
    const milestones = Array.isArray(data.milestones) ? data.milestones : [];
    const next = {
      ...data,
      status: target,
      ...(target === 'COMPLETED'
        ? {
            milestones: [
              ...milestones,
              {
                id: `${recordId}-received`,
                kind: 'DELIVERED',
                at: new Date().toISOString(),
                place: booking.destination,
                note: 'The importer confirmed receipt of the cargo.',
                recordedBy: booking.importerId,
                simulated: false,
              },
            ],
          }
        : {}),
    };
    await this.prisma.operationsRecord.update({
      where: { id: record.id },
      data: { status: target, data: next },
    });
  }

  private async ensureShipmentRecord(booking: ShipmentSource) {
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
    return notify(
      this.prisma,
      notices.map(({ userId, role, title, body }) => ({
        userId,
        category: 'BOOKING',
        title,
        body,
        href: `/dashboard/${role === UserRole.IMPORTER ? 'importer' : 'owner'}/bookings/${bookingId}`,
        searchText: bookingId,
      })),
    );
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
    isDriver = false,
  ) {
    if (actor.role === UserRole.ADMIN) return;
    const ownerTransitions: Partial<Record<BookingStatus, BookingStatus[]>> = {
      PENDING: [BookingStatus.ACCEPTED, BookingStatus.REJECTED],
      ACCEPTED: [BookingStatus.IN_PROGRESS],
      IN_PROGRESS: [BookingStatus.DELIVERED],
    };
    // The truck's driver runs the trip (start, deliver) but never accepts or declines work.
    const driverTransitions: Partial<Record<BookingStatus, BookingStatus[]>> = {
      ACCEPTED: [BookingStatus.IN_PROGRESS],
      IN_PROGRESS: [BookingStatus.DELIVERED],
    };
    const allowed = isOwner
      ? ownerTransitions[current]
      : isDriver
        ? driverTransitions[current]
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
