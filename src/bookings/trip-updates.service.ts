import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, UserRole } from '@prisma/client';
import { notify, type Notice } from '../common/notify';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { type Actor, drivesTruck } from './booking-access';
import { BookingsService } from './bookings.service';
import { DelayDecisionDto, TripUpdateDto } from './dto/trip-update.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Later bookings a delay can push: not started yet. */
const MOVABLE: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
];

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
/** Whole days from `a` to `b` (both stored at midnight UTC). */
const daysBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / DAY_MS);
const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const href = (role: 'importer' | 'owner', bookingId: string) =>
  `/dashboard/${role}/bookings/${bookingId}`;

/**
 * Messages from the road. The truck's driver (or its owner) can tell the importer and the owner
 * how the trip is going; every message is also emailed. A message with a delay moves the trip's
 * last day later and automatically shifts every later booking that now overlaps. Those importers
 * can request a full refund from their booking page at any time before their trip starts.
 */
@Injectable()
export class TripUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly bookings: BookingsService,
  ) {}

  async send(actor: Actor, bookingId: string, dto: TripUpdateDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { truck: { select: { ownerId: true, plateNumber: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    const isOwner = booking.truck.ownerId === actor.id;
    const isDriver = await drivesTruck(this.prisma, actor, booking.truckId);
    if (!isOwner && !isDriver && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only the truck’s driver or owner can send trip updates.',
      );
    }
    if (
      booking.status !== BookingStatus.ACCEPTED &&
      booking.status !== BookingStatus.IN_PROGRESS
    ) {
      throw new BadRequestException(
        'Trip updates are sent for confirmed trips and trips on the road.',
      );
    }
    const sender = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { name: true },
    });
    const from = `${sender?.name ?? 'The driver'}${isDriver ? ' (driver)' : isOwner ? ' (truck owner)' : ''}`;
    const delayDays = dto.delayDays ?? 0;
    const route = `${booking.pickupLocation} → ${booking.destination}`;
    const driverIds = await this.driverUserIds(booking.truckId);

    if (!delayDays) {
      const notices: Notice[] = [
        {
          userId: booking.importerId,
          category: 'TRIP_UPDATE',
          title: `Trip update: ${route}`,
          body: `${from}: ${dto.message}`,
          href: href('importer', bookingId),
          searchText: bookingId,
        },
      ];
      if (!isOwner) {
        notices.push({
          userId: booking.truck.ownerId,
          category: 'TRIP_UPDATE',
          title: `Trip update on ${booking.truck.plateNumber}`,
          body: `${from}: ${dto.message}`,
          href: href('owner', bookingId),
          searchText: bookingId,
        });
      }
      for (const userId of driverIds) {
        if (
          userId === actor.id ||
          notices.some((notice) => notice.userId === userId)
        )
          continue;
        notices.push({
          userId,
          category: 'TRIP_UPDATE',
          title: `Trip update on ${booking.truck.plateNumber}`,
          body: `${from}: ${dto.message}`,
          href: '/dashboard/driver',
          searchText: bookingId,
        });
      }
      await notify(this.prisma, notices);
      return { sent: notices.length, delay: null, impacts: [] };
    }

    const previousEnd = booking.expectedDeliveryDate;
    const newEnd = addDays(previousEnd, delayDays);
    const { delay, impacts } = await this.prisma.$transaction(async (tx) => {
      // Same lock as booking creation, so no one books into the new days at this moment.
      await tx.$queryRaw`SELECT "id" FROM "Truck" WHERE "id" = ${booking.truckId} FOR UPDATE`;
      await tx.booking.update({
        where: { id: bookingId },
        data: { expectedDeliveryDate: newEnd },
      });
      const delay = await tx.tripDelay.create({
        data: {
          bookingId,
          reportedById: actor.id,
          delayDays,
          reason: dto.message,
          previousEndDate: previousEnd,
          newEndDate: newEnd,
        },
      });
      const later = await tx.booking.findMany({
        where: {
          truckId: booking.truckId,
          id: { not: bookingId },
          status: { in: MOVABLE },
          pickupDate: { gt: booking.pickupDate },
        },
        select: {
          id: true,
          importerId: true,
          pickupDate: true,
          expectedDeliveryDate: true,
        },
        orderBy: [{ pickupDate: 'asc' }, { createdAt: 'asc' }],
      });
      const impacts: {
        id: string;
        bookingId: string;
        importerId: string;
        shiftDays: number;
        pickupDate: Date;
        expectedDeliveryDate: Date;
      }[] = [];
      let cascadeEnd = newEnd;
      const now = new Date();
      for (const next of later) {
        if (next.pickupDate > cascadeEnd) break;
        const shiftDays = daysBetween(next.pickupDate, cascadeEnd) + 1;
        const pickupDate = addDays(next.pickupDate, shiftDays);
        const expectedDeliveryDate = addDays(
          next.expectedDeliveryDate,
          shiftDays,
        );
        await tx.booking.update({
          where: { id: next.id },
          data: { pickupDate, expectedDeliveryDate },
        });
        const impact = await tx.delayImpact.create({
          data: {
            delayId: delay.id,
            bookingId: next.id,
            shiftDays,
            status: 'SHIFTED',
            decidedAt: now,
          },
        });
        impacts.push({
          id: impact.id,
          bookingId: next.id,
          importerId: next.importerId,
          shiftDays,
          pickupDate,
          expectedDeliveryDate,
        });
        cascadeEnd = expectedDeliveryDate;
      }
      return { delay, impacts };
    });

    await this.moveShipmentEta(bookingId, newEnd, {
      kind: 'DELAYED',
      note: `Delivery delayed by ${plural(delayDays)}: ${dto.message}`,
      recordedBy: actor.id,
    });
    for (const impact of impacts) {
      await this.moveShipmentEta(impact.bookingId, impact.expectedDeliveryDate);
    }

    const notices: Notice[] = [
      {
        userId: booking.importerId,
        category: 'TRIP_UPDATE',
        title: `Delivery delayed by ${plural(delayDays)}`,
        body: `${from}: ${dto.message} Your cargo (${route}) is now expected on ${dayKey(newEnd)} instead of ${dayKey(previousEnd)}.`,
        href: href('importer', bookingId),
        searchText: bookingId,
      },
    ];
    if (!isOwner) {
      notices.push({
        userId: booking.truck.ownerId,
        category: 'TRIP_UPDATE',
        title: `${booking.truck.plateNumber} delayed by ${plural(delayDays)}`,
        body: `${from}: ${dto.message} The trip now ends on ${dayKey(newEnd)}.${impacts.length ? ` ${impacts.length} later booking(s) were automatically shifted; their importers can request a full refund at any time before their trip starts.` : ''}`,
        href: href('owner', bookingId),
        searchText: bookingId,
      });
    }
    for (const impact of impacts) {
      notices.push({
        userId: impact.importerId,
        category: 'TRIP_UPDATE',
        title: 'Your booking dates were shifted automatically',
        body: `An earlier trip on your truck was delayed. Your booking is now scheduled for ${dayKey(impact.pickupDate)} to ${dayKey(impact.expectedDeliveryDate)}. If the new dates do not work for you, request a full refund from your booking page at any time before the trip starts.`,
        href: href('importer', impact.bookingId),
        searchText: impact.bookingId,
      });
    }
    for (const userId of driverIds) {
      if (
        userId === actor.id ||
        notices.some((notice) => notice.userId === userId)
      )
        continue;
      notices.push({
        userId,
        category: 'TRIP_UPDATE',
        title: `${booking.truck.plateNumber} delayed by ${plural(delayDays)}`,
        body: `${from}: ${dto.message} The trip now ends on ${dayKey(newEnd)}.`,
        href: '/dashboard/driver',
        searchText: bookingId,
      });
    }
    await notify(this.prisma, notices);
    return { sent: notices.length, delay, impacts };
  }

  async decide(
    actor: Actor,
    bookingId: string,
    impactId: string,
    dto: DelayDecisionDto,
  ) {
    const impact = await this.prisma.delayImpact.findFirst({
      where: { id: impactId, bookingId },
      include: {
        booking: {
          include: {
            payment: true,
            truck: { select: { ownerId: true, plateNumber: true } },
          },
        },
      },
    });
    if (!impact)
      throw new NotFoundException('This delay notice was not found.');
    const booking = impact.booking;
    if (booking.importerId !== actor.id) {
      throw new ForbiddenException(
        'Only the importer of this booking can decide.',
      );
    }
    if (!MOVABLE.includes(booking.status)) {
      throw new BadRequestException('This booking can no longer be changed.');
    }
    const decidable =
      impact.status === 'PENDING' ||
      (dto.decision === 'REFUND' && impact.status === 'SHIFTED');
    if (!decidable) {
      throw new BadRequestException('You have already answered this delay.');
    }

    if (dto.decision === 'REFUND') {
      await this.refund(booking, impact.id);
      const driverIds = await this.driverUserIds(booking.truckId);
      await notify(this.prisma, [
        {
          userId: booking.truck.ownerId,
          category: 'BOOKING',
          title: 'Booking cancelled after a delay',
          body: `The importer cancelled booking ${bookingId} (${booking.truck.plateNumber}) because an earlier trip ran late, and was refunded in full.`,
          href: href('owner', bookingId),
          searchText: bookingId,
        },
        ...driverIds.map((userId) => ({
          userId,
          category: 'BOOKING',
          title: 'Booking cancelled after a delay',
          body: `Booking ${bookingId} was cancelled and refunded in full because an earlier trip ran late.`,
          href: '/dashboard/driver',
          searchText: bookingId,
        })),
      ]);
      return this.bookings.findOne(actor, bookingId);
    }

    const moved = await this.shift(
      booking.truckId,
      bookingId,
      impact.shiftDays,
      impact.delayId,
      impact.id,
    );
    const notices: Notice[] = [
      {
        userId: booking.truck.ownerId,
        category: 'BOOKING',
        title: 'Booking dates shifted after a delay',
        body: `Booking ${bookingId} on ${booking.truck.plateNumber} moved ${plural(impact.shiftDays)} later at the importer's choice.${moved.length > 1 ? ` ${moved.length - 1} later booking(s) moved too.` : ''}`,
        href: href('owner', bookingId),
        searchText: bookingId,
      },
    ];
    for (const other of moved.filter((item) => item.id !== bookingId)) {
      notices.push({
        userId: other.importerId,
        category: 'TRIP_UPDATE',
        title: `Your booking moved ${plural(other.shiftDays)} later`,
        body: `An earlier trip on the same truck ran late, so your booking now runs ${dayKey(other.start)} to ${dayKey(other.end)}. If the new dates do not suit you, cancel from your booking page for a full refund.`,
        href: href('importer', other.id),
        searchText: other.id,
      });
    }
    for (const userId of await this.driverUserIds(booking.truckId)) {
      if (notices.some((notice) => notice.userId === userId)) continue;
      notices.push({
        userId,
        category: 'TRIP_UPDATE',
        title: 'Booking dates shifted after a delay',
        body: `Booking ${bookingId} on ${booking.truck.plateNumber} moved ${plural(impact.shiftDays)} later.`,
        href: '/dashboard/driver',
        searchText: bookingId,
      });
    }
    await notify(this.prisma, notices);
    return this.bookings.findOne(actor, bookingId);
  }

  /**
   * Moves the booking later, then every following booking of the vehicle that would now overlap,
   * in date order, each just enough to start the day after the previous one ends.
   */
  private async shift(
    truckId: string,
    bookingId: string,
    shiftDays: number,
    delayId: string,
    impactId: string,
  ) {
    const moved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Truck" WHERE "id" = ${truckId} FOR UPDATE`;
      const first = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      // Bookings after this one are found from where it started, before it moves.
      const originalStart = first.pickupDate;
      const now = new Date();
      const moved: {
        id: string;
        importerId: string;
        shiftDays: number;
        start: Date;
        end: Date;
      }[] = [];
      const move = async (row: typeof first, days: number) => {
        const start = addDays(row.pickupDate, days);
        const end = addDays(row.expectedDeliveryDate, days);
        await tx.booking.update({
          where: { id: row.id },
          data: { pickupDate: start, expectedDeliveryDate: end },
        });
        moved.push({
          id: row.id,
          importerId: row.importerId,
          shiftDays: days,
          start,
          end,
        });
        return end;
      };
      await tx.delayImpact.update({
        where: { id: impactId },
        data: { status: 'SHIFTED', decidedAt: now },
      });
      let previousEnd = await move(first, shiftDays);
      const following = await tx.booking.findMany({
        where: {
          truckId,
          id: { not: bookingId },
          status: { in: MOVABLE },
          pickupDate: { gt: originalStart },
        },
        orderBy: { pickupDate: 'asc' },
      });
      for (const next of following) {
        if (next.pickupDate > previousEnd) break;
        const days = daysBetween(next.pickupDate, previousEnd) + 1;
        // The cascade decides for them; they can still cancel with a full refund.
        const open = await tx.delayImpact.findFirst({
          where: { delayId, bookingId: next.id, status: 'PENDING' },
        });
        if (open) {
          await tx.delayImpact.update({
            where: { id: open.id },
            data: { status: 'SHIFTED', shiftDays: days, decidedAt: now },
          });
        } else {
          await tx.delayImpact.create({
            data: {
              delayId,
              bookingId: next.id,
              shiftDays: days,
              status: 'SHIFTED',
              decidedAt: now,
            },
          });
        }
        previousEnd = await move(next, days);
      }
      return moved;
    });
    for (const item of moved) await this.moveShipmentEta(item.id, item.end);
    return moved;
  }

  /** Cancels the booking and returns everything paid (deposit included) to the importer's wallet. */
  private async refund(
    booking: {
      id: string;
      truckId: string;
      importerId: string;
      truck: { ownerId: string };
      payment: { status: string } | null;
    },
    impactId: string,
  ) {
    const closeBooking = async (tx: Prisma.TransactionClient) => {
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: { in: MOVABLE } },
        data: { status: BookingStatus.CANCELLED },
      });
      if (updated.count !== 1) {
        throw new BadRequestException('This booking can no longer be changed.');
      }
      await tx.delayImpact.update({
        where: { id: impactId },
        data: { status: 'REFUNDED', decidedAt: new Date() },
      });
    };
    if (booking.payment?.status === 'FUNDED') {
      const payment = await this.prisma.bookingPayment.findUniqueOrThrow({
        where: { bookingId: booking.id },
      });
      await this.payments.settleHeldPayment(
        booking.id,
        payment.amountRwf,
        closeBooking,
        'a trip delay',
      );
    } else {
      await this.prisma.$transaction(closeBooking);
    }
    await this.bookings.closeCancelledBooking(
      {
        id: booking.id,
        truckId: booking.truckId,
        importerId: booking.importerId,
        ownerId: booking.truck.ownerId,
      },
      [],
    );
  }

  /** Keeps the shipment's expected arrival in step with the booking, adding a milestone if given. */
  private async moveShipmentEta(
    bookingId: string,
    end: Date,
    milestone?: { kind: string; note: string; recordedBy: string },
  ) {
    const record = await this.prisma.operationsRecord.findUnique({
      where: {
        domain_recordId: { domain: 'shipments', recordId: `sh-${bookingId}` },
      },
    });
    if (!record) return;
    const data = record.data as Prisma.JsonObject;
    const milestones = Array.isArray(data.milestones) ? data.milestones : [];
    await this.prisma.operationsRecord.update({
      where: { id: record.id },
      data: {
        data: {
          ...data,
          etaDate: end.toISOString(),
          updatedAt: new Date().toISOString(),
          ...(milestone
            ? {
                milestones: [
                  ...milestones,
                  {
                    id: `${record.recordId}-delay-${Date.now()}`,
                    kind: milestone.kind,
                    at: new Date().toISOString(),
                    place: 'On the road',
                    note: milestone.note,
                    recordedBy: milestone.recordedBy,
                    simulated: false,
                  },
                ],
              }
            : {}),
        },
      },
    });
  }

  private async driverUserIds(truckId: string): Promise<string[]> {
    const drivers = await this.prisma.operationsRecord.findMany({
      where: {
        domain: 'drivers',
        data: { path: ['assignedTruckId'], equals: truckId },
      },
      select: { data: true },
    });
    return drivers.flatMap((record) => {
      const data = record.data as Prisma.JsonObject;
      return typeof data.userId === 'string' ? [data.userId] : [];
    });
  }
}
