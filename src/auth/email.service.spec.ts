import nodemailer from 'nodemailer';
import { EmailService } from './email.service';

describe('EmailService', () => {
  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_USER = 'sender@example.com';
    process.env.SMTP_PASS = 'test-app-password';
    process.env.SMTP_FROM = 'sender@example.com';
    process.env.SMTP_FROM_NAME = 'iBanga';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    delete process.env.SMTP_TLS_CA_PATH;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends reset mail through the configured Gmail SMTP transport', async () => {
    const sendMail = jest.fn().mockResolvedValue({
      messageId: 'test-message',
      accepted: ['user@example.com'],
      rejected: [],
    });
    const createTransport = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as never);
    const service = new EmailService();

    await service.sendPasswordResetEmail(
      'user@example.com',
      'http://localhost:3000/reset-password?token=test-token',
    );

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      requireTLS: false,
      auth: {
        user: 'sender@example.com',
        pass: 'test-app-password',
      },
      tls: { rejectUnauthorized: true },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'iBanga', address: 'sender@example.com' },
        to: 'user@example.com',
        subject: 'Reset your iBanga password',
      }),
    );
  });

  it('rejects delivery when SMTP does not accept the recipient', async () => {
    const sendMail = jest.fn().mockResolvedValue({
      accepted: [],
      rejected: ['user@example.com'],
    });
    jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as never);

    await expect(
      new EmailService().sendPasswordResetEmail(
        'user@example.com',
        'http://localhost:3000/reset-password?token=test-token',
      ),
    ).rejects.toThrow('SMTP server did not accept the reset email recipient.');
  });

  it('rejects incomplete SMTP configuration', () => {
    delete process.env.SMTP_PASS;

    expect(() => new EmailService().assertConfigured()).toThrow(
      'Password reset email is not configured.',
    );
  });
});
