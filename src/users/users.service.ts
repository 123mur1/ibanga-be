import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
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

    return this.prisma.user.update({
      where: { id: userId },
      data: { active },
      select: userSelect,
    });
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

    return this.prisma.$transaction(async (transaction) => {
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
    });
  }
}
