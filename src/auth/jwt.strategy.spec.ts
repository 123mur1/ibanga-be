import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  it('rejects existing tokens when the user account has been deactivated', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          active: false,
        }),
      },
    } as unknown as PrismaService;
    const strategy = new JwtStrategy(prisma);

    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'user@example.com',
        role: 'IMPORTER',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
