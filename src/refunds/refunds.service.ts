import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingPaymentStatus,
  BookingStatus,
  DisputeStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { BookingsService } from '../bookings/bookings.service';
import { activeAdminIds, notify } from '../common/notify';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRefundDto,
  DecideRefundDto,
  RespondRefundDto,
} from './dto/refund.dto';

type Actor = { id: string; role: UserRole };

export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED';

export type StoredRefund = {
  id: string;
  ref: string;
  bookingId: string;
  importerId: string;
  truckOwnerId: string;
  reason: string;
  details: string;
  amountRwf: number;
  refundTo: string;
  status: RefundStatus;
  source: 'DISPUTE';
  /** The truck owner's side of the story. */
  ownerNote: string;
  ownerRespondedAt?: string;
  /** The administrator's reason for the decision, shown to both parties. */
  decisionNote?: string;
  approvedAmountRwf?: number;
  decidedBy?: string;
  payoutState?: 'COMPLETED';
  createdAt: string;
  resolvedAt?: string;
};

/** A paid booking whose trip went wrong: the truck never came, never arrived, or the cargo had a problem. */
const REFUNDABLE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.DELIVERED,
  BookingStatus.DISPUTED,
];

/**
 * Importer refund requests on a disputed booking. The importer asks, the truck owner may give
 * their side, and an administrator decides. Approval refunds the money held in escrow straight to
 * the importer's wallet (BookingsService.settleDispute, which also closes the request). Stored as
 * operations records (domain "refunds"), so no database migration is needed.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
  ) {}

  async findAll(actor: Actor) {
    const where: Prisma.OperationsRecordWhereInput =
      actor.role === UserRole.ADMIN
        ? { domain: 'refunds' }
        : actor.role === UserRole.IMPORTER
          ? { domain: 'refunds', ownerId: actor.id }
          : actor.role === UserRole.TRUCK_OWNER
            ? {
                domain: 'refunds',
                data: { path: ['truckOwnerId'], equals: actor.id },
              }
            : { domain: 'refunds', id: { in: [] } };
    const records = await this.prisma.operationsRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    });
    return records.map((record) => record.data as unknown as StoredRefund);
  }

  async create(actor: Actor, dto: CreateRefundDto) {
    if (actor.role !== UserRole.IMPORTER) {
      throw new ForbiddenException('Only importers can request a refund.');
    }
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: {
        payment: true,
        dispute: true,
        truck: { select: { ownerId: true, plateNumber: true } },
      },
    });
    if (!booking || booking.importerId !== actor.id) {
      throw new NotFoundException('Booking not found.');
    }
    if (booking.payment?.status !== BookingPaymentStatus.FUNDED) {
      throw new BadRequestException(
        'Only a payment still held in escrow can be refunded. This one has already been paid out or returned.',
      );
    }
    if (!REFUNDABLE_BOOKING_STATUSES.includes(booking.status)) {
      throw new BadRequestException(
        'A refund can be requested only for a paid booking that has not been completed.',
      );
    }
    if (booking.dispute?.status === DisputeStatus.RESOLVED) {
      throw new BadRequestException(
        'The dispute on this booking has already been decided.',
      );
    }
    if (dto.amountRwf > booking.payment.amountRwf) {
      throw new BadRequestException(
        `You paid ${booking.payment.amountRwf} RWF; the refund cannot be larger.`,
      );
    }
    const pending = await this.prisma.operationsRecord.count({
      where: { domain: 'refunds', parentId: booking.id, status: 'REQUESTED' },
    });
    if (pending) {
      throw new ConflictException(
        'A refund request for this booking is already waiting for a decision.',
      );
    }

    const now = new Date().toISOString();
    const refund: StoredRefund = {
      id: randomUUID(),
      ref: `RF-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      bookingId: booking.id,
      importerId: actor.id,
      truckOwnerId: booking.truck.ownerId,
      reason: dto.reason,
      details: dto.details,
      amountRwf: dto.amountRwf,
      refundTo: dto.refundTo,
      status: 'REQUESTED',
      source: 'DISPUTE',
      ownerNote: '',
      createdAt: now,
    };
    await this.prisma.$transaction(async (transaction) => {
      // A refund request is a dispute: freeze the trip so the payment cannot be released meanwhile.
      if (!booking.dispute) {
        await transaction.dispute.create({
          data: {
            bookingId: booking.id,
            raisedBy: actor.id,
            reason: `${dto.reason}: ${dto.details}`.slice(0, 2000),
          },
        });
      }
      await transaction.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.DISPUTED,
          trackingLatitude: null,
          trackingLongitude: null,
          trackingAccuracy: null,
          trackingUpdatedAt: null,
        },
      });
      await transaction.operationsRecord.create({
        data: {
          domain: 'refunds',
          recordId: refund.id,
          ownerId: actor.id,
          parentId: booking.id,
          status: refund.status,
          searchText: `${refund.ref} ${refund.reason} ${refund.details}`,
          data: refund,
        },
      });
    });

    const route = `${booking.pickupLocation} to ${booking.destination}`;
    const amount = `${dto.amountRwf.toLocaleString('en-US')} RWF`;
    await notify(this.prisma, [
      ...(await activeAdminIds(this.prisma)).map((userId) => ({
        userId,
        category: 'REFUND',
        title: 'Refund request to decide',
        body: `${refund.ref}: the importer asks for ${amount} back on ${route} (${booking.truck.plateNumber}). Reason: ${dto.reason}.`,
        href: `/dashboard/admin/refunds/${refund.id}`,
      })),
      {
        userId: booking.truck.ownerId,
        category: 'REFUND',
        title: 'Importer requested a refund',
        body: `The importer asks for ${amount} back on ${route}: ${dto.reason}. Give your side before an administrator decides; the payment stays in escrow until then.`,
        href: `/dashboard/owner/refunds/${refund.id}`,
      },
    ]);
    return refund;
  }

  /** The truck owner gives their side. They cannot decide; an administrator does. */
  async respond(actor: Actor, id: string, dto: RespondRefundDto) {
    const { record, refund } = await this.find(id);
    if (
      actor.role !== UserRole.TRUCK_OWNER ||
      refund.truckOwnerId !== actor.id
    ) {
      throw new ForbiddenException(
        'Only the truck owner on this booking can respond.',
      );
    }
    if (refund.status !== 'REQUESTED') {
      throw new BadRequestException('This refund request has been decided.');
    }
    const updated: StoredRefund = {
      ...refund,
      ownerNote: dto.response,
      ownerRespondedAt: new Date().toISOString(),
    };
    await this.save(record.id, updated);
    await notify(
      this.prisma,
      (await activeAdminIds(this.prisma)).map((userId) => ({
        userId,
        category: 'REFUND',
        title: 'Truck owner responded to a refund request',
        body: `${refund.ref}: "${dto.response}"`,
        href: `/dashboard/admin/refunds/${refund.id}`,
      })),
    );
    return updated;
  }

  /**
   * An administrator decides. Approving refunds the money from escrow to the importer's wallet and
   * closes the booking and dispute; rejecting leaves the dispute open for another decision.
   */
  async decide(actor: Actor, id: string, dto: DecideRefundDto) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only an administrator can decide a refund request.',
      );
    }
    const { record, refund } = await this.find(id);
    if (refund.status !== 'REQUESTED') {
      throw new BadRequestException('This refund request has been decided.');
    }

    if (dto.status === 'APPROVED') {
      // Moves the money and closes this request in the same transaction.
      await this.bookings.settleDispute(actor, refund.bookingId, {
        refundRwf: dto.amountRwf ?? refund.amountRwf,
        resolutionNotes: dto.note,
      });
      return (await this.find(id)).refund;
    }

    const updated: StoredRefund = {
      ...refund,
      status: 'REJECTED',
      decisionNote: dto.note,
      decidedBy: actor.id,
      resolvedAt: new Date().toISOString(),
    };
    await this.save(record.id, updated);
    await notify(this.prisma, [
      {
        userId: refund.importerId,
        category: 'REFUND',
        title: 'Refund request rejected',
        body: `${refund.ref} was not approved: ${dto.note}`,
        href: `/dashboard/importer/payments/${refund.bookingId}`,
      },
      {
        userId: refund.truckOwnerId,
        category: 'REFUND',
        title: 'Refund request rejected',
        body: `${refund.ref} was not approved. The dispute stays open until an administrator decides the payment.`,
        href: `/dashboard/owner/refunds/${refund.id}`,
      },
    ]);
    return updated;
  }

  private async find(id: string) {
    const record = await this.prisma.operationsRecord.findUnique({
      where: { domain_recordId: { domain: 'refunds', recordId: id } },
    });
    if (!record) throw new NotFoundException('Refund request not found.');
    return { record, refund: record.data as unknown as StoredRefund };
  }

  private save(recordId: string, refund: StoredRefund) {
    return this.prisma.operationsRecord.update({
      where: { id: recordId },
      data: {
        status: refund.status,
        data: refund,
      },
    });
  }
}
