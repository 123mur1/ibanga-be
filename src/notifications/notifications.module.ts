import { Module } from '@nestjs/common';
import { EmailService } from '../auth/email.service';
import { NotificationEmailer } from './notification-emailer';

/** Turns on email for every in-app notification (see notify in common/notify.ts). */
@Module({
  providers: [EmailService, NotificationEmailer],
})
export class NotificationsModule {}
