import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, TruckStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  ADMIN_ONLY_DOMAINS,
  ADMIN_WRITE_DOMAINS,
  DELETABLE_DOMAINS,
  DOMAIN_OWNER_FIELDS,
  DOMAIN_WRITE_ROLES,
  OPERATIONS_DOMAINS,
  PUBLIC_READ_DOMAINS,
  type OperationsDomain,
} from './operations.constants';
import type {
  JsonValue,
  SaveOperationsRecordDto,
} from './dto/save-operations-record.dto';
import { CreateDriverDto } from './dto/create-driver.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UserSessionCache } from '../prisma/user-session-cache';

export type OperationsActor = { id: string; role: UserRole };

type OperationsRecordData = Record<string, JsonValue>;

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: UserSessionCache = new UserSessionCache(),
  ) {}

  private requireDomain(domain: string): OperationsDomain {
    if ((OPERATIONS_DOMAINS as readonly string[]).includes(domain)) {
      return domain as OperationsDomain;
    }
    throw new NotFoundException('Operations domain not found.');
  }

  private assertReadAccess(
    domain: OperationsDomain,
    actor: OperationsActor,
  ): void {
    if (ADMIN_ONLY_DOMAINS.has(domain) && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only administrators can access this operations domain.',
      );
    }
  }

  private recordData(value: Prisma.JsonValue): OperationsRecordData {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('Stored operations record is invalid.');
    }
    const data: OperationsRecordData = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) data[key] = this.toJsonValue(entry);
    }
    return data;
  }

  private toJsonValue(value: unknown): JsonValue {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (Array.isArray(value))
      return value.map((item) => this.toJsonValue(item));
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.toJsonValue(item),
        ]),
      );
    }
    throw new BadRequestException('Stored operations record is invalid.');
  }

  private objectData(value: JsonValue | undefined): OperationsRecordData {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('Cargo stop details are incomplete.');
    }
    const data: OperationsRecordData = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) data[key] = entry;
    }
    return data;
  }

  private makeReference(prefix: string): string {
    return `${prefix}-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private validateCargoRequest(data: OperationsRecordData, draft: boolean) {
    const errors: Record<string, string> = {};
    if (typeof data.title !== 'string' || data.title.trim().length < 3) {
      errors.title = 'Enter a short title for the cargo.';
    }
    if (!draft) {
      const pickup = data.pickup;
      const delivery = data.delivery;
      const pickupData =
        typeof pickup === 'object' && pickup !== null && !Array.isArray(pickup)
          ? pickup
          : {};
      const deliveryData =
        typeof delivery === 'object' &&
        delivery !== null &&
        !Array.isArray(delivery)
          ? delivery
          : {};
      if (
        typeof data.description !== 'string' ||
        data.description.trim().length < 10
      ) {
        errors.description = 'Describe the cargo in at least 10 characters.';
      }
      for (const [key, stop] of [
        ['pickup', pickupData],
        ['delivery', deliveryData],
      ] as const) {
        for (const field of ['location', 'date'] as const) {
          if (typeof stop[field] !== 'string' || !stop[field].trim()) {
            errors[`${key}.${field}`] = `Enter the ${key} ${field}.`;
          }
        }
      }
      for (const field of [
        'weightTons',
        'volumeM3',
        'lengthM',
        'widthM',
        'heightM',
        'minCapacityTons',
        'valueRwf',
      ] as const) {
        if (typeof data[field] !== 'number' || data[field] <= 0) {
          errors[field] = 'Enter a value above 0.';
        }
      }
      if (
        typeof pickupData.date === 'string' &&
        typeof deliveryData.date === 'string' &&
        deliveryData.date < pickupData.date
      ) {
        errors['delivery.date'] = 'Delivery cannot be before pickup.';
      }
      if (typeof data.truckType !== 'string' || !data.truckType.trim()) {
        errors.truckType = 'Choose the truck type you need.';
      }
    }
    if (Object.keys(errors).length) {
      throw new BadRequestException({
        message: 'Some required details are missing or invalid.',
        fieldErrors: errors,
      });
    }
  }

  private assertOwner(
    record: { ownerId: string | null },
    actor: OperationsActor,
  ) {
    if (actor.role !== UserRole.ADMIN && record.ownerId !== actor.id) {
      throw new ForbiddenException(
        'You can only manage your own operations records.',
      );
    }
  }

  private assertRecordReadAccess(
    domain: OperationsDomain,
    record: { ownerId: string | null; audience: string | null },
    actor: OperationsActor,
  ) {
    if (
      actor.role === UserRole.ADMIN ||
      PUBLIC_READ_DOMAINS.has(domain) ||
      record.ownerId === actor.id ||
      (domain === 'announcements' &&
        (record.audience === 'ALL' || record.audience === actor.role))
    ) {
      return;
    }
    throw new ForbiddenException(
      'You do not have permission to view this operations record.',
    );
  }

  private assertWriteAccess(domain: OperationsDomain, actor: OperationsActor) {
    if (ADMIN_WRITE_DOMAINS.has(domain) && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only administrators can modify this operations domain.',
      );
    }
    const allowedRoles = DOMAIN_WRITE_ROLES[domain];
    if (
      allowedRoles &&
      !allowedRoles.includes(actor.role) &&
      actor.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Your account role cannot modify this operations domain.',
      );
    }
  }

  private async assertDriverDocumentSubmission(
    domain: OperationsDomain,
    actor: OperationsActor,
    data: OperationsRecordData,
  ) {
    if (
      actor.role !== UserRole.DRIVER ||
      (domain !== 'documents' && domain !== 'verification-requests')
    ) {
      return;
    }
    const driver = await this.prisma.operationsRecord.findFirst({
      where: {
        domain: 'drivers',
        data: { path: ['userId'], equals: actor.id },
      },
      select: { recordId: true },
    });
    if (
      !driver ||
      data.subjectKind !== 'DRIVER' ||
      data.subjectId !== driver.recordId
    ) {
      throw new ForbiddenException(
        'Drivers can submit verification documents only for their own driver profile.',
      );
    }
    if (domain === 'verification-requests') {
      const documentIds = data.documentIds;
      if (
        !Array.isArray(documentIds) ||
        documentIds.some((id) => typeof id !== 'string')
      ) {
        throw new BadRequestException(
          'A verification request must include the submitted document ids.',
        );
      }
      const ids = documentIds as string[];
      const documents = await this.prisma.operationsRecord.findMany({
        where: {
          domain: 'documents',
          ownerId: actor.id,
          recordId: { in: ids },
        },
        select: { data: true },
      });
      const matching = documents.filter((document) => {
        const submitted = this.recordData(document.data);
        return (
          submitted.subjectKind === 'DRIVER' &&
          submitted.subjectId === driver.recordId
        );
      });
      if (matching.length !== ids.length) {
        throw new ForbiddenException(
          'Verification requests can include only your own driver documents.',
        );
      }
    }
  }

  private extractSearchText(value: JsonValue): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.extractSearchText(item)).join(' ');
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value)
        .map((item) => this.extractSearchText(item))
        .join(' ');
    }
    return '';
  }

  private normalizeData(
    domain: OperationsDomain,
    data: OperationsRecordData,
    actor: OperationsActor,
    recordId?: string,
  ): OperationsRecordData {
    const ownerField = DOMAIN_OWNER_FIELDS[domain];
    const normalized: OperationsRecordData = { ...data };
    if (recordId) normalized.id = recordId;
    else if (typeof normalized.id !== 'string' || !normalized.id) {
      normalized.id = randomUUID();
    }
    if (typeof normalized.ref !== 'string' || !normalized.ref) {
      const prefix =
        domain === 'cargo-requests'
          ? 'CR'
          : domain === 'quotations'
            ? 'QT'
            : 'OPS';
      normalized.ref = this.makeReference(prefix);
    }

    if (ownerField && actor.role !== UserRole.ADMIN) {
      normalized[ownerField] = actor.id;
    }
    // Only an administrator decides on documents. Whatever else an owner, importer or driver
    // sends, their submission waits for review; otherwise anyone could approve themselves.
    if (
      actor.role !== UserRole.ADMIN &&
      (domain === 'documents' || domain === 'verification-requests')
    ) {
      normalized.status = 'PENDING';
      delete normalized.reviewedAt;
      delete normalized.reviewedBy;
      delete normalized.rejectionReason;
    }
    return normalized;
  }

  /**
   * The owner of the truck a truck profile or truck document belongs to. Only that owner (or an
   * administrator) may write it, and a truck profile is always recorded as the owner's, even when
   * an administrator's review creates it.
   */
  private async truckOwnerFor(
    domain: OperationsDomain,
    data: OperationsRecordData,
    actor: OperationsActor,
  ): Promise<string | undefined> {
    const truckId =
      domain === 'truck-profiles'
        ? data.truckId
        : domain === 'documents' && data.subjectKind === 'TRUCK'
          ? data.subjectId
          : undefined;
    if (domain !== 'truck-profiles' && truckId === undefined) return undefined;
    if (typeof truckId !== 'string' || !truckId) {
      throw new BadRequestException('Choose the truck this record is for.');
    }
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
      select: { ownerId: true },
    });
    if (!truck) throw new NotFoundException('Truck not found.');
    if (actor.role !== UserRole.ADMIN && truck.ownerId !== actor.id) {
      throw new ForbiddenException('This truck belongs to another owner.');
    }
    return truck.ownerId;
  }

  /** Keeps the stored file when an update (for example a review decision) arrives without it. */
  private keepStoredFile(
    data: OperationsRecordData,
    existing: Prisma.JsonValue,
  ): OperationsRecordData {
    // `hasFile` only describes list responses; it is never stored.
    const rest = { ...data };
    delete rest.hasFile;
    if (typeof data.fileUrl === 'string' && data.fileUrl) return rest;
    const stored = this.recordData(existing);
    if (typeof stored.fileUrl !== 'string' || !stored.fileUrl) return rest;
    return { ...rest, fileUrl: stored.fileUrl };
  }

  /** Which records of a domain the actor may read. */
  private async readWhere(
    domain: OperationsDomain,
    actor: OperationsActor,
  ): Promise<Prisma.OperationsRecordWhereInput> {
    const where: Prisma.OperationsRecordWhereInput = { domain };
    if (actor.role === UserRole.ADMIN) return where;
    if (domain === 'cargo-requests' && actor.role === UserRole.TRUCK_OWNER) {
      where.status = { in: ['OPEN', 'QUOTED'] };
    } else if (domain === 'quotations' && actor.role === UserRole.IMPORTER) {
      const requests = await this.prisma.operationsRecord.findMany({
        where: { domain: 'cargo-requests', ownerId: actor.id },
        select: { recordId: true },
      });
      where.parentId = { in: requests.map((request) => request.recordId) };
      where.status = { not: 'WITHDRAWN' };
    } else if (domain === 'drivers' && actor.role === UserRole.DRIVER) {
      where.data = { path: ['userId'], equals: actor.id };
    } else if (domain === 'shipments') {
      where.OR = [
        { ownerId: actor.id },
        { data: { path: ['ownerId'], equals: actor.id } },
        { data: { path: ['importerId'], equals: actor.id } },
      ];
    } else if (domain === 'announcements') {
      where.OR = [
        { audience: 'ALL' },
        { audience: actor.role },
        { audience: null },
      ];
    } else if (!PUBLIC_READ_DOMAINS.has(domain)) {
      where.ownerId = actor.id;
    }
    return where;
  }

  /** A stored record as the actor receives it in a list. */
  private listItem(
    domain: OperationsDomain,
    record: { ownerId: string | null; data: Prisma.JsonValue },
    actor: OperationsActor,
  ): Prisma.JsonValue {
    if (
      (domain === 'shipments' || domain === 'settlements') &&
      actor.role === UserRole.TRUCK_OWNER &&
      record.ownerId === actor.id
    ) {
      return { ...this.recordData(record.data), ownerId: actor.id };
    }
    return record.data;
  }

  /**
   * Document records without their inline files, in the given order. The database strips the
   * file, so megabytes of data URLs never leave it (GET /operations/documents/:id returns one).
   */
  private async documentsWithoutFiles(
    recordIds: string[],
  ): Promise<Prisma.JsonValue[]> {
    if (!recordIds.length) return [];
    const rows = await this.prisma.$queryRaw<
      { recordId: string; data: Prisma.JsonValue }[]
    >`
      SELECT "recordId",
        CASE WHEN data->>'fileUrl' LIKE 'data:%'
          THEN (data - 'fileUrl') || '{"fileUrl": "", "hasFile": true}'::jsonb
          ELSE data
        END AS data
      FROM "OperationsRecord"
      WHERE domain = 'documents' AND "recordId" = ANY(${recordIds})
    `;
    const byId = new Map(rows.map((row) => [row.recordId, row.data]));
    return recordIds.flatMap((id) => {
      const data = byId.get(id);
      return data === undefined ? [] : [data];
    });
  }

  async list(
    domainName: string,
    actor: OperationsActor,
    options: { page?: number; pageSize?: number; search?: string },
  ) {
    const domain = this.requireDomain(domainName);
    this.assertReadAccess(domain, actor);
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(1000, Math.max(1, options.pageSize ?? 25));
    const where: Prisma.OperationsRecordWhereInput = {
      ...(await this.readWhere(domain, actor)),
      ...(options.search?.trim()
        ? {
            searchText: {
              contains: options.search.trim(),
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
    };
    const query = {
      where,
      orderBy: { updatedAt: 'desc' as const },
      skip: (page - 1) * pageSize,
      take: pageSize,
    };
    let items: Prisma.JsonValue[];
    if (domain === 'documents') {
      const ids = await this.prisma.operationsRecord.findMany({
        ...query,
        select: { recordId: true },
      });
      items = await this.documentsWithoutFiles(ids.map((row) => row.recordId));
    } else {
      const records = await this.prisma.operationsRecord.findMany(query);
      items = records.map((record) => this.listItem(domain, record, actor));
    }
    // A short first page already holds everything, so counting would only add a round trip.
    const total =
      page === 1 && items.length < pageSize
        ? items.length
        : await this.prisma.operationsRecord.count({ where });
    return { items, total, page, pageSize };
  }

  /**
   * Every readable record of several domains in one response, read with two queries. Loading a
   * dashboard used to send one request per domain, each paying for its own database round trips.
   */
  async snapshot(actor: OperationsActor, domainNames?: string[]) {
    const domains = (
      domainNames?.length
        ? [...new Set(domainNames)].map((name) => this.requireDomain(name))
        : [...OPERATIONS_DOMAINS]
    ).filter(
      (domain) =>
        actor.role === UserRole.ADMIN || !ADMIN_ONLY_DOMAINS.has(domain),
    );
    const wheres = await Promise.all(
      domains.map(
        async (domain) =>
          [domain, await this.readWhere(domain, actor)] as const,
      ),
    );
    const documentWhere = wheres.find(
      ([domain]) => domain === 'documents',
    )?.[1];
    const otherWheres = wheres
      .filter(([domain]) => domain !== 'documents')
      .map(([, where]) => where);
    const orderBy = { updatedAt: 'desc' as const };
    const [records, documents] = await Promise.all([
      otherWheres.length
        ? this.prisma.operationsRecord.findMany({
            where: { OR: otherWheres },
            orderBy,
          })
        : Promise.resolve([]),
      documentWhere
        ? this.prisma.operationsRecord
            .findMany({
              where: documentWhere,
              orderBy,
              select: { recordId: true },
            })
            .then((rows) =>
              this.documentsWithoutFiles(rows.map((row) => row.recordId)),
            )
        : Promise.resolve(null),
    ]);
    const result: Record<string, Prisma.JsonValue[]> = Object.fromEntries(
      domains.map((domain) => [domain, []]),
    );
    for (const record of records) {
      const domain = record.domain as OperationsDomain;
      result[domain]?.push(this.listItem(domain, record, actor));
    }
    if (documents) result.documents = documents;
    return result;
  }

  async get(domainName: string, recordId: string, actor: OperationsActor) {
    const domain = this.requireDomain(domainName);
    this.assertReadAccess(domain, actor);
    const record = await this.prisma.operationsRecord.findUnique({
      where: { domain_recordId: { domain, recordId } },
    });
    if (!record) throw new NotFoundException('Operations record not found.');
    if (domain === 'cargo-requests' && actor.role === UserRole.TRUCK_OWNER) {
      const data = this.recordData(record.data);
      if (data.status !== 'OPEN' && data.status !== 'QUOTED') {
        const quote = await this.prisma.operationsRecord.findFirst({
          where: {
            domain: 'quotations',
            parentId: recordId,
            ownerId: actor.id,
          },
        });
        if (!quote) {
          throw new ForbiddenException(
            'This cargo request is not available to truck owners.',
          );
        }
      }
      return data;
    }
    if (domain === 'quotations' && actor.role === UserRole.IMPORTER) {
      const quoteData = this.recordData(record.data);
      const cargoRequestId =
        typeof quoteData.cargoRequestId === 'string'
          ? quoteData.cargoRequestId
          : '';
      const request = await this.prisma.operationsRecord.findUnique({
        where: {
          domain_recordId: {
            domain: 'cargo-requests',
            recordId: cargoRequestId,
          },
        },
      });
      if (!request || request.ownerId !== actor.id) {
        throw new ForbiddenException(
          'You do not have permission to view this quotation.',
        );
      }
      return quoteData;
    }
    if (domain === 'drivers' && actor.role === UserRole.DRIVER) {
      const driverData = this.recordData(record.data);
      if (driverData.userId !== actor.id) {
        throw new ForbiddenException(
          'You do not have permission to view this driver record.',
        );
      }
      return driverData;
    }
    if (PUBLIC_READ_DOMAINS.has(domain)) return record.data;
    this.assertRecordReadAccess(domain, record, actor);
    return record.data;
  }

  async create(
    domainName: string,
    actor: OperationsActor,
    dto: SaveOperationsRecordDto,
  ) {
    const domain = this.requireDomain(domainName);
    this.assertWriteAccess(domain, actor);
    if (domain === 'quotations') {
      return this.submitQuotation(actor, dto.data);
    }
    const requestedStatus =
      domain === 'cargo-requests'
        ? dto.draft
          ? 'DRAFT'
          : 'OPEN'
        : typeof dto.data.status === 'string'
          ? dto.data.status
          : undefined;
    const input = {
      ...dto.data,
      ...(requestedStatus ? { status: requestedStatus } : {}),
    };
    const data = this.normalizeData(domain, input, actor);
    await this.assertDriverDocumentSubmission(domain, actor, data);
    const truckOwner = await this.truckOwnerFor(domain, data, actor);
    if (domain === 'cargo-requests') {
      this.validateCargoRequest(data, dto.draft === true);
    }
    const recordId = data.id;
    if (typeof recordId !== 'string') {
      throw new BadRequestException('Operations record id must be a string.');
    }
    const ownerField = DOMAIN_OWNER_FIELDS[domain];
    const ownerId =
      domain === 'truck-profiles'
        ? truckOwner
        : actor.role === UserRole.ADMIN && ownerField
          ? data[ownerField]
          : actor.id;
    if (ownerId !== undefined && typeof ownerId !== 'string') {
      throw new BadRequestException('Record owner id must be a string.');
    }
    try {
      const parentId =
        (domain === 'shipments' || domain === 'settlements') &&
        typeof data.bookingId === 'string'
          ? data.bookingId
          : typeof data.cargoRequestId === 'string'
            ? data.cargoRequestId
            : null;
      const recordData = {
        domain,
        recordId,
        ownerId: ownerId ?? null,
        audience:
          domain === 'announcements' && typeof data.audience === 'string'
            ? data.audience
            : null,
        parentId,
        status: typeof data.status === 'string' ? data.status : null,
        truckId: typeof data.truckId === 'string' ? data.truckId : null,
        searchText: this.extractSearchText(data),
        data,
      };
      const record =
        domain === 'shipments' || domain === 'settlements'
          ? await this.prisma.operationsRecord.upsert({
              where: { domain_recordId: { domain, recordId } },
              create: recordData,
              update: {
                ownerId: ownerId ?? null,
                parentId,
                truckId: recordData.truckId,
              },
            })
          : await this.prisma.operationsRecord.create({ data: recordData });
      return record.data;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'An operations record with this id already exists.',
        );
      }
      throw error;
    }
  }

  async createDriver(actor: OperationsActor, input: CreateDriverDto) {
    if (actor.role !== UserRole.TRUCK_OWNER && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only truck owners and administrators can register drivers.',
      );
    }

    const ownerId = actor.role === UserRole.ADMIN ? input.ownerId : actor.id;
    if (!ownerId) {
      throw new BadRequestException({
        message: 'Choose a truck owner for this driver.',
        fieldErrors: { ownerId: 'Choose a truck owner.' },
      });
    }

    const [owner, truck] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: ownerId },
        select: {
          id: true,
          role: true,
          active: true,
          location: true,
          company: true,
        },
      }),
      this.prisma.truck.findUnique({
        where: { id: input.assignedTruckId },
        select: { id: true, ownerId: true },
      }),
    ]);
    if (
      !owner ||
      owner.role !== UserRole.TRUCK_OWNER ||
      !owner.active ||
      (actor.role !== UserRole.ADMIN && owner.id !== actor.id)
    ) {
      throw new BadRequestException({
        message: 'Choose an active, registered truck owner.',
        fieldErrors: { ownerId: 'Choose an active truck owner.' },
      });
    }
    if (!truck || truck.ownerId !== owner.id) {
      throw new BadRequestException({
        message: "Choose a truck that belongs to this driver's owner.",
        fieldErrors: {
          assignedTruckId: "Choose one of this owner's trucks.",
        },
      });
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedLicence = input.licenceNumber.trim().toLowerCase();
    const existingLicence = await this.prisma.operationsRecord.findMany({
      where: {
        domain: 'drivers',
        searchText: {
          contains: normalizedLicence,
          mode: Prisma.QueryMode.insensitive,
        },
      },
      select: { data: true },
    });
    if (
      existingLicence.some((record) => {
        const data = this.recordData(record.data);
        return (
          typeof data.licenceNumber === 'string' &&
          data.licenceNumber.toLowerCase() === normalizedLicence
        );
      })
    ) {
      throw new ConflictException(
        'A driver with this licence number is already registered.',
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const now = new Date().toISOString();
    const recordId = randomUUID();
    const name = input.name.trim();
    const phone = input.phone.trim();
    const driverData: OperationsRecordData = {
      id: recordId,
      ref: this.makeReference('DRV'),
      ownerId: owner.id,
      name,
      phone,
      email: normalizedEmail,
      nationalId: input.nationalId.trim(),
      licenceNumber: input.licenceNumber.trim(),
      licenceCategory: input.licenceCategory.trim(),
      licenceExpiry: input.licenceExpiry,
      status: input.status,
      verification: 'NOT_SUBMITTED',
      assignedTruckId: truck.id,
      joinedAt: now,
      tripsCompleted: 0,
      onTimeRate: 0,
      rating: 0,
    };

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            name,
            email: normalizedEmail,
            phone,
            location: owner.location,
            company: owner.company,
            role: UserRole.DRIVER,
            passwordHash,
          },
          select: { id: true },
        });
        driverData.userId = user.id;

        await transaction.operationsRecord.create({
          data: {
            domain: 'drivers',
            recordId,
            ownerId: owner.id,
            status: input.status,
            truckId: truck.id,
            searchText: this.extractSearchText(driverData),
            data: driverData,
          },
        });
        return driverData;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A user with this email or a driver with these details already exists.',
        );
      }
      throw error;
    }
  }

  private async submitQuotation(
    actor: OperationsActor,
    input: OperationsRecordData,
  ) {
    if (actor.role !== UserRole.TRUCK_OWNER) {
      throw new ForbiddenException('Only truck owners can submit quotations.');
    }
    const requestId = input.cargoRequestId;
    const truckId = input.truckId;
    const amountRwf = input.amountRwf;
    const pickupDate = input.estimatedPickupDate;
    const deliveryDate = input.estimatedDeliveryDate;
    if (
      typeof requestId !== 'string' ||
      typeof truckId !== 'string' ||
      typeof amountRwf !== 'number' ||
      amountRwf < 1000 ||
      typeof pickupDate !== 'string' ||
      typeof deliveryDate !== 'string' ||
      !Number.isFinite(Date.parse(pickupDate)) ||
      !Number.isFinite(Date.parse(deliveryDate)) ||
      deliveryDate < pickupDate
    ) {
      throw new BadRequestException({
        message: 'Check the quotation details.',
        fieldErrors: {
          ...(typeof amountRwf !== 'number' || amountRwf < 1000
            ? { amountRwf: 'Enter a price of at least RWF 1,000.' }
            : {}),
          ...(!pickupDate || !deliveryDate || deliveryDate < pickupDate
            ? {
                estimatedDeliveryDate: 'Enter valid pickup and delivery dates.',
              }
            : {}),
        },
      });
    }
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
    });
    if (!truck || truck.ownerId !== actor.id) {
      throw new ForbiddenException('Choose one of your own trucks.');
    }
    if (truck.status !== TruckStatus.AVAILABLE) {
      throw new ConflictException('This truck is already held by a booking.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const lockedRequest = await transaction.operationsRecord.updateMany({
        where: {
          domain: 'cargo-requests',
          recordId: requestId,
          status: { in: ['OPEN', 'QUOTED'] },
        },
        data: { updatedAt: new Date() },
      });
      if (lockedRequest.count !== 1) {
        throw new ConflictException(
          'This request is no longer accepting quotations.',
        );
      }
      const request = await transaction.operationsRecord.findUnique({
        where: {
          domain_recordId: {
            domain: 'cargo-requests',
            recordId: requestId,
          },
        },
      });
      if (!request) throw new NotFoundException('Cargo request not found.');
      const requestData = this.recordData(request.data);
      if (
        typeof requestData.status !== 'string' ||
        !['OPEN', 'QUOTED'].includes(requestData.status)
      ) {
        throw new ConflictException(
          'This request is no longer accepting quotations.',
        );
      }
      if (
        typeof requestData.weightTons !== 'number' ||
        truck.capacity < requestData.weightTons
      ) {
        throw new BadRequestException(
          'This truck does not have enough cargo capacity.',
        );
      }
      if (
        typeof requestData.minCapacityTons === 'number' &&
        truck.capacity < requestData.minCapacityTons
      ) {
        throw new BadRequestException(
          'This truck is below the requested minimum capacity.',
        );
      }

      const existing = await transaction.operationsRecord.findMany({
        where: {
          domain: 'quotations',
          parentId: requestId,
          status: { in: ['SUBMITTED', 'ACCEPTED'] },
        },
      });
      if (
        existing.some(
          (quotation) => this.recordData(quotation.data).truckId === truckId,
        )
      ) {
        throw new ConflictException(
          'You already quoted this request with that truck.',
        );
      }
      if (existing.length >= 20) {
        throw new ConflictException(
          'This request already has the maximum number of quotations.',
        );
      }

      const now = new Date();
      const quotationData: OperationsRecordData = {
        ...input,
        id: randomUUID(),
        ref: this.makeReference('QT'),
        ownerId: actor.id,
        status: 'SUBMITTED',
        validUntil: new Date(
          now.getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        createdAt: now.toISOString(),
      };
      const quotationId = quotationData.id;
      if (typeof quotationId !== 'string') {
        throw new BadRequestException('Invalid quotation id.');
      }
      await transaction.operationsRecord.create({
        data: {
          domain: 'quotations',
          recordId: quotationId,
          parentId: requestId,
          ownerId: actor.id,
          status: 'SUBMITTED',
          truckId,
          searchText: this.extractSearchText(quotationData),
          data: quotationData,
        },
      });

      if (requestData.status === 'OPEN') {
        requestData.status = 'QUOTED';
        requestData.updatedAt = now.toISOString();
        await transaction.operationsRecord.update({
          where: {
            domain_recordId: {
              domain: 'cargo-requests',
              recordId: requestId,
            },
          },
          data: {
            status: 'QUOTED',
            searchText: this.extractSearchText(requestData),
            data: requestData,
          },
        });
      }
      return quotationData;
    });
  }

  async listQuotationsForRequest(requestId: string, actor: OperationsActor) {
    await this.get('cargo-requests', requestId, actor);
    const records = await this.prisma.operationsRecord.findMany({
      where: {
        domain: 'quotations',
        parentId: requestId,
        ...(actor.role === UserRole.ADMIN
          ? {}
          : actor.role === UserRole.IMPORTER
            ? { status: { not: 'WITHDRAWN' } }
            : { ownerId: actor.id }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => record.data);
  }

  async publishCargoDraft(recordId: string, actor: OperationsActor) {
    const request = this.recordData(
      await this.get('cargo-requests', recordId, actor),
    );
    if (request.status !== 'DRAFT') {
      throw new ConflictException('Only drafts can be published.');
    }
    this.validateCargoRequest(request, false);
    request.status = 'OPEN';
    request.updatedAt = new Date().toISOString();
    const updated = await this.prisma.operationsRecord.update({
      where: {
        domain_recordId: { domain: 'cargo-requests', recordId },
      },
      data: {
        status: 'OPEN',
        searchText: this.extractSearchText(request),
        data: request,
      },
    });
    return updated.data;
  }

  async cancelCargoRequest(
    recordId: string,
    actor: OperationsActor,
    reason: string,
  ) {
    if (!reason.trim()) {
      throw new BadRequestException({
        message: 'Tell us why you are cancelling.',
        fieldErrors: { reason: 'Enter a reason.' },
      });
    }
    return this.prisma.$transaction(async (transaction) => {
      const record = await transaction.operationsRecord.findUnique({
        where: {
          domain_recordId: {
            domain: 'cargo-requests',
            recordId,
          },
        },
      });
      if (!record) throw new NotFoundException('Cargo request not found.');
      this.assertOwner(record, actor);
      const request = this.recordData(record.data);
      if (
        typeof request.status !== 'string' ||
        !['DRAFT', 'OPEN', 'QUOTED'].includes(request.status)
      ) {
        throw new ConflictException(
          'This request can no longer be cancelled here.',
        );
      }
      const now = new Date().toISOString();
      request.status = 'CANCELLED';
      request.cancelledReason = reason.trim();
      request.updatedAt = now;
      await transaction.operationsRecord.update({
        where: {
          domain_recordId: { domain: 'cargo-requests', recordId },
        },
        data: {
          status: 'CANCELLED',
          searchText: this.extractSearchText(request),
          data: request,
        },
      });
      const quotations = await transaction.operationsRecord.findMany({
        where: {
          domain: 'quotations',
          parentId: recordId,
          status: 'SUBMITTED',
        },
      });
      await Promise.all(
        quotations.map(async (quotation) => {
          const data = this.recordData(quotation.data);
          data.status = 'REJECTED';
          data.respondedAt = now;
          await transaction.operationsRecord.update({
            where: {
              domain_recordId: {
                domain: 'quotations',
                recordId: quotation.recordId,
              },
            },
            data: {
              status: 'REJECTED',
              searchText: this.extractSearchText(data),
              data,
            },
          });
        }),
      );
      return request;
    });
  }

  async withdrawQuotation(recordId: string, actor: OperationsActor) {
    return this.prisma.$transaction(async (transaction) => {
      const record = await transaction.operationsRecord.findUnique({
        where: {
          domain_recordId: { domain: 'quotations', recordId },
        },
      });
      if (!record) throw new NotFoundException('Quotation not found.');
      this.assertOwner(record, actor);
      const quotation = this.recordData(record.data);
      if (quotation.status !== 'SUBMITTED') {
        throw new ConflictException(
          'Only submitted quotations can be withdrawn.',
        );
      }
      const now = new Date().toISOString();
      quotation.status = 'WITHDRAWN';
      quotation.respondedAt = now;
      await transaction.operationsRecord.update({
        where: {
          domain_recordId: { domain: 'quotations', recordId },
        },
        data: {
          status: 'WITHDRAWN',
          searchText: this.extractSearchText(quotation),
          data: quotation,
        },
      });
      const requestId =
        typeof quotation.cargoRequestId === 'string'
          ? quotation.cargoRequestId
          : '';
      const remaining = await transaction.operationsRecord.count({
        where: {
          domain: 'quotations',
          parentId: requestId,
          status: 'SUBMITTED',
        },
      });
      if (remaining === 0) {
        const request = await transaction.operationsRecord.findUnique({
          where: {
            domain_recordId: {
              domain: 'cargo-requests',
              recordId: requestId,
            },
          },
        });
        if (request?.status === 'QUOTED') {
          const data = this.recordData(request.data);
          data.status = 'OPEN';
          data.updatedAt = now;
          await transaction.operationsRecord.update({
            where: {
              domain_recordId: {
                domain: 'cargo-requests',
                recordId: requestId,
              },
            },
            data: {
              status: 'OPEN',
              searchText: this.extractSearchText(data),
              data,
            },
          });
        }
      }
      return quotation;
    });
  }

  async acceptQuotation(
    recordId: string,
    actor: OperationsActor,
  ): Promise<{
    quotation: OperationsRecordData;
    shipment: OperationsRecordData;
    booking: { id: string };
  }> {
    if (actor.role !== UserRole.IMPORTER) {
      throw new ForbiddenException('Only the importer can accept a quotation.');
    }
    return this.prisma.$transaction(async (transaction) => {
      const quotationRecord = await transaction.operationsRecord.findUnique({
        where: {
          domain_recordId: { domain: 'quotations', recordId },
        },
      });
      if (!quotationRecord) {
        throw new NotFoundException('Quotation not found.');
      }
      const quotation = this.recordData(quotationRecord.data);
      const requestId = quotation.cargoRequestId;
      if (typeof requestId !== 'string') {
        throw new BadRequestException('Quotation has no cargo request.');
      }
      const requestRecord = await transaction.operationsRecord.findUnique({
        where: {
          domain_recordId: {
            domain: 'cargo-requests',
            recordId: requestId,
          },
        },
      });
      if (!requestRecord) {
        throw new NotFoundException('Cargo request not found.');
      }
      this.assertOwner(requestRecord, actor);
      const request = this.recordData(requestRecord.data);
      if (request.status === 'BOOKED' || request.acceptedQuotationId) {
        throw new ConflictException(
          'This request is already booked. No second booking was created.',
        );
      }
      if (request.status !== 'OPEN' && request.status !== 'QUOTED') {
        throw new ConflictException(
          'This request is no longer accepting quotations.',
        );
      }
      if (quotation.status !== 'SUBMITTED') {
        throw new ConflictException('This quotation is no longer available.');
      }
      if (
        typeof quotation.validUntil === 'string' &&
        Date.parse(quotation.validUntil) < Date.now()
      ) {
        throw new ConflictException(
          'This quotation has expired. Ask the owner for a new one.',
        );
      }
      if (
        typeof quotation.truckId !== 'string' ||
        typeof quotation.ownerId !== 'string' ||
        typeof quotation.amountRwf !== 'number'
      ) {
        throw new BadRequestException('Quotation details are incomplete.');
      }
      const claimedRequest = await transaction.operationsRecord.updateMany({
        where: {
          domain: 'cargo-requests',
          recordId: requestId,
          status: { in: ['OPEN', 'QUOTED'] },
        },
        data: { status: 'BOOKED' },
      });
      if (claimedRequest.count !== 1) {
        throw new ConflictException(
          'This request is already booked. No second booking was created.',
        );
      }
      const truck = await transaction.truck.updateMany({
        where: {
          id: quotation.truckId,
          ownerId: quotation.ownerId,
          status: TruckStatus.AVAILABLE,
          capacity: {
            gte:
              typeof request.weightTons === 'number'
                ? request.weightTons
                : Number.MAX_SAFE_INTEGER,
          },
        },
        data: { status: TruckStatus.UNAVAILABLE },
      });
      if (truck.count !== 1) {
        throw new ConflictException(
          'The quoted truck is no longer available for this cargo.',
        );
      }
      const pickup = this.objectData(request.pickup);
      const delivery = this.objectData(request.delivery);
      const pickupDate = quotation.estimatedPickupDate;
      const deliveryDate = quotation.estimatedDeliveryDate;
      if (
        typeof pickupDate !== 'string' ||
        typeof deliveryDate !== 'string' ||
        typeof pickup.location !== 'string' ||
        typeof delivery.location !== 'string' ||
        typeof request.weightTons !== 'number'
      ) {
        throw new BadRequestException(
          'Cargo or quotation details are incomplete.',
        );
      }
      const categoryNames: Record<string, string> = {
        GENERAL: 'General cargo',
        BUILDING_MATERIALS: 'Building materials',
        PERISHABLES: 'Perishables',
        MACHINERY: 'Machinery',
        FUEL_CHEMICALS: 'Fuel and chemicals',
        AGRICULTURE: 'Agricultural goods',
        RETAIL_GOODS: 'Retail goods',
        OTHER: 'Other cargo',
      };
      const category =
        typeof request.category === 'string' ? request.category : 'GENERAL';
      const bookingId = randomUUID();
      const booking = await transaction.booking.create({
        data: {
          id: bookingId,
          truckId: quotation.truckId,
          importerId: actor.id,
          cargoType: categoryNames[category] ?? 'General cargo',
          cargoDescription:
            typeof request.description === 'string'
              ? request.description
              : null,
          cargoWeight: request.weightTons,
          pickupLocation: pickup.location,
          destination: delivery.location,
          pickupDate: new Date(pickupDate),
          expectedDeliveryDate: new Date(deliveryDate),
          additionalInstructions:
            typeof request.instructions === 'string'
              ? request.instructions
              : null,
          agreedPrice: `RWF ${quotation.amountRwf.toLocaleString('en-RW')}`,
          agreedPriceRwf: quotation.amountRwf,
          status: BookingStatus.ACCEPTED,
        },
        select: { id: true },
      });
      const now = new Date().toISOString();
      quotation.status = 'ACCEPTED';
      quotation.respondedAt = now;
      await transaction.operationsRecord.update({
        where: {
          domain_recordId: { domain: 'quotations', recordId },
        },
        data: {
          status: 'ACCEPTED',
          searchText: this.extractSearchText(quotation),
          data: quotation,
        },
      });
      const competingQuotes = await transaction.operationsRecord.findMany({
        where: {
          domain: 'quotations',
          parentId: requestId,
          status: 'SUBMITTED',
          recordId: { not: recordId },
        },
      });
      await Promise.all(
        competingQuotes.map(async (record) => {
          const competing = this.recordData(record.data);
          competing.status = 'REJECTED';
          competing.respondedAt = now;
          await transaction.operationsRecord.update({
            where: {
              domain_recordId: {
                domain: 'quotations',
                recordId: record.recordId,
              },
            },
            data: {
              status: 'REJECTED',
              searchText: this.extractSearchText(competing),
              data: competing,
            },
          });
        }),
      );
      request.status = 'BOOKED';
      request.acceptedQuotationId = recordId;
      request.bookingId = booking.id;
      request.updatedAt = now;
      await transaction.operationsRecord.update({
        where: {
          domain_recordId: {
            domain: 'cargo-requests',
            recordId: requestId,
          },
        },
        data: {
          status: 'BOOKED',
          searchText: this.extractSearchText(request),
          data: request,
        },
      });
      const shipment: OperationsRecordData = {
        id: randomUUID(),
        ref: this.makeReference('SHP'),
        bookingId: booking.id,
        cargoRequestId: requestId,
        ownerId: quotation.ownerId,
        importerId: actor.id,
        truckId: quotation.truckId,
        ...(typeof quotation.driverId === 'string'
          ? { driverId: quotation.driverId }
          : {}),
        status: 'SCHEDULED',
        etaDate: deliveryDate,
        milestones: [],
        createdAt: now,
      };
      const shipmentId = shipment.id;
      if (typeof shipmentId !== 'string') {
        throw new BadRequestException('Could not create shipment.');
      }
      await transaction.operationsRecord.create({
        data: {
          domain: 'shipments',
          recordId: shipmentId,
          ownerId: quotation.ownerId,
          parentId: booking.id,
          status: 'SCHEDULED',
          truckId: quotation.truckId,
          searchText: this.extractSearchText(shipment),
          data: shipment,
        },
      });
      return { quotation, shipment, booking };
    });
  }

  async update(
    domainName: string,
    recordId: string,
    actor: OperationsActor,
    dto: SaveOperationsRecordDto,
  ) {
    const domain = this.requireDomain(domainName);
    this.assertWriteAccess(domain, actor);
    const existing = await this.prisma.operationsRecord.findUnique({
      where: { domain_recordId: { domain, recordId } },
    });
    if (!existing) throw new NotFoundException('Operations record not found.');
    // A truck profile belongs to whoever owns the truck now; that is checked below.
    if (domain !== 'truck-profiles') this.assertOwner(existing, actor);
    if (domain === 'drivers') {
      return this.updateDriverRecord(recordId, existing, dto);
    }
    let data = this.normalizeData(domain, dto.data, actor, recordId);
    if (domain === 'documents') data = this.keepStoredFile(data, existing.data);
    if (domain === 'truck-profiles' && existing.truckId) {
      data.truckId = existing.truckId;
    }
    const truckOwner = await this.truckOwnerFor(domain, data, actor);
    if (domain === 'cargo-requests') {
      const current = this.recordData(existing.data);
      if (
        typeof current.status !== 'string' ||
        !['DRAFT', 'OPEN'].includes(current.status)
      ) {
        throw new ConflictException(
          'Quotations already exist for this request. Cancel it and create a new one to change the cargo.',
        );
      }
      const submittedQuotes = await this.prisma.operationsRecord.count({
        where: {
          domain: 'quotations',
          parentId: recordId,
          status: { in: ['SUBMITTED', 'ACCEPTED'] },
        },
      });
      if (submittedQuotes > 0) {
        throw new ConflictException(
          'Quotations already exist for this request. Cancel it and create a new one to change the cargo.',
        );
      }
      data.status = current.status;
      data.ref = current.ref;
      data.createdAt = current.createdAt;
      this.validateCargoRequest(data, current.status === 'DRAFT');
    }
    const ownerField = DOMAIN_OWNER_FIELDS[domain];
    const ownerValue =
      actor.role === UserRole.ADMIN && ownerField
        ? data[ownerField]
        : undefined;
    if (ownerValue !== undefined && typeof ownerValue !== 'string') {
      throw new BadRequestException('Record owner id must be a string.');
    }
    const updated = await this.prisma.operationsRecord.update({
      where: { domain_recordId: { domain, recordId } },
      data: {
        data,
        searchText: this.extractSearchText(data),
        parentId:
          typeof data.cargoRequestId === 'string' ? data.cargoRequestId : null,
        status: typeof data.status === 'string' ? data.status : null,
        truckId: typeof data.truckId === 'string' ? data.truckId : null,
        ...(domain === 'cargo-requests'
          ? { status: typeof data.status === 'string' ? data.status : null }
          : {}),
        ...(domain === 'announcements' && actor.role === UserRole.ADMIN
          ? {
              audience:
                typeof data.audience === 'string' ? data.audience : null,
            }
          : {}),
        ...(actor.role === UserRole.ADMIN && ownerField
          ? { ownerId: typeof ownerValue === 'string' ? ownerValue : null }
          : {}),
        ...(domain === 'truck-profiles' ? { ownerId: truckOwner } : {}),
      },
    });
    return updated.data;
  }

  private async updateDriverRecord(
    recordId: string,
    existing: { ownerId: string | null; data: Prisma.JsonValue },
    dto: SaveOperationsRecordDto,
  ) {
    const current = this.recordData(existing.data);
    const data: OperationsRecordData = {
      ...current,
      ...dto.data,
      id: recordId,
      ownerId: existing.ownerId,
    };
    if (typeof current.userId === 'string') data.userId = current.userId;
    if (typeof current.ref === 'string') data.ref = current.ref;
    if (typeof current.joinedAt === 'string') data.joinedAt = current.joinedAt;
    if (existing.ownerId === null) {
      throw new BadRequestException('This driver has no registered owner.');
    }
    if (
      typeof data.name !== 'string' ||
      typeof data.email !== 'string' ||
      typeof data.phone !== 'string'
    ) {
      throw new BadRequestException(
        'Driver name, email, and phone are required.',
      );
    }

    const name = data.name.trim();
    const email = data.email.trim().toLowerCase();
    const phone = data.phone.trim();
    data.name = name;
    data.email = email;
    data.phone = phone;
    if (typeof data.assignedTruckId === 'string') {
      const truck = await this.prisma.truck.findUnique({
        where: { id: data.assignedTruckId },
        select: { id: true, ownerId: true },
      });
      if (!truck || truck.ownerId !== existing.ownerId) {
        throw new BadRequestException({
          message: "Choose a truck that belongs to this driver's owner.",
          fieldErrors: {
            assignedTruckId: "Choose one of this owner's trucks.",
          },
        });
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        if (typeof data.userId === 'string') {
          this.sessions.invalidate(data.userId);
          await transaction.user.update({
            where: { id: data.userId },
            data: {
              name,
              email,
              phone,
            },
          });
        }
        return transaction.operationsRecord.update({
          where: {
            domain_recordId: { domain: 'drivers', recordId },
          },
          data: {
            data,
            searchText: this.extractSearchText(data),
            status: typeof data.status === 'string' ? data.status : null,
            truckId:
              typeof data.assignedTruckId === 'string'
                ? data.assignedTruckId
                : null,
          },
        });
      });
      return updated.data;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A user with this email is already registered.',
        );
      }
      throw error;
    }
  }

  async remove(domainName: string, recordId: string, actor: OperationsActor) {
    const domain = this.requireDomain(domainName);
    this.assertWriteAccess(domain, actor);
    if (!DELETABLE_DOMAINS.has(domain)) {
      throw new ForbiddenException(
        'This operations domain does not allow record deletion.',
      );
    }
    const existing = await this.prisma.operationsRecord.findUnique({
      where: { domain_recordId: { domain, recordId } },
    });
    if (!existing) throw new NotFoundException('Operations record not found.');
    this.assertOwner(existing, actor);
    await this.prisma.operationsRecord.delete({
      where: { domain_recordId: { domain, recordId } },
    });
    return { id: recordId };
  }
}
