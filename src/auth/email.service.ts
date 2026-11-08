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
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  /** Whether SMTP is set up, without throwing: notification email is skipped when it is not. */
  isConfigured() {
    try {
      this.assertConfigured();
      return true;
    } catch {
      return false;
    }
  }

  /** One activity email, mirroring an in-app notification, with a link to open it in iBanga. */
  async sendNotificationEmail(input: {
    to: string;
    name: string;
    title: string;
    body: string;
    url: string;
  }) {
    this.assertConfigured();
    const fromName = process.env.SMTP_FROM_NAME || 'iBanga';
    const greeting = `Hello ${input.name.trim() || 'there'},`;
    const footer =
      'You are receiving this because of activity on your iBanga account.';
    const result: unknown = await this.getTransporter().sendMail({
      from: { name: fromName, address: process.env.SMTP_FROM! },
      to: input.to,
      subject: `${input.title} | iBanga`,
      text: `${greeting}

${input.body}

Open in iBanga: ${input.url}

${footer}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2933;line-height:1.5">
<p style="font-size:18px;font-weight:bold;margin:0 0 16px">${escapeHtml(input.title)}</p>
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(input.body)}</p>
<p style="margin:24px 0"><a href="${escapeHtml(input.url)}" style="background:#1f6feb;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open in iBanga</a></p>
<p style="font-size:12px;color:#6b7280">${footer}</p>
</div>`,
    });
    const accepted = acceptedRecipients(result).some(
      (recipient) => recipient.toLowerCase() === input.to.toLowerCase(),
    );
    if (!accepted) {
      throw new Error('SMTP server did not accept the notification recipient.');
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
    const smtpHost = process.env.SMTP_HOST!;
    const smtpPassword = process.env.SMTP_PASS!.trim();
    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure,
      requireTLS: port === 587,
      auth: {
        user: process.env.SMTP_USER!,
        pass:
          smtpHost.toLowerCase() === 'smtp.gmail.com'
            ? smtpPassword.replace(/\s+/g, '')
            : smtpPassword,
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
