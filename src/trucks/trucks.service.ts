import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, TruckStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTruckDto } from './dto/create-truck.dto';
import { QueryTrucksDto } from './dto/query-trucks.dto';
import { UpdateTruckDto } from './dto/update-truck.dto';

const OWNER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  location: true,
  photo: true,
} as const;

const TRUCK_INCLUDE = { owner: { select: OWNER_SELECT } } as const;

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.DELIVERED,
  BookingStatus.DISPUTED,
];

@Injectable()
export class TrucksService {
  constructor(private prisma: PrismaService) {}

  create(ownerId: string, dto: CreateTruckDto) {
    return this.prisma.truck.create({
      data: { ...dto, ownerId },
      include: TRUCK_INCLUDE,
    });
  }

  findAll(
    userId: string | undefined,
    userRole: UserRole | undefined,
    query: QueryTrucksDto,
  ) {
    if (query.mine) {
      if (!userId || userRole !== UserRole.TRUCK_OWNER) {
        throw new ForbiddenException(
          'Only truck owners can view their own fleet.',
        );
      }
      return this.prisma.truck.findMany({
        where: { ownerId: userId },
        include: TRUCK_INCLUDE,
        orderBy: { createdAt: 'desc' },
      });
    }

    return this.prisma.truck.findMany({
      where: {
        status: TruckStatus.AVAILABLE,
        ...(query.location
          ? { currentLocation: { equals: query.location, mode: 'insensitive' } }
          : {}),
        ...(query.truckType
          ? { truckType: { equals: query.truckType, mode: 'insensitive' } }
          : {}),
        ...(query.route
          ? { preferredRoute: { contains: query.route, mode: 'insensitive' } }
          : {}),
        ...(query.minCapacity ? { capacity: { gte: query.minCapacity } } : {}),
      },
      include: TRUCK_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const truck = await this.prisma.truck.findUnique({
      where: { id },
      include: TRUCK_INCLUDE,
    });
    if (!truck) throw new NotFoundException('Truck not found.');
    return truck;
  }

  private async findOwned(id: string, ownerId: string) {
    const truck = await this.prisma.truck.findUnique({ where: { id } });
    if (!truck) throw new NotFoundException('Truck not found.');
    if (truck.ownerId !== ownerId) {
      throw new ForbiddenException('You can only manage your own trucks.');
    }
    return truck;
  }

  private hasActiveBooking(truckId: string) {
    return this.prisma.booking.findFirst({
      where: { truckId, status: { in: ACTIVE_BOOKING_STATUSES } },
    });
  }

  async update(id: string, ownerId: string, dto: UpdateTruckDto) {
    await this.findOwned(id, ownerId);
    return this.prisma.truck.update({
      where: { id },
      data: dto,
      include: TRUCK_INCLUDE,
    });
  }

  async remove(id: string, ownerId: string) {
    await this.findOwned(id, ownerId);
    const active = await this.hasActiveBooking(id);
    if (active) {
      throw new ForbiddenException(
        'Cannot delete a truck with an active booking.',
      );
    }
    await this.prisma.truck.delete({ where: { id } });
    return { id };
  }

  async setAvailability(id: string, ownerId: string, status: TruckStatus) {
    await this.findOwned(id, ownerId);
    if (status === TruckStatus.AVAILABLE) {
      const active = await this.hasActiveBooking(id);
      if (active) {
        throw new ForbiddenException(
          'This truck has an active trip. It becomes available only after the importer confirms receipt, or after admin resolves a dispute.',
        );
      }
    }
    return this.prisma.truck.update({
      where: { id },
      data: { status },
      include: TRUCK_INCLUDE,
    });
  }
}
