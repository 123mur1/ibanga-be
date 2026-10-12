import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PaymentsService', () => {
  const originalEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    paymentsMode: process.env.PAYMENTS_MODE,
  };
  const service = new PaymentsService({} as PrismaService);

  afterEach(() => {
    if (originalEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment.nodeEnv;
    if (originalEnvironment.paymentsMode === undefined)
      delete process.env.PAYMENTS_MODE;
    else process.env.PAYMENTS_MODE = originalEnvironment.paymentsMode;
  });

  it('keeps payments simulated in production even if live mode is configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENTS_MODE = 'flutterwave';

    await expect(service.getRwandaBanks()).resolves.toEqual([
      { id: 'MOCK_BANK', code: 'MOCK_BANK', name: 'Simulation bank' },
    ]);
  });

  it('returns every account with its stored balance and wallet transactions', async () => {
    const records: {
      id: string;
      name: string;
      email: string;
      role: string;
      wallet: {
        balanceRwf: number;
        transactions: { id: string; amountRwf: number }[];
      } | null;
    }[] = [
      {
        id: 'user-1',
        name: 'Importer One',
        email: 'importer@example.com',
        role: 'IMPORTER',
        wallet: {
          balanceRwf: 15000,
          transactions: [{ id: 'transaction-1', amountRwf: 5000 }],
        },
      },
      {
        id: 'user-2',
        name: 'Truck Owner',
        email: 'owner@example.com',
        role: 'TRUCK_OWNER',
        wallet: null,
      },
    ];
    const findMany = jest
      .fn<Promise<typeof records>, []>()
      .mockResolvedValue(records);
    const payments = new PaymentsService({
      user: { findMany },
    } as unknown as PrismaService);

    await expect(payments.getAdminWalletAccounts()).resolves.toEqual([
      {
        userId: 'user-1',
        name: 'Importer One',
        email: 'importer@example.com',
        role: 'IMPORTER',
        balanceRwf: 15000,
        transactions: [{ id: 'transaction-1', amountRwf: 5000 }],
      },
      {
        userId: 'user-2',
        name: 'Truck Owner',
        email: 'owner@example.com',
        role: 'TRUCK_OWNER',
        balanceRwf: 0,
        transactions: [],
      },
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('returns commission totals and monthly release history from stored payments', async () => {
    const releasedAt = new Date();
    const walletUpsert = jest
      .fn<Promise<{ balanceRwf: number }>, [unknown]>()
      .mockResolvedValue({ balanceRwf: 180000 });
    const aggregate = jest
      .fn<Promise<{ _sum: { commissionRwf: number | null } }>, [unknown]>()
      .mockResolvedValue({ _sum: { commissionRwf: 1380000 } });
    const findMany = jest
      .fn<
        Promise<{ commissionRwf: number; releasedAt: Date | null }[]>,
        [unknown]
      >()
      .mockResolvedValue([{ commissionRwf: 1380000, releasedAt }]);
    const payments = new PaymentsService({
      wallet: { upsert: walletUpsert },
      bookingPayment: { aggregate, findMany },
    } as unknown as PrismaService);

    const result = await payments.getAdminCommission({
      id: 'admin-1',
      role: 'ADMIN',
    });
    const currentMonth = releasedAt.toISOString().slice(0, 7);

    expect(result).toMatchObject({
      availableRwf: 180000,
      totalEarnedRwf: 1380000,
      currency: 'RWF',
    });
    expect(result.monthlyHistory).toHaveLength(6);
    expect(
      result.monthlyHistory.find(({ month }) => month === currentMonth),
    ).toEqual({
      month: currentMonth,
      totalRwf: 1380000,
    });
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('allows the admin wallet owner to withdraw available funds to the ledger', async () => {
    const walletUpsert = jest
      .fn<Promise<{ id: string; balanceRwf: number }>, [unknown]>()
      .mockResolvedValue({ id: 'admin-wallet', balanceRwf: 180000 });
    const findUser = jest
      .fn<Promise<{ id: string } | null>, [unknown]>()
      .mockResolvedValue({ id: 'admin-1' });
    const queryRaw = jest.fn(() => Promise.resolve([{ id: 'withdrawal-1' }]));
    const updateTransaction = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const findTransaction = jest
      .fn<Promise<{ id: string }>, [unknown]>()
      .mockResolvedValue({ id: 'withdrawal-1' });
    const payments = new PaymentsService({
      wallet: { upsert: walletUpsert },
      user: { findUnique: findUser },
      $queryRaw: queryRaw,
      walletTransaction: {
        update: updateTransaction,
        findUniqueOrThrow: findTransaction,
      },
    } as unknown as PrismaService);

    await expect(
      payments.createWithdrawal('admin-1', {
        amountRwf: 50000,
        method: 'MOBILE_MONEY',
        beneficiaryName: 'Admin User',
        phoneNumber: '0780000000',
      }),
    ).resolves.toEqual({ id: 'withdrawal-1' });

    expect(walletUpsert).toHaveBeenCalledWith({
      where: { userId: 'admin-1' },
      create: { userId: 'admin-1' },
      update: {},
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(updateTransaction).toHaveBeenCalledTimes(1);
    expect(findTransaction).toHaveBeenCalledTimes(1);
  });
});
