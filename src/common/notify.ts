import { randomUUID } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type Notice = {
  userId: string;
  category: string;
  title: string;
  body: string;
  href: string;
  /** Extra words to find the notice by in search, such as a booking id. */
  searchText?: string;
};

type Client = PrismaService | Prisma.TransactionClient;

/**
 * Sends each notice by email too. It is registered once at startup by NotificationEmailer, so
 * services built by hand in tests send no email.
 */
type NoticeMailer = (notices: Notice[]) => void;
let mailer: NoticeMailer | null = null;

export function registerNoticeMailer(next: NoticeMailer | null) {
  mailer = next;
}

/**
 * In-app notifications, stored where the notifications page reads them, and emailed to each
 * recipient. Call it only after the change it reports is saved: the email goes out at once.
 */
export async function notify(prisma: Client, notices: Notice[]) {
  if (!notices.length) return;
  const createdAt = new Date().toISOString();
  await prisma.operationsRecord.createMany({
    data: notices.map(({ userId, category, title, body, href, searchText }) => {
      const id = randomUUID();
      return {
        domain: 'notifications',
        recordId: id,
        ownerId: userId,
        searchText: [title, body, searchText].filter(Boolean).join(' '),
        data: {
          id,
          userId,
          category,
          title,
          body,
          href,
          read: false,
          createdAt,
        },
      };
    }),
  });
  mailer?.(notices);
}

/** Every active administrator, for notices they must act on. */
export async function activeAdminIds(prisma: Client): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN, active: true },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}
