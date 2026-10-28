import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

/** A held 100,000 RWF payment with the 6% commission taken at payment time. */
function heldPayment(status = 'FUNDED') {
  return {
    bookingId: 'booking-1',
    status,
    amountRwf: 100_000,
    commissionRwf: 6_000,
    ownerAmountRwf: 94_000,
    booking: { importerId: 'importer-1', truck: { ownerId: 'owner-1' } },
  };
}

describe('PaymentsService.settleHeldPayment', () => {
  let tx: {
    bookingPayment: { findUnique: jest.Mock; updateMany: jest.Mock };
    wallet: { upsert: jest.Mock };
    walletTransaction: { create: jest.Mock };
  };
  let service: PaymentsService;
  const closeBooking = jest.fn().mockResolvedValue(undefined);

  /** Amount credited to each user's wallet, by user id. */
  const credits = () =>
    Object.fromEntries(
      (
        tx.wallet.upsert.mock.calls as [
          { where: { userId: string }; create: { balanceRwf: number } },
        ][]
      ).map(([args]) => [args.where.userId, args.create.balanceRwf]),
    );

  beforeEach(() => {
    closeBooking.mockClear();
    tx = {
      bookingPayment: {
        findUnique: jest.fn().mockResolvedValue(heldPayment()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      wallet: {
        upsert: jest.fn((args: { where: { userId: string } }) =>
          Promise.resolve({ id: `wallet-${args.where.userId}` }),
        ),
      },
      walletTransaction: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin-1' }) },
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) =>
        run(tx),
      ),
    };
    service = new PaymentsService(prisma as unknown as PrismaService);
  });

  it('refunds the whole payment to the importer and pays nobody else', async () => {
    const result = await service.settleHeldPayment(
      'booking-1',
      100_000,
      closeBooking,
    );

    expect(result).toEqual({
      amountRwf: 100_000,
      refundRwf: 100_000,
      ownerAmountRwf: 0,
      commissionRwf: 0,
    });
    expect(credits()).toEqual({ 'importer-1': 100_000 });
    expect(tx.bookingPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: 'booking-1', status: 'FUNDED' },
        data: expect.objectContaining({ status: 'REFUNDED' }) as unknown,
      }),
    );
    expect(closeBooking).toHaveBeenCalledWith(tx);
  });

  it('splits a partial refund, taking commission only on the owner part', async () => {
    const result = await service.settleHeldPayment(
      'booking-1',
      40_000,
      closeBooking,
    );

    // Owner part 60,000 at 6% = 3,600 commission.
    expect(result).toMatchObject({
      ownerAmountRwf: 56_400,
      commissionRwf: 3_600,
    });
    expect(credits()).toEqual({
      'importer-1': 40_000,
      'owner-1': 56_400,
      'admin-1': 3_600,
    });
  });

  it('releases everything to the owner when nothing is refunded', async () => {
    await service.settleHeldPayment('booking-1', 0, closeBooking);

    expect(credits()).toEqual({ 'owner-1': 94_000, 'admin-1': 6_000 });
  });

  it('refuses a refund larger than what was paid', async () => {
    await expect(
      service.settleHeldPayment('booking-1', 100_001, closeBooking),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.wallet.upsert).not.toHaveBeenCalled();
  });

  it('refuses a payment that is no longer held', async () => {
    tx.bookingPayment.findUnique.mockResolvedValue(heldPayment('RELEASED'));

    await expect(
      service.settleHeldPayment('booking-1', 100_000, closeBooking),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.wallet.upsert).not.toHaveBeenCalled();
  });

  it('pays nothing out if another settlement claimed the payment first', async () => {
    tx.bookingPayment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.settleHeldPayment('booking-1', 100_000, closeBooking),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.wallet.upsert).not.toHaveBeenCalled();
    expect(closeBooking).not.toHaveBeenCalled();
  });
});
