import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  decodeDataUrl,
  ImageCache,
  type DecodedFile,
} from '../common/data-url';
import { PrismaService } from '../prisma/prisma.service';
import { UserSessionCache } from '../prisma/user-session-cache';

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  location: true,
  company: true,
  photo: true,
  active: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  private readonly photos = new ImageCache(200);

  constructor(
    private prisma: PrismaService,
    private sessions: UserSessionCache = new UserSessionCache(),
  ) {}

  /**
   * Profile photos are stored inline and are large, so the list points each one at
   * GET /users/:id/photo instead of carrying it.
   */
  async findAll() {
    const [users, photos] = await Promise.all([
      this.prisma.user.findMany({
        select: { ...userSelect, photo: false, updatedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.$queryRaw<
        { id: string; inline: boolean; plain: string | null }[]
      >`
        SELECT id,
          COALESCE(photo LIKE 'data:%', false) AS inline,
          CASE WHEN photo LIKE 'data:%' THEN NULL ELSE NULLIF(photo, '') END AS plain
        FROM "User"
      `,
    ]);
    const photoById = new Map(photos.map((row) => [row.id, row]));
    return users.map(({ updatedAt, ...user }) => {
      const stored = photoById.get(user.id);
      return {
        ...user,
        photo: stored?.inline
          ? `/users/${user.id}/photo?v=${updatedAt.getTime()}`
          : (stored?.plain ?? null),
      };
    });
  }

  /** One user's profile photo as an image. */
  async photo(userId: string, version: string): Promise<DecodedFile> {
    const key = `${userId}:${version}`;
    const cached = this.photos.get(key);
    if (cached) return cached;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { photo: true },
    });
    const photo = decodeDataUrl(user?.photo);
    if (!photo) throw new NotFoundException('Photo not found.');
    this.photos.set(key, photo);
    return photo;
  }

  async updateStatus(
    userId: string,
    requestingAdminId: string,
    active: boolean,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Admin accounts cannot be deactivated.');
    }
    if (userId === requestingAdminId && !active) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { active },
      select: userSelect,
    });
    this.sessions.invalidate(userId);
    return updated;
  }

  async remove(userId: string, requestingAdminId: string) {
    if (userId === requestingAdminId) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Admin accounts cannot be deleted.');
    }

    return this.prisma
      .$transaction(async (transaction) => {
        const [bookingCount, disputeCount] = await Promise.all([
          transaction.booking.count({
            where: {
              OR: [{ importerId: userId }, { truck: { ownerId: userId } }],
            },
          }),
          transaction.dispute.count({ where: { raisedBy: userId } }),
        ]);
        if (bookingCount > 0 || disputeCount > 0) {
          throw new ConflictException(
            'This user has booking or dispute history and cannot be deleted. Deactivate the account instead.',
          );
        }

        const wallet = await transaction.wallet.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (wallet) {
          await transaction.walletTransaction.deleteMany({
            where: { walletId: wallet.id },
          });
        }

        await transaction.user.delete({ where: { id: userId } });
        return { id: userId };
      })
      .then((result) => {
        this.sessions.invalidate(userId);
        return result;
      });
  }
}
