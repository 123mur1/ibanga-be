import { UserRole } from '@prisma/client';

export const OPERATIONS_DOMAINS = [
  'cargo-requests',
  'quotations',
  'drivers',
  'driver-assignments',
  'truck-profiles',
  'shipments',
  'settlements',
  'payouts',
  'documents',
  'verification-requests',
  'cancellations',
  'dispute-cases',
  'incidents',
  'insurance-policies',
  'insurance-claims',
  'support-tickets',
  'notifications',
  'notification-preferences',
  'announcements',
  'audit-logs',
  'reconciliation',
  'admin-profiles',
  'settings',
  'reviews',
  'refunds',
] as const;

export type OperationsDomain = (typeof OPERATIONS_DOMAINS)[number];

export const ADMIN_ONLY_DOMAINS: ReadonlySet<OperationsDomain> = new Set([
  'audit-logs',
  'reconciliation',
  'admin-profiles',
  'settings',
]);

export const ADMIN_WRITE_DOMAINS: ReadonlySet<OperationsDomain> = new Set([
  ...ADMIN_ONLY_DOMAINS,
  'announcements',
  // Importers post reviews through POST /trucks/:id/reviews, which checks they shipped with the
  // truck. Through this generic API only an administrator may change them (moderation).
  'reviews',
  // Refund requests go through /refunds, which checks the booking and moves the money on approval.
  'refunds',
]);

export const PUBLIC_READ_DOMAINS: ReadonlySet<OperationsDomain> = new Set([
  'truck-profiles',
  'reviews',
]);

export const DELETABLE_DOMAINS: ReadonlySet<OperationsDomain> = new Set([
  'documents',
  'announcements',
]);

export const DOMAIN_WRITE_ROLES: Partial<
  Record<OperationsDomain, readonly UserRole[]>
> = {
  'cargo-requests': [UserRole.IMPORTER],
  quotations: [UserRole.TRUCK_OWNER],
  drivers: [UserRole.TRUCK_OWNER],
  documents: [UserRole.IMPORTER, UserRole.TRUCK_OWNER, UserRole.DRIVER],
  'verification-requests': [
    UserRole.IMPORTER,
    UserRole.TRUCK_OWNER,
    UserRole.DRIVER,
  ],
  'driver-assignments': [UserRole.TRUCK_OWNER],
  'truck-profiles': [UserRole.TRUCK_OWNER],
  shipments: [UserRole.TRUCK_OWNER],
  settlements: [UserRole.TRUCK_OWNER],
  payouts: [UserRole.TRUCK_OWNER],
  'insurance-policies': [UserRole.TRUCK_OWNER],
  'insurance-claims': [UserRole.TRUCK_OWNER],
};

export const DOMAIN_OWNER_FIELDS: Partial<Record<OperationsDomain, string>> = {
  'cargo-requests': 'importerId',
  quotations: 'ownerId',
  drivers: 'ownerId',
  shipments: 'ownerId',
  settlements: 'ownerId',
  payouts: 'ownerId',
  documents: 'ownerId',
  'verification-requests': 'requesterId',
  cancellations: 'requestedBy',
  'dispute-cases': 'raisedBy',
  incidents: 'reportedBy',
  'insurance-policies': 'ownerId',
  'support-tickets': 'createdBy',
  notifications: 'userId',
  'notification-preferences': 'userId',
  announcements: 'publishedBy',
  'audit-logs': 'actorId',
  'admin-profiles': 'userId',
  reviews: 'authorId',
  refunds: 'importerId',
};
