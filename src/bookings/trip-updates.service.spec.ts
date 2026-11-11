import { BookingStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { BookingsService } from './bookings.service';
import { TripUpdatesService } from './trip-updates.service';

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe('TripUpdatesService', () => {
  const owner = { id: 'owner-1', role: UserRole.TRUCK_OWNER };
  const driver = { id: 'driver-user', role: UserRole.DRIVER };
  const importerB = { id: 'importer-b', role: UserRole.IMPORTER };
  let prisma: any;
  let payments: any;
  let bookings: any;
  let service: TripUpdatesService;

  // Truck T: A runs 1–3 Jan (on the road), B 4–5 Jan, C 6–7 Jan, D 20–21 Jan.
  const rows: Record<string, any> = {};
  const reset = () => {
    Object.assign(rows, {
      A: {
        id: 'A',
        truckId: 'T',
        importerId: 'importer-a',
        status: BookingStatus.IN_PROGRESS,
        pickupDate: day('2030-01-01'),
        expectedDeliveryDate: day('2030-01-03'),
        pickupLocation: 'Kigali',
        destination: 'Mombasa',
        truck: { ownerId: owner.id, plateNumber: 'RAH 1' },
      },
      B: {
        id: 'B',
        truckId: 'T',
        importerId: 'importer-b',
        status: BookingStatus.ACCEPTED,
        pickupDate: day('2030-01-04'),
        expectedDeliveryDate: day('2030-01-05'),
      },
      C: {
        id: 'C',
        truckId: 'T',
        importerId: 'importer-c',
        status: BookingStatus.PENDING,
        pickupDate: day('2030-01-06'),
        expectedDeliveryDate: day('2030-01-07'),
      },
      D: {
        id: 'D',
        truckId: 'T',
        importerId: 'importer-d',
        status: BookingStatus.PENDING,
        pickupDate: day('2030-01-20'),
        expectedDeliveryDate: day('2030-01-21'),
      },
    });
  };

  beforeEach(() => {
    reset();
    const impacts: any[] = [];
    prisma = {
      booking: {
        findUnique: jest.fn(({ where }) => Promise.resolve(rows[where.id])),
        findUniqueOrThrow: jest.fn(({ where }) =>
          Promise.resolve(rows[where.id]),
        ),
        update: jest.fn(({ where, data }) => {
          Object.assign(rows[where.id], data);
          return Promise.resolve(rows[where.id]);
        }),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            Object.values(rows)
              .filter(
                (row) =>
                  row.id !== where.id.not &&
                  where.status.in.includes(row.status) &&
                  row.pickupDate > where.pickupDate.gt &&
                  (!where.pickupDate.lte ||
                    row.pickupDate <= where.pickupDate.lte),
              )
              .sort((a, b) => a.pickupDate - b.pickupDate),
          ),
        ),
      },
      tripDelay: {
        create: jest.fn(({ data }) =>
          Promise.resolve({ id: 'delay-1', ...data }),
        ),
      },
      delayImpact: {
        create: jest.fn(({ data }) => {
          const impact = {
            id: `impact-${impacts.length + 1}`,
            status: 'PENDING',
            ...data,
          };
          impacts.push(impact);
          return Promise.resolve(impact);
        }),
        update: jest.fn(({ where, data }) => {
          const impact = impacts.find((item) => item.id === where.id);
          Object.assign(impact, data);
          return Promise.resolve(impact);
        }),
        findFirst: jest.fn(({ where }) => {
          const impact = impacts.find(
            (item) =>
              (!where.id || item.id === where.id) &&
              item.bookingId === where.bookingId &&
              (!where.status || item.status === where.status),
          );
          return Promise.resolve(
            impact && where.id
              ? {
                  ...impact,
                  booking: {
                    ...rows[impact.bookingId],
                    payment: null,
                    truck: { ownerId: owner.id, plateNumber: 'RAH 1' },
                  },
                }
              : (impact ?? null),
          );
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Eric' }) },
      operationsRecord: {
        // The driver profile drives truck T; there is no shipment record to update.
        findMany: jest
          .fn()
          .mockResolvedValue([{ data: { assignedTruckId: 'T' } }]),
        findUnique: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((run: (tx: unknown) => unknown) => run(prisma)),
    };
    payments = { settleHeldPayment: jest.fn() };
    bookings = { findOne: jest.fn(), closeCancelledBooking: jest.fn() };
    service = new TripUpdatesService(
      prisma as PrismaService,
      payments as PaymentsService,
      bookings as BookingsService,
    );
  });

  it('lets the driver report a delay and automatically cascades overlapping bookings', async () => {
    const result = await service.send(driver, 'A', {
      message: 'Border queue at Malaba',
      delayDays: 2,
    });

    expect(rows.A.expectedDeliveryDate).toEqual(day('2030-01-05'));
    // B overlaps the new end, which pushes C as well. D remains outside the cascade.
    expect(
      result.impacts.map((impact) => [impact.bookingId, impact.shiftDays]),
    ).toEqual([
      ['B', 2],
      ['C', 2],
    ]);
    expect([rows.B.pickupDate, rows.B.expectedDeliveryDate]).toEqual([
      day('2030-01-06'),
      day('2030-01-07'),
    ]);
    expect([rows.C.pickupDate, rows.C.expectedDeliveryDate]).toEqual([
      day('2030-01-08'),
      day('2030-01-09'),
    ]);
    expect(prisma.delayImpact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'B',
        shiftDays: 2,
        status: 'SHIFTED',
      }),
    });
    const notices = prisma.operationsRecord.createMany.mock.calls[0][0].data;
    expect(notices.map((notice: any) => notice.ownerId).sort()).toEqual(
      ['importer-a', 'importer-b', 'importer-c', owner.id].sort(),
    );
  });

  it('refuses trip updates from someone who neither drives nor owns the truck', async () => {
    prisma.operationsRecord.findMany.mockResolvedValue([]);
    await expect(
      service.send({ id: 'stranger', role: UserRole.DRIVER }, 'A', {
        message: 'Hello there',
      }),
    ).rejects.toThrow('driver or owner');
  });

  it('keeps auto-shifted bookings eligible for a full refund', async () => {
    const result = await service.send(owner, 'A', {
      message: 'Engine repair',
      delayDays: 2,
    });
    expect(result.impacts.map((impact) => impact.bookingId)).toEqual([
      'B',
      'C',
    ]);
    prisma.booking.updateMany = jest.fn().mockResolvedValue({ count: 1 });

    await service.decide(importerB, 'B', 'impact-1', { decision: 'REFUND' });

    // B and C have already moved automatically; D remains outside the cascade.
    expect([rows.B.pickupDate, rows.B.expectedDeliveryDate]).toEqual([
      day('2030-01-06'),
      day('2030-01-07'),
    ]);
    expect([rows.C.pickupDate, rows.C.expectedDeliveryDate]).toEqual([
      day('2030-01-08'),
      day('2030-01-09'),
    ]);
    expect(rows.D.pickupDate).toEqual(day('2030-01-20'));
    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: BookingStatus.CANCELLED } }),
    );
    expect(bookings.closeCancelledBooking).toHaveBeenCalled();
  });

  it('cancelling an unpaid affected booking needs no money movement', async () => {
    await service.send(owner, 'A', { message: 'Engine repair', delayDays: 2 });
    prisma.booking.updateMany = jest.fn().mockResolvedValue({ count: 1 });

    await service.decide(importerB, 'B', 'impact-1', { decision: 'REFUND' });

    expect(payments.settleHeldPayment).not.toHaveBeenCalled();
    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: BookingStatus.CANCELLED } }),
    );
    expect(bookings.closeCancelledBooking).toHaveBeenCalled();
  });
});
