import { BookingStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * A vehicle is listed whatever its bookings; it is only taken on the days a live booking covers
 * (pickup day through expected delivery day, inclusive). Days are "YYYY-MM-DD" in UTC, the way
 * booking dates are stored.
 */

export type BookedRange = { start: string; end: string };

/** Bookings that still hold the vehicle on their dates. */
export const LIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.DELIVERED,
  BookingStatus.DISPUTED,
];

export const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** Upcoming booked days for each vehicle, earliest first. */
export async function bookedRangesByTruck(
  prisma: PrismaService | Prisma.TransactionClient,
  truckIds: string[],
  from: Date = new Date(),
): Promise<Map<string, BookedRange[]>> {
  const result = new Map<string, BookedRange[]>(truckIds.map((id) => [id, []]));
  if (!truckIds.length) return result;
  const bookings = await prisma.booking.findMany({
    where: {
      truckId: { in: truckIds },
      status: { in: LIVE_BOOKING_STATUSES },
      expectedDeliveryDate: { gte: new Date(`${dayKey(from)}T00:00:00.000Z`) },
    },
    select: { truckId: true, pickupDate: true, expectedDeliveryDate: true },
    orderBy: { pickupDate: 'asc' },
  });
  for (const booking of bookings) {
    result.get(booking.truckId)?.push({
      start: dayKey(booking.pickupDate),
      end: dayKey(booking.expectedDeliveryDate),
    });
  }
  return result;
}

/** Whether `start`–`end` (inclusive day keys) avoids every booked range. */
export function isRangeFree(start: string, end: string, ranges: BookedRange[]) {
  return !ranges.some((range) => range.start <= end && range.end >= start);
}
