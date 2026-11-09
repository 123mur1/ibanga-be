import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BookingStatus, Prisma, TruckStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { notify } from '../common/notify';
import { PaymentsService } from '../payments/payments.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { SettleDisputeDto } from './dto/settle-dispute.dto';
import { UpdateTrackingLocationDto } from './dto/update-tracking-location.dto';
import { TruckPhotos } from '../trucks/truck-photos';
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

/** Minutes an importer has, from booking, to pay before the booking is cancelled. */
export function paymentWindowMinutes() {
  const minutes = Number(process.env.BOOKING_PAYMENT_WINDOW_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
}

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
          status: { in: UNPAID_CANCELLABLE },
          createdAt: { lte: cutoff },
          payment: { is: null },
        },
        select: { id: true },
        take: 100,
      });
      let count = 0;
      for (const { id } of expired) {
        const cancelled = await this.cancelIfUnpaid(id, cutoff);
        if (!cancelled) continue;
        count += 1;
        await this.afterCancel(cancelled, [
          {
            userId: cancelled.importerId,
            role: UserRole.IMPORTER,
            title: 'Booking cancelled: not paid in time',
            body: `Booking ${id} was not paid within ${minutes} minutes, so it was cancelled and the truck released. You can book again if it is still available.`,
          },
          {
            userId: cancelled.ownerId,
            role: UserRole.TRUCK_OWNER,
            title: 'Booking expired unpaid',
            body: `Booking ${id} was not paid within ${minutes} minutes and was cancelled. Your truck is available again.`,
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
    await this.afterCancel(cancelled, [
      {
        userId: cancelled.ownerId,
        role: UserRole.TRUCK_OWNER,
        title: 'Booking cancelled by the importer',
        body: `The importer cancelled booking ${id} before paying. Your truck is available again.`,
      },
    ]);
    return this.findOne(actor, id);
  }

  /**
   * Cancels the booking and frees its truck only if it is still pending or confirmed with no
   * payment. The booking row is locked first, and payment locks the same row, so a booking that
   * is being paid at the same moment ends up either paid or cancelled, never both.
   * `createdBefore` limits it to bookings past the payment window.
   */
  private cancelIfUnpaid(
    id: string,
    createdBefore?: Date,
  ): Promise<CancelledBooking | null> {
    return this.prisma.$transaction(async (transaction) => {
      const [booking] = await transaction.$queryRaw<
        {
          id: string;
          truckId: string;
          importerId: string;
          status: BookingStatus;
          createdAt: Date;
        }[]
      >`
        SELECT "id", "truckId", "importerId", "status", "createdAt"
        FROM "Booking" WHERE "id" = ${id} FOR UPDATE
      `;
      if (!booking || !UNPAID_CANCELLABLE.includes(booking.status)) return null;
      if (createdBefore && booking.createdAt > createdBefore) return null;
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
      // Free the truck unless another live booking still holds it.
      const otherActive = await transaction.booking.count({
        where: {
          truckId: booking.truckId,
          id: { not: id },
          status: {
            in: [
              BookingStatus.PENDING,
              BookingStatus.ACCEPTED,
              BookingStatus.IN_PROGRESS,
              BookingStatus.DELIVERED,
              BookingStatus.DISPUTED,
            ],
          },
        },
      });
      const truck = otherActive
        ? await transaction.truck.findUniqueOrThrow({
            where: { id: booking.truckId },
            select: { ownerId: true },
          })
        : await transaction.truck.update({
            where: { id: booking.truckId },
            data: { status: TruckStatus.AVAILABLE },
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
  private async afterCancel(
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
    await assertTruckVerified(this.prisma, truck.id);

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
    if (dto.status === BookingStatus.CANCELLED) {
      return this.cancelUnpaid(actor, id);
    }
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
    if (updated.status !== booking.status) {
      await this.syncShipmentRecord(updated);
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
        [BookingStatus.CANCELLED]: {
          recipients: [UserRole.TRUCK_OWNER],
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
        await transaction.truck.update({
          where: { id: booking.truckId },
          data: { status: TruckStatus.AVAILABLE },
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
