import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { BookingsService } from '../bookings/bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefundsService, type StoredRefund } from './refunds.service';

const importer = { id: 'importer-1', role: UserRole.IMPORTER };
const owner = { id: 'owner-1', role: UserRole.TRUCK_OWNER };
const admin = { id: 'admin-1', role: UserRole.ADMIN };

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b0000000-0000-4000-8000-000000000001',
    importerId: importer.id,
    status: 'DELIVERED',
    pickupLocation: 'Kigali',
    destination: 'Musanze',
    payment: { status: 'FUNDED', amountRwf: 100_000 },
    dispute: null,
    truck: { ownerId: owner.id, plateNumber: 'RAD 123A' },
    ...overrides,
  };
}

const request = {
  bookingId: 'b0000000-0000-4000-8000-000000000001',
  reason: 'Cargo was damaged or lost',
  details: 'Two pallets arrived crushed and soaked.',
  amountRwf: 100_000,
  refundTo: 'MTN MoMo · 078 ••• 220',
};

function stored(overrides: Partial<StoredRefund> = {}): StoredRefund {
  return {
    id: 'refund-1',
    ref: 'RF-2026-ABCD1234',
    bookingId: request.bookingId,
    importerId: importer.id,
    truckOwnerId: owner.id,
    reason: request.reason,
    details: request.details,
    amountRwf: 100_000,
    refundTo: request.refundTo,
    status: 'REQUESTED',
    source: 'DISPUTE',
    ownerNote: '',
    createdAt: '2026-10-28T08:00:00.000Z',
    ...overrides,
  };
}

describe('RefundsService', () => {
  let prisma: {
    booking: { findUnique: jest.Mock; update: jest.Mock };
    dispute: { create: jest.Mock };
    user: { findMany: jest.Mock };
    operationsRecord: {
      count: jest.Mock;
      create: jest.Mock;
      createMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let bookings: { settleDispute: jest.Mock };
  let service: RefundsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn().mockResolvedValue(booking()),
        update: jest.fn().mockResolvedValue({}),
      },
      dispute: { create: jest.fn().mockResolvedValue({}) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: admin.id }]) },
      operationsRecord: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'record-1', data: stored() }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(
        (run: (client: typeof prisma) => Promise<unknown>) => run(prisma),
      ),
    };
    bookings = { settleDispute: jest.fn().mockResolvedValue({}) };
    service = new RefundsService(
      prisma as unknown as PrismaService,
      bookings as unknown as BookingsService,
    );
  });

  describe('importer request', () => {
    it('opens a dispute so the payment stays in escrow, and alerts admins and the owner', async () => {
      const refund = await service.create(importer, request);

      expect(refund).toMatchObject({ status: 'REQUESTED', amountRwf: 100_000 });
      expect(prisma.dispute.create).toHaveBeenCalled();
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DISPUTED' }) as unknown,
        }),
      );
      const notified = (
        prisma.operationsRecord.createMany.mock.calls[0] as [
          { data: { ownerId: string }[] },
        ]
      )[0].data.map((notice) => notice.ownerId);
      expect(notified).toEqual([admin.id, owner.id]);
    });

    it('refuses once the money has left escrow', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        booking({ payment: { status: 'RELEASED', amountRwf: 100_000 } }),
      );

      await expect(service.create(importer, request)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses more than was paid', async () => {
      await expect(
        service.create(importer, { ...request, amountRwf: 100_001 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows only one open request per booking', async () => {
      prisma.operationsRecord.count.mockResolvedValue(1);

      await expect(service.create(importer, request)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  it('lets the truck owner give their side, but not decide', async () => {
    const updated = await service.respond(owner, 'refund-1', {
      response: 'The pallets were already damaged at pickup.',
    });
    expect(updated.ownerNote).toBe(
      'The pallets were already damaged at pickup.',
    );

    await expect(
      service.decide(owner, 'refund-1', {
        status: 'APPROVED',
        note: 'Owner approves',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refunds from escrow when an administrator approves', async () => {
    await service.decide(admin, 'refund-1', {
      status: 'APPROVED',
      note: 'Damage confirmed by photos.',
      amountRwf: 60_000,
    });

    expect(bookings.settleDispute).toHaveBeenCalledWith(
      admin,
      request.bookingId,
      { refundRwf: 60_000, resolutionNotes: 'Damage confirmed by photos.' },
    );
  });

  it('keeps the money in escrow when an administrator rejects', async () => {
    const result = await service.decide(admin, 'refund-1', {
      status: 'REJECTED',
      note: 'The damage was reported after unloading.',
    });

    expect(result.status).toBe('REJECTED');
    expect(bookings.settleDispute).not.toHaveBeenCalled();
  });
});
