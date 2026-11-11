import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TruckPhotos } from './truck-photos';
import { TrucksService } from './trucks.service';

describe('TrucksService verified-only marketplace', () => {
  const verified = { id: 'truck-verified', ownerId: 'owner-1' };
  const unverified = { id: 'truck-unverified', ownerId: 'owner-1' };
  /** Rows the verification query returns: all required documents approved for `verified` only. */
  const documentRows = [
    'VEHICLE_REGISTRATION',
    'VEHICLE_INSPECTION',
    'INSURANCE_POLICY',
  ].map((type) => ({
    truckId: verified.id,
    type,
    status: 'APPROVED',
    expiryDate: '2099-01-01',
    submittedAt: '2026-01-01T00:00:00Z',
  }));
  let prisma: any;
  let service: TrucksService;

  beforeEach(() => {
    prisma = {
      truck: { findMany: jest.fn(), findUnique: jest.fn() },
      booking: {
        findMany: jest.fn().mockResolvedValue([
          {
            truckId: 'truck-verified',
            pickupDate: new Date('2030-01-05T00:00:00Z'),
            expectedDeliveryDate: new Date('2030-01-07T00:00:00Z'),
          },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue(documentRows),
    };
    const photos = {
      withCovers: jest.fn((trucks: unknown[]) => Promise.resolve(trucks)),
    };
    service = new TrucksService(
      prisma as PrismaService,
      photos as unknown as TruckPhotos,
    );
  });

  const ids = (trucks: { id: string }[]) => trucks.map((truck) => truck.id);

  it('lists only verified trucks to importers and visitors', async () => {
    prisma.truck.findMany.mockResolvedValue([verified, unverified]);
    await expect(
      service.findAll('importer-1', UserRole.IMPORTER, {}).then(ids),
    ).resolves.toEqual([verified.id]);
    await expect(
      service.findAll(undefined, undefined, {}).then(ids),
    ).resolves.toEqual([verified.id]);
  });

  it('lists vehicles whatever their bookings, with the days already booked', async () => {
    prisma.truck.findMany.mockResolvedValue([verified]);

    const [listed] = await service.findAll(undefined, undefined, {});

    expect(prisma.truck.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          status: expect.anything(),
        }) as unknown,
      }),
    );
    expect(listed).toMatchObject({
      bookedRanges: [{ start: '2030-01-05', end: '2030-01-07' }],
    });
  });

  it('lists every truck to administrators and an owner their whole fleet', async () => {
    prisma.truck.findMany.mockResolvedValue([verified, unverified]);
    await expect(
      service.findAll('admin-1', UserRole.ADMIN, {}).then(ids),
    ).resolves.toEqual([verified.id, unverified.id]);
    await expect(
      service
        .findAll('owner-1', UserRole.TRUCK_OWNER, { mine: true })
        .then(ids),
    ).resolves.toEqual([verified.id, unverified.id]);
  });

  it('hides an unverified truck page from importers but not from its owner or administrators', async () => {
    prisma.truck.findUnique.mockResolvedValue(unverified);
    await expect(
      service.findOne(unverified.id, {
        id: 'importer-1',
        role: UserRole.IMPORTER,
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.findOne(unverified.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.findOne(unverified.id, {
        id: 'owner-1',
        role: UserRole.TRUCK_OWNER,
      }),
    ).resolves.toMatchObject({ verification: 'NOT_SUBMITTED' });
    await expect(
      service.findOne(unverified.id, { id: 'admin-1', role: UserRole.ADMIN }),
    ).resolves.toMatchObject({ id: unverified.id });
  });

  it('shows a verified truck page to everyone', async () => {
    prisma.truck.findUnique.mockResolvedValue(verified);
    await expect(service.findOne(verified.id)).resolves.toMatchObject({
      verification: 'APPROVED',
    });
  });
});
