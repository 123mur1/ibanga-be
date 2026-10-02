import { AuthService } from './auth.service';

describe('AuthService password reset', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;
  let email: any;

  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_USER = 'sender@example.com';
    process.env.SMTP_PASS = 'test-app-password';
    process.env.SMTP_FROM = 'sender@example.com';
    process.env.FRONTEND_URL = 'http://localhost:3000';

    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      passwordResetToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    jwt = {
      sign: jest.fn(),
    };

    email = {
      assertConfigured: jest.fn(),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(prisma, jwt, email);
  });

  it('requests a password reset for an existing user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'demo@example.com' });
    prisma.passwordResetToken.create.mockResolvedValue({ id: 'token-1', userId: 'user-1' });

    const result = await service.requestPasswordReset('demo@example.com');

    expect(result.message).toContain('password reset');
    expect(result).not.toHaveProperty('resetToken');
    expect(email.assertConfigured).toHaveBeenCalled();
    expect(email.sendPasswordResetEmail).toHaveBeenCalledWith(
      'demo@example.com',
      expect.stringContaining('http://localhost:3000/reset-password?token='),
    );
    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
  });

  it('removes the new token when SMTP rejects the email', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'demo@example.com' });
    prisma.passwordResetToken.create.mockResolvedValue({ id: 'token-1', userId: 'user-1' });
    email.sendPasswordResetEmail.mockRejectedValue(new Error('SMTP rejected'));
    jest.spyOn((service as any).logger, 'error').mockImplementation();

    const result = await service.requestPasswordReset('demo@example.com');

    expect(result).not.toHaveProperty('resetToken');
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String) },
    });
  });

  it('resets a password when the token is valid', async () => {
    const token = 'plain-token';
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { id: 'user-1' },
    });
    prisma.user.update.mockResolvedValue({ id: 'user-1' });
    prisma.passwordResetToken.update.mockResolvedValue({ id: 'token-1' });

    const result = await service.resetPassword(token, 'NewPassword123');

    expect(result.message).toBe('Password reset successful.');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          passwordHash: expect.any(String),
        }),
      }),
    );
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'token-1' },
        data: expect.objectContaining({
          usedAt: expect.any(Date),
        }),
      }),
    );
  });
});
