import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { BookingStatus, TruckStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { BookingsService } from './bookings.service';

describe('BookingsService', () => {
  const importer = { id: 'importer-1', role: UserRole.IMPORTER };
  const owner = { id: 'owner-1', role: UserRole.TRUCK_OWNER };
  let prisma: any;
  let payments: any;
  let service: BookingsService;

  /** Rows the verification query returns for a truck whose required documents are all approved. */
  const approvedDocuments = (truckId: string) =>
    ['VEHICLE_REGISTRATION', 'VEHICLE_INSPECTION', 'INSURANCE_POLICY'].map(
      (type) => ({
        truckId,
        type,
        status: 'APPROVED',
        expiryDate: '2099-01-01',
        submittedAt: '2026-01-01T00:00:00Z',
      }),
    );
  const bookingInput = {
    truckId: 'truck-1',
    cargoType: 'Produce',
    cargoWeight: 500,
    pickupLocation: 'Kigali',
    destination: 'Musanze',
    pickupDate: '2030-01-01T10:00:00Z',
    expectedDeliveryDate: '2030-01-02T10:00:00Z',
  };

  beforeEach(() => {
    prisma = {
      truck: { findUnique: jest.fn(), update: jest.fn() },
      booking: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      bookingPayment: { findUnique: jest.fn() },
      operationsRecord: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        upsert: jest.fn().mockResolvedValue({ data: {} }),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };
    payments = { releaseBookingFunds: jest.fn() };
    service = new BookingsService(
      prisma as PrismaService,
      payments as PaymentsService,
    );
  });

  it('saves an importer booking through the atomic truck claim and returns the stored record', async () => {
    const truck = {
      id: 'truck-1',
      ownerId: owner.id,
      status: TruckStatus.AVAILABLE,
      priceRwf: 80000,
      capacity: 1000,
    };
    const booking = { id: 'booking-1', importerId: importer.id, truck };
    prisma.truck.findUnique.mockResolvedValue(truck);
    prisma.$queryRaw
      .mockResolvedValueOnce(approvedDocuments(truck.id))
      .mockResolvedValueOnce([{ id: booking.id }]);
    prisma.booking.findUniqueOrThrow.mockResolvedValue(booking);

    await expect(service.create(importer, bookingInput)).resolves.toBe(booking);
    // One query reads the truck's documents, one claims the truck and inserts the booking.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.booking.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'booking-1' } }),
    );
    expect(prisma.operationsRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            domain: 'notifications',
            ownerId: owner.id,
            data: expect.objectContaining({
              title: 'New truck booking',
              userId: owner.id,
            }),
          }),
        ],
      }),
    );
  });

  it('refuses to book a truck that is not verified, without claiming it', async () => {
    prisma.truck.findUnique.mockResolvedValue({
      id: 'truck-1',
      ownerId: owner.id,
      status: TruckStatus.AVAILABLE,
      priceRwf: 80000,
      capacity: 1000,
    });
    // Registration approved, inspection still pending, no insurance submitted.
    prisma.$queryRaw.mockResolvedValueOnce(
      approvedDocuments('truck-1')
        .slice(0, 2)
        .map((doc, index) =>
          index === 1 ? { ...doc, status: 'PENDING' } : doc,
        ),
    );

    await expect(service.create(importer, bookingInput)).rejects.toThrow(
      'This truck is not verified yet',
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.booking.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('blocks booking an unapproved or otherwise unavailable truck', async () => {
    prisma.truck.findUnique.mockResolvedValue({
      status: TruckStatus.UNAVAILABLE,
      priceRwf: 80000,
      capacity: 1000,
    });
    await expect(
      service.create(importer, {
        truckId: 'truck-1',
        cargoType: 'Produce',
        cargoWeight: 500,
        pickupLocation: 'Kigali',
        destination: 'Musanze',
        pickupDate: '2030-01-01T10:00:00Z',
        expectedDeliveryDate: '2030-01-02T10:00:00Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('persists live location only for the booking truck owner during an active trip', async () => {
    const activeBooking = {
      id: 'booking-1',
      importerId: importer.id,
      truck: { ownerId: owner.id },
      status: BookingStatus.IN_PROGRESS,
    };
    prisma.booking.findUnique.mockResolvedValue(activeBooking);
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.update.mockResolvedValue({});
    const location = {
      trackingLatitude: -1.95,
      trackingLongitude: 30.06,
      trackingAccuracy: 12,
      trackingUpdatedAt: new Date(),
    };
    prisma.booking.findUnique
      .mockResolvedValueOnce(activeBooking)
      .mockResolvedValueOnce({ ...activeBooking, ...location });

    const result = await service.updateTrackingLocation(owner, 'booking-1', {
      latitude: -1.95,
      longitude: 30.06,
      accuracy: 12,
    });
    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'booking-1', status: BookingStatus.IN_PROGRESS },
      }),
    );
    expect(result).toMatchObject({
      latitude: -1.95,
      longitude: 30.06,
      accuracy: 12,
    });

    await expect(
      service.findOne({ id: 'stranger', role: UserRole.IMPORTER }, 'booking-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose a GPS location when tracking data is absent', async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      importerId: importer.id,
      truck: { ownerId: owner.id },
      status: BookingStatus.IN_PROGRESS,
      trackingLatitude: null,
      trackingLongitude: null,
      trackingUpdatedAt: null,
    });
    await expect(
      service.getTrackingLocation(importer, 'booking-1'),
    ).resolves.toBeNull();
  });

  it('persists in-transit notifications for the importer and truck owner', async () => {
    const booking = {
      id: 'booking-1',
      importerId: importer.id,
      truckId: 'truck-1',
      truck: { ownerId: owner.id },
      status: BookingStatus.ACCEPTED,
      agreedPriceRwf: 80000,
      payment: { status: 'FUNDED' },
      destination: 'Musanze',
      expectedDeliveryDate: new Date('2030-01-02T10:00:00Z'),
      createdAt: new Date('2030-01-01T10:00:00Z'),
    };
    prisma.booking.findUnique.mockResolvedValue(booking);
    prisma.bookingPayment.findUnique.mockResolvedValue({ status: 'FUNDED' });
    prisma.booking.update.mockResolvedValue({
      ...booking,
      status: BookingStatus.IN_PROGRESS,
    });

    await service.update(owner, booking.id, {
      status: BookingStatus.IN_PROGRESS,
    });

    const notifications =
      prisma.operationsRecord.createMany.mock.calls[0][0].data;
    expect(notifications).toHaveLength(1);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: 'notifications',
          ownerId: importer.id,
          data: expect.objectContaining({
            category: 'BOOKING',
            title: 'Trip started',
            read: false,
          }),
        }),
      ]),
    );
  });

  it('creates an API-owned shipment when the truck owner accepts a booking', async () => {
    const booking = {
      id: 'booking-1',
      importerId: importer.id,
      truckId: 'truck-1',
      truck: { ownerId: owner.id },
      status: BookingStatus.PENDING,
      agreedPriceRwf: 80000,
      expectedDeliveryDate: new Date('2030-01-02T10:00:00Z'),
      createdAt: new Date('2030-01-01T10:00:00Z'),
    };
    prisma.booking.findUnique.mockResolvedValue(booking);
    prisma.booking.update.mockResolvedValue({
      ...booking,
      status: BookingStatus.ACCEPTED,
    });

    await service.update(owner, booking.id, {
      status: BookingStatus.ACCEPTED,
    });

    expect(prisma.operationsRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          domain_recordId: { domain: 'shipments', recordId: 'sh-booking-1' },
        },
        create: expect.objectContaining({
          domain: 'shipments',
          ownerId: owner.id,
          parentId: booking.id,
          status: 'SCHEDULED',
          data: expect.objectContaining({
            bookingId: booking.id,
            importerId: importer.id,
            ownerId: owner.id,
          }),
        }),
        update: {},
      }),
    );
  });

  describe('keeps the shipment in step with the booking', () => {
    const booking = {
      id: 'booking-1',
      importerId: importer.id,
      truckId: 'truck-1',
      truck: { ownerId: owner.id },
      status: BookingStatus.DELIVERED,
      destination: 'Musanze',
      payment: { status: 'FUNDED' },
      expectedDeliveryDate: new Date('2030-01-02T10:00:00Z'),
      createdAt: new Date('2030-01-01T10:00:00Z'),
    };
    const shipmentRecord = (status: string) => ({
      id: 'record-1',
      data: { id: 'sh-booking-1', status, milestones: [] },
    });

    beforeEach(() => {
      prisma.booking.findUnique.mockResolvedValue(booking);
      prisma.bookingPayment.findUnique.mockResolvedValue({ status: 'FUNDED' });
    });

    it('completes the shipment when the importer confirms receipt', async () => {
      prisma.booking.update.mockResolvedValue({
        ...booking,
        status: BookingStatus.COMPLETED,
      });
      prisma.operationsRecord.findUnique.mockResolvedValue(
        shipmentRecord('ARRIVED'),
      );

      await service.update(importer, booking.id, {
        status: BookingStatus.COMPLETED,
      });

      expect(prisma.operationsRecord.update).toHaveBeenCalledWith({
        where: { id: 'record-1' },
        data: {
          status: 'COMPLETED',
          data: expect.objectContaining({
            status: 'COMPLETED',
            milestones: [
              expect.objectContaining({ kind: 'DELIVERED', place: 'Musanze' }),
            ],
          }),
        },
      });
    });

    it('never moves a shipment backwards', async () => {
      prisma.booking.findUnique.mockResolvedValue({
        ...booking,
        status: BookingStatus.ACCEPTED,
      });
      prisma.booking.update.mockResolvedValue({
        ...booking,
        status: BookingStatus.IN_PROGRESS,
      });
      prisma.operationsRecord.findUnique.mockResolvedValue(
        shipmentRecord('UNLOADING'),
      );

      await service.update(owner, booking.id, {
        status: BookingStatus.IN_PROGRESS,
      });

      expect(prisma.operationsRecord.update).not.toHaveBeenCalled();
    });
  });
});
