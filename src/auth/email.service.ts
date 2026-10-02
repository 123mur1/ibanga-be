import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import nodemailer, { type Transporter } from 'nodemailer';
import { rootCertificates } from 'tls';

function acceptedRecipients(result: unknown): string[] {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('accepted' in result)
  ) {
    return [];
  }

  const accepted: unknown = result.accepted;
  if (!Array.isArray(accepted)) return [];

  return accepted.reduce<string[]>((addresses, recipient: unknown) => {
    if (typeof recipient === 'string') {
      addresses.push(recipient);
    } else if (
      typeof recipient === 'object' &&
      recipient !== null &&
      'address' in recipient &&
      typeof recipient.address === 'string'
    ) {
      addresses.push(recipient.address);
    }
    return addresses;
  }, []);
}
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  assertConfigured() {
    const required = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM',
      'FRONTEND_URL',
    ];

    if (required.some((name) => !process.env[name])) {
      throw new ServiceUnavailableException(
        'Password reset email is not configured.',
      );
    }

    const port = Number(process.env.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ServiceUnavailableException(
        'Password reset email is not configured.',
      );
    }
  }

  async sendPasswordResetEmail(to: string, resetUrl: string) {
    this.assertConfigured();

    const transporter = this.getTransporter();
    const fromAddress = process.env.SMTP_FROM!;
    const fromName = process.env.SMTP_FROM_NAME || 'iBanga';

    const result: unknown = await transporter.sendMail({
      from: { name: fromName, address: fromAddress },
      to,
      subject: 'Reset your iBanga password',
      text: `We received a request to reset your iBanga password. Use this link within one hour: ${resetUrl} If you did not request this, you can ignore this email.`,
      html: `<p>We received a request to reset your iBanga password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in one hour. If you did not request this, you can ignore this email.</p>`,
    });

    const recipientAccepted = acceptedRecipients(result).some(
      (recipient) => recipient.toLowerCase() === to.toLowerCase(),
    );
    if (!recipientAccepted) {
      throw new Error('SMTP server did not accept the reset email recipient.');
    }

    this.logger.log('SMTP server accepted a password reset email.');
  }

  private getTransporter() {
    if (this.transporter) return this.transporter;

    const port = Number(process.env.SMTP_PORT);
    const secure =
      process.env.SMTP_SECURE?.toLowerCase() === 'true' || port === 465;
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port,
      secure,
      requireTLS: port === 587,
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
      tls: {
        rejectUnauthorized: true,
        ...(process.env.SMTP_TLS_CA_PATH
          ? {
              ca: [
                ...rootCertificates,
                readFileSync(process.env.SMTP_TLS_CA_PATH),
              ],
            }
          : {}),
      },
    });

    return this.transporter;
  }
}
