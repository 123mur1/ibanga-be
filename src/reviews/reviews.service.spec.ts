import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  const importer = { id: 'importer-1', role: UserRole.IMPORTER };
  const input = {
    rating: 5,
    comment: 'Arrived on time and the driver was careful.',
  };
  let prisma: {
    truck: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    booking: { count: jest.Mock };
    operationsRecord: { create: jest.Mock; findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let service: ReviewsService;

  beforeEach(() => {
    prisma = {
      truck: { findUnique: jest.fn().mockResolvedValue({ id: 'truck-1' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Jeanine' }) },
      booking: { count: jest.fn().mockResolvedValue(1) },
      operationsRecord: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new ReviewsService(prisma as unknown as PrismaService);
  });

  it('stores one review per importer and truck', async () => {
    const review = await service.create(importer, 'truck-1', input);

    expect(review).toMatchObject({
      id: 'truck-1:importer-1',
      truckId: 'truck-1',
      authorId: 'importer-1',
      authorName: 'Jeanine',
      rating: 5,
    });
    expect(prisma.operationsRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        domain: 'reviews',
        recordId: 'truck-1:importer-1',
        ownerId: 'importer-1',
        truckId: 'truck-1',
      }) as unknown,
    });
  });

  it('only lets importers whose cargo the truck delivered review it', async () => {
    prisma.booking.count.mockResolvedValue(0);

    await expect(
      service.create(importer, 'truck-1', input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.operationsRecord.create).not.toHaveBeenCalled();
  });

  it('refuses reviews from other roles', async () => {
    await expect(
      service.create(
        { id: 'owner-1', role: UserRole.TRUCK_OWNER },
        'truck-1',
        input,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports a missing truck', async () => {
    prisma.truck.findUnique.mockResolvedValue(null);

    await expect(
      service.create(importer, 'missing', input),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a second review of the same truck', async () => {
    prisma.operationsRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.create(importer, 'truck-1', input),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
