import { randomUUID } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type Notice = {
  userId: string;
  category: string;
  title: string;
  body: string;
  href: string;
};

type Client = PrismaService | Prisma.TransactionClient;

/** In-app notifications, stored where the notifications page reads them. */
export async function notify(prisma: Client, notices: Notice[]) {
  if (!notices.length) return;
  const createdAt = new Date().toISOString();
  await prisma.operationsRecord.createMany({
    data: notices.map(({ userId, category, title, body, href }) => {
      const id = randomUUID();
      return {
        domain: 'notifications',
        recordId: id,
        ownerId: userId,
        searchText: `${title} ${body}`,
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
}

/** Every active administrator, for notices they must act on. */
export async function activeAdminIds(prisma: Client): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN, active: true },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}
