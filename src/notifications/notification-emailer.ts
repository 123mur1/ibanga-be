import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EmailService } from '../auth/email.service';
import { type Notice, registerNoticeMailer } from '../common/notify';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Emails every in-app notification to its recipient. Sending happens after the request has
 * answered, and a failed email is logged, never thrown: the notification is already saved.
 */
@Injectable()
export class NotificationEmailer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationEmailer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  onModuleInit() {
    if (!this.email.isConfigured()) {
      this.logger.warn(
        'SMTP is not configured: notifications are shown in the app but not emailed.',
      );
      return;
    }
    registerNoticeMailer((notices) => {
      this.send(notices).catch((error: unknown) =>
        this.logger.error(`Notification email failed: ${String(error)}`),
      );
    });
  }

  onModuleDestroy() {
    registerNoticeMailer(null);
  }

  async send(notices: Notice[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(notices.map((n) => n.userId))] } },
      select: { id: true, name: true, email: true, active: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    const frontend = (process.env.FRONTEND_URL ?? '').replace(/\/+$/, '');

    const results = await Promise.allSettled(
      notices.map((notice) => {
        const user = byId.get(notice.userId);
        if (!user?.active || !user.email) return Promise.resolve();
        return this.email.sendNotificationEmail({
          to: user.email,
          name: user.name,
          title: notice.title,
          body: notice.body,
          url: `${frontend}${notice.href}`,
        });
      }),
    );
    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failed.length) {
      this.logger.error(
        `${failed.length} of ${notices.length} notification emails failed: ${String(failed[0].reason)}`,
      );
    }
  }
}
