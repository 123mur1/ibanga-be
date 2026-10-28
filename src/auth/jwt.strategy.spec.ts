import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserSessionCache } from '../prisma/user-session-cache';
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
    const strategy = new JwtStrategy(prisma, new UserSessionCache());

    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'user@example.com',
        role: 'IMPORTER',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
