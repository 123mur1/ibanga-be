import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

type TestTransaction = {
  booking: { count: jest.Mock<Promise<number>, [unknown]> };
  dispute: { count: jest.Mock<Promise<number>, [unknown]> };
  wallet: {
    findUnique: jest.Mock<Promise<{ id: string } | null>, [unknown]>;
  };
  walletTransaction: {
    deleteMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
  user: { delete: jest.Mock<Promise<{ id: string }>, [unknown]> };
};

type TestPrisma = {
  user: {
    findUnique: jest.Mock<
      Promise<{ id: string; role: string } | null>,
      [unknown]
    >;
    update: jest.Mock<Promise<{ id: string; active: boolean }>, [unknown]>;
  };
  $transaction: jest.Mock<
    Promise<unknown>,
    [
      (
        callback: (transaction: TestTransaction) => Promise<unknown>,
      ) => Promise<unknown>,
    ]
  >;
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: TestPrisma;
  let transaction: TestTransaction;

  beforeEach(() => {
    transaction = {
      booking: {
        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
      },
      dispute: {
        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
      },
      wallet: {
        findUnique: jest
          .fn<Promise<{ id: string } | null>, [unknown]>()
          .mockResolvedValue({ id: 'wallet-1' }),
      },
      walletTransaction: {
        deleteMany: jest
          .fn<Promise<{ count: number }>, [unknown]>()
          .mockResolvedValue({ count: 2 }),
      },
      user: {
        delete: jest
          .fn<Promise<{ id: string }>, [unknown]>()
          .mockResolvedValue({ id: 'user-1' }),
      },
    };
    prisma = {
      user: {
        findUnique: jest
          .fn<Promise<{ id: string; role: string } | null>, [unknown]>()
          .mockResolvedValue({ id: 'user-1', role: 'IMPORTER' }),
        update: jest
          .fn<Promise<{ id: string; active: boolean }>, [unknown]>()
          .mockResolvedValue({ id: 'user-1', active: false }),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('deletes wallet transactions before deleting an account without marketplace history', async () => {
    await expect(service.remove('user-1', 'admin-1')).resolves.toEqual({
      id: 'user-1',
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(transaction.walletTransaction.deleteMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1' },
    });
    expect(transaction.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
    const transactionDeleteOrder =
      transaction.walletTransaction.deleteMany.mock.invocationCallOrder[0];
    const userDeleteOrder = transaction.user.delete.mock.invocationCallOrder[0];
    expect(transactionDeleteOrder).toBeDefined();
    expect(userDeleteOrder).toBeDefined();
    expect(transactionDeleteOrder).toBeLessThan(userDeleteOrder ?? 0);
  });

  it('preserves users with booking history and directs admins to deactivate them', async () => {
    transaction.booking.count.mockResolvedValue(1);

    await expect(service.remove('user-1', 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction.walletTransaction.deleteMany).not.toHaveBeenCalled();
    expect(transaction.user.delete).not.toHaveBeenCalled();
  });

  it('updates active status and does not allow an admin to deactivate themself', async () => {
    await expect(
      service.updateStatus('user-1', 'admin-1', false),
    ).resolves.toEqual({
      id: 'user-1',
      active: false,
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { active: false },
      }),
    );

    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'admin-1',
      role: 'ADMIN',
    });
    await expect(
      service.updateStatus('admin-1', 'admin-1', false),
    ).rejects.toThrow('Admin accounts cannot be deactivated.');
  });
});
