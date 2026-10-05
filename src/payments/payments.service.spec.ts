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
    if (originalEnvironment.paymentsMode === undefined) delete process.env.PAYMENTS_MODE;
    else process.env.PAYMENTS_MODE = originalEnvironment.paymentsMode;
  });

  it('keeps payments simulated in production even if live mode is configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENTS_MODE = 'flutterwave';

    await expect(service.getRwandaBanks()).resolves.toEqual([
      { id: 'MOCK_BANK', code: 'MOCK_BANK', name: 'Simulation bank' },
    ]);
  });
});