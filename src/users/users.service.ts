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

    const [bookingCount, disputeCount] = await Promise.all([
      this.prisma.booking.count({
        where: {
          OR: [{ importerId: userId }, { truck: { ownerId: userId } }],
        },
      }),
      this.prisma.dispute.count({ where: { raisedBy: userId } }),
    ]);
    if (bookingCount > 0 || disputeCount > 0) {
      throw new ConflictException(
        'This user has booking or dispute history and cannot be deleted. Suspend the account instead.',
      );
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { id: userId };
  }
}
