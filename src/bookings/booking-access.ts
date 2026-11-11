import { UserRole } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type Actor = { id: string; role: UserRole };

/** The vehicles a driver account drives: its driver profile's assigned truck. */
export async function driverTruckIds(
  prisma: PrismaService,
  userId: string,
): Promise<string[]> {
  const records = await prisma.operationsRecord.findMany({
    where: { domain: 'drivers', data: { path: ['userId'], equals: userId } },
    select: { data: true },
  });
  return records
    .map(
      (record) =>
        (record.data as { assignedTruckId?: unknown }).assignedTruckId,
    )
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** Whether the actor drives the booking's truck. */
export async function drivesTruck(
  prisma: PrismaService,
  actor: Actor,
  truckId: string,
) {
  if (actor.role !== UserRole.DRIVER) return false;
  return (await driverTruckIds(prisma, actor.id)).includes(truckId);
}
