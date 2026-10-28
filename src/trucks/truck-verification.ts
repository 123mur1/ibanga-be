import type { PrismaService } from '../prisma/prisma.service';

export type VerificationStatus =
  'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

/** Documents a truck needs approved before it counts as verified. */
export const REQUIRED_TRUCK_DOCUMENTS = [
  'VEHICLE_REGISTRATION',
  'VEHICLE_INSPECTION',
  'INSURANCE_POLICY',
] as const;

export type TruckDocumentSummary = {
  type: string;
  status: string;
  expiryDate: string | null;
  submittedAt: string | null;
};

/**
 * A truck's verification, worked out from its documents every time so it can never drift from
 * what an administrator decided. The frontend applies the same rule (`truckVerification` in
 * config/business-rules.ts).
 */
export function truckVerification(
  documents: TruckDocumentSummary[],
  today: string = new Date().toISOString().slice(0, 10),
): VerificationStatus {
  const statuses = REQUIRED_TRUCK_DOCUMENTS.map((type): VerificationStatus => {
    const latest = documents
      .filter((doc) => doc.type === type)
      .sort((a, b) =>
        (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''),
      )[0];
    if (!latest) return 'NOT_SUBMITTED';
    if (
      latest.status === 'APPROVED' &&
      latest.expiryDate &&
      latest.expiryDate.slice(0, 10) < today
    ) {
      return 'EXPIRED';
    }
    return (['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] as const).includes(
      latest.status as never,
    )
      ? (latest.status as VerificationStatus)
      : 'PENDING';
  });
  if (statuses.includes('EXPIRED')) return 'EXPIRED';
  if (statuses.includes('REJECTED')) return 'REJECTED';
  if (statuses.every((status) => status === 'APPROVED')) return 'APPROVED';
  if (statuses.includes('PENDING')) return 'PENDING';
  return 'NOT_SUBMITTED';
}

/** Each truck's verification, read from its documents in one query (file contents stay put). */
export async function verificationByTruck(
  prisma: PrismaService,
  truckIds: string[],
): Promise<Map<string, VerificationStatus>> {
  if (!truckIds.length) return new Map();
  const documents = await prisma.$queryRaw<
    (TruckDocumentSummary & { truckId: string })[]
  >`
    SELECT data->>'subjectId' AS "truckId",
      data->>'type' AS type,
      data->>'status' AS status,
      data->>'expiryDate' AS "expiryDate",
      data->>'submittedAt' AS "submittedAt"
    FROM "OperationsRecord"
    WHERE domain = 'documents'
      AND data->>'subjectKind' = 'TRUCK'
      AND data->>'subjectId' = ANY(${truckIds})
  `;
  return new Map(
    truckIds.map((id) => [
      id,
      truckVerification(documents.filter((doc) => doc.truckId === id)),
    ]),
  );
}
