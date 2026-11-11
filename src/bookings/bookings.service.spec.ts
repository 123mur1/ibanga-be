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
      // Cargo and tax documents are in, so trips may start unless a test says otherwise.
      bookingDocument: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ kind: 'CARGO' }, { kind: 'TAX' }]),
      },
      operationsRecord: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        upsert: jest.fn().mockResolvedValue({ data: {} }),
        findMany: jest.fn().mockResolvedValue([]),
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

  describe('creating a booking', () => {
    const truck = {
      id: 'truck-1',
      ownerId: owner.id,
      status: TruckStatus.UNAVAILABLE,
      pricePerKmRwf: 1000,
      capacity: 1000,
      currentLocation: 'Kigali',
      destinations: ['Musanze', 'Kampala'],
    };

    beforeEach(() => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      prisma.truck.findUnique.mockResolvedValue(truck);
      prisma.$transaction = jest.fn((run: (tx: unknown) => unknown) =>
        run(prisma),
      );
      prisma.booking.create = jest.fn().mockResolvedValue({ id: 'booking-1' });
      prisma.booking.findMany.mockResolvedValue([]);
      prisma.booking.findUniqueOrThrow.mockResolvedValue({ id: 'booking-1' });
      prisma.$queryRaw
        .mockResolvedValueOnce(approvedDocuments(truck.id))
        .mockResolvedValueOnce([{ id: truck.id }]);
    });

    it('books free dates on a vehicle whatever its status, priced by distance times rate', async () => {
      await expect(service.create(importer, bookingInput)).resolves.toEqual({
        id: 'booking-1',
      });

      // Vehicle in Kigali, pickup in Kigali, delivery in Musanze: Kigali → Musanze → Kigali, each
      // leg the straight line times the 1.3 road factor, rounded to the km.
      const call = prisma.booking.create.mock.calls[0][0];
      expect(call.data).toMatchObject({
        truckId: 'truck-1',
        pickupLocation: 'Kigali',
        destination: 'Musanze',
        truckLocation: 'Kigali',
        pickupCountry: 'Rwanda',
        destinationCity: 'Musanze',
        pickupDate: new Date('2030-01-01T00:00:00.000Z'),
        expectedDeliveryDate: new Date('2030-01-02T00:00:00.000Z'),
        pricePerKmRwf: 1000,
      });
      expect(call.data.routeLegs).toHaveLength(3);
      expect(call.data.routeLegs[0].km).toBe(0);
      expect(call.data.distanceKm).toBeGreaterThan(120);
      expect(call.data.distanceKm).toBeLessThan(180);
      expect(call.data.agreedPriceRwf).toBe(call.data.distanceKm * 1000);
      // The vehicle is not claimed: other dates stay bookable.
      expect(prisma.truck.update).not.toHaveBeenCalled();
      expect(prisma.operationsRecord.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              domain: 'notifications',
              ownerId: importer.id,
              data: expect.objectContaining({ title: 'Booking request sent' }),
            }),
            expect.objectContaining({
              domain: 'notifications',
              ownerId: owner.id,
              data: expect.objectContaining({ title: 'New truck booking' }),
            }),
          ]),
        }),
      );
    });

    it('refuses dates that overlap a live booking', async () => {
      prisma.booking.findMany.mockResolvedValue([
        {
          truckId: 'truck-1',
          pickupDate: new Date('2029-12-31T00:00:00Z'),
          expectedDeliveryDate: new Date('2030-01-01T00:00:00Z'),
        },
      ]);

      await expect(service.create(importer, bookingInput)).rejects.toThrow(
        'Someone booked this vehicle on some of those dates',
      );
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });

    it('refuses a destination the owner does not deliver to', async () => {
      await expect(
        service.create(importer, { ...bookingInput, destination: 'Mombasa' }),
      ).rejects.toThrow('Choose a destination this vehicle serves');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a vehicle with no rate per km', async () => {
      prisma.truck.findUnique.mockResolvedValue({
        ...truck,
        pricePerKmRwf: null,
      });

      await expect(
        service.create(importer, bookingInput),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a vehicle that is not verified', async () => {
      prisma.$queryRaw.mockReset();
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
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
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
    expect(notifications).toHaveLength(2);
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
        expect.objectContaining({
          domain: 'notifications',
          ownerId: owner.id,
          data: expect.objectContaining({
            category: 'BOOKING',
            title: 'Trip started',
            read: false,
          }),
        }),
      ]),
    );
  });

  it('does not start a trip before the cargo and tax documents are uploaded', async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      importerId: importer.id,
      truckId: 'truck-1',
      truck: { ownerId: owner.id },
      status: BookingStatus.ACCEPTED,
      agreedPriceRwf: 80000,
      payment: { status: 'FUNDED' },
    });
    prisma.bookingPayment.findUnique.mockResolvedValue({ status: 'FUNDED' });
    prisma.bookingDocument.findMany.mockResolvedValue([{ kind: 'CARGO' }]);

    await expect(
      service.update(owner, 'booking-1', { status: BookingStatus.IN_PROGRESS }),
    ).rejects.toThrow('tax documents');
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it('does not complete a booking until the importer pays the remaining 50%', async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      importerId: importer.id,
      truckId: 'truck-1',
      truck: { ownerId: owner.id },
      status: BookingStatus.DELIVERED,
      agreedPriceRwf: 80000,
      payment: { status: 'FUNDED', depositRwf: 40000, balancePaidAt: null },
    });

    await expect(
      service.update(importer, 'booking-1', {
        status: BookingStatus.COMPLETED,
      }),
    ).rejects.toThrow('remaining 50%');
    expect(payments.releaseBookingFunds).not.toHaveBeenCalled();
  });

  it('records the acceptance time, which starts the deposit window', async () => {
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

    await service.update(owner, booking.id, { status: BookingStatus.ACCEPTED });

    expect(prisma.booking.update.mock.calls[0][0].data).toMatchObject({
      status: BookingStatus.ACCEPTED,
      acceptedAt: expect.any(Date),
    });
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

  describe('cancelling unpaid bookings', () => {
    const lockedRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'booking-1',
      truckId: 'truck-1',
      importerId: importer.id,
      status: BookingStatus.ACCEPTED,
      acceptedAt: new Date('2026-11-09T09:00:00Z'),
      updatedAt: new Date('2026-11-09T09:00:00Z'),
      ...overrides,
    });

    beforeEach(() => {
      prisma.$transaction = jest.fn((run: (tx: unknown) => unknown) =>
        run(prisma),
      );
      prisma.bookingPayment.count = jest.fn().mockResolvedValue(0);
      prisma.booking.count = jest.fn().mockResolvedValue(0);
      prisma.operationsRecord.findMany = jest.fn().mockResolvedValue([]);
      prisma.truck.findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ ownerId: owner.id });
      prisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        importerId: importer.id,
        truck: { ownerId: owner.id },
        payment: null,
      });
    });

    it('lets the importer cancel an unpaid booking and frees its days', async () => {
      prisma.$queryRaw.mockResolvedValue([lockedRow()]);

      await service.update(importer, 'booking-1', {
        status: BookingStatus.CANCELLED,
      });

      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({ status: BookingStatus.CANCELLED }),
        }),
      );
      // Only the booked days are freed; the vehicle itself was never taken off the market.
      expect(prisma.truck.update).not.toHaveBeenCalled();
      const notices = prisma.operationsRecord.createMany.mock.calls[0][0].data;
      expect(
        notices.map((notice: { ownerId: string }) => notice.ownerId).sort(),
      ).toEqual([importer.id, owner.id].sort());
      expect(notices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ownerId: importer.id,
            data: expect.objectContaining({
              title: 'Booking request cancelled',
            }),
          }),
          expect.objectContaining({
            ownerId: owner.id,
            data: expect.objectContaining({
              title: 'Booking cancelled by the importer',
            }),
          }),
        ]),
      );
    });

    it('lets the importer cancel a pending request before owner acceptance', async () => {
      prisma.$queryRaw.mockResolvedValue([
        lockedRow({ status: BookingStatus.PENDING, acceptedAt: null }),
      ]);

      await service.update(importer, 'booking-1', {
        status: BookingStatus.CANCELLED,
      });

      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({ status: BookingStatus.CANCELLED }),
        }),
      );
      const notices = prisma.operationsRecord.createMany.mock.calls[0][0].data;
      expect(
        notices.map((notice: { ownerId: string }) => notice.ownerId).sort(),
      ).toEqual([importer.id, owner.id].sort());
    });

    it('refuses to cancel a booking that already has a payment', async () => {
      prisma.$queryRaw.mockResolvedValue([lockedRow()]);
      prisma.bookingPayment.count.mockResolvedValue(1);

      await expect(
        service.update(importer, 'booking-1', {
          status: BookingStatus.CANCELLED,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.booking.update).not.toHaveBeenCalled();
      expect(prisma.truck.update).not.toHaveBeenCalled();
    });

    it('does not let the truck owner cancel through this path', async () => {
      await expect(
        service.update(owner, 'booking-1', {
          status: BookingStatus.CANCELLED,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('expires accepted bookings whose deposit is unpaid an hour after acceptance', async () => {
      const now = new Date('2026-11-09T10:10:00Z');
      prisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }]);
      prisma.$queryRaw.mockResolvedValue([lockedRow()]);

      await expect(service.expireUnpaidBookings(now)).resolves.toBe(1);

      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: BookingStatus.ACCEPTED,
            payment: { is: null },
            OR: [
              { acceptedAt: { lte: new Date('2026-11-09T09:10:00Z') } },
              {
                acceptedAt: null,
                updatedAt: { lte: new Date('2026-11-09T09:10:00Z') },
              },
            ],
          },
        }),
      );
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BookingStatus.CANCELLED }),
        }),
      );
    });

    it('never expires a request the owner has not answered', async () => {
      prisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }]);
      prisma.$queryRaw.mockResolvedValue([
        lockedRow({ status: BookingStatus.PENDING, acceptedAt: null }),
      ]);

      await expect(
        service.expireUnpaidBookings(new Date('2026-11-10T09:00:00Z')),
      ).resolves.toBe(0);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('leaves a booking alone if it was paid between the scan and the lock', async () => {
      prisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }]);
      prisma.$queryRaw.mockResolvedValue([lockedRow()]);
      prisma.bookingPayment.count.mockResolvedValue(1);

      await expect(
        service.expireUnpaidBookings(new Date('2026-11-09T10:10:00Z')),
      ).resolves.toBe(0);
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });
  });

  describe('completing an approved cancellation', () => {
    const admin = { id: 'admin-1', role: UserRole.ADMIN };
    const paidBooking = (status: BookingStatus) => ({
      id: 'booking-1',
      truckId: 'truck-1',
      importerId: importer.id,
      status,
      truck: { ownerId: owner.id },
      payment: { status: 'FUNDED', amountRwf: 100000 },
    });

    beforeEach(() => {
      prisma.operationsRecord.findMany = jest.fn().mockResolvedValue([]);
      prisma.operationsRecord.findFirst = jest.fn().mockResolvedValue({
        id: 'cancel-1',
        data: { bookingId: 'booking-1', stage: 'AFTER_PAYMENT' },
      });
      payments.settleHeldPayment = jest.fn(
        (_id: string, _refund: number, close: (tx: unknown) => Promise<void>) =>
          close(prisma),
      );
    });

    it('keeps a 10% fee for the owner and refunds the rest before pickup', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        paidBooking(BookingStatus.ACCEPTED),
      );

      await expect(
        service.completeCancellation(admin, 'booking-1'),
      ).resolves.toMatchObject({ feeRwf: 10000, refundRwf: 90000 });
      expect(payments.settleHeldPayment).toHaveBeenCalledWith(
        'booking-1',
        90000,
        expect.any(Function),
      );
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BookingStatus.CANCELLED }),
        }),
      );
      expect(prisma.operationsRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cancel-1' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('keeps 50% once the trip has started, whatever the request says', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        paidBooking(BookingStatus.IN_PROGRESS),
      );

      await expect(
        service.completeCancellation(admin, 'booking-1'),
      ).resolves.toMatchObject({ feeRwf: 50000, refundRwf: 50000 });
    });

    it('needs an approved request and an administrator', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        paidBooking(BookingStatus.ACCEPTED),
      );
      prisma.operationsRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.completeCancellation(admin, 'booking-1'),
      ).rejects.toThrow('Approve the cancellation request');
      await expect(
        service.completeCancellation(importer, 'booking-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(payments.settleHeldPayment).not.toHaveBeenCalled();
    });
  });
});
