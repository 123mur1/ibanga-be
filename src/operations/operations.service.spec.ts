import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { JsonValue } from './dto/save-operations-record.dto';
import { OperationsService } from './operations.service';

describe('OperationsService', () => {
  const actor = { id: 'importer-1', role: UserRole.IMPORTER };
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    truck: {
      findUnique: jest.Mock;
    };
    operationsRecord: {
      create: jest.Mock;
      upsert: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: OperationsService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      truck: {
        findUnique: jest.fn(),
      },
      operationsRecord: {
        create: jest.fn(),
        upsert: jest.fn().mockImplementation((args: {
          create: { data: Record<string, JsonValue> };
        }) => Promise.resolve({ data: args.create.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(
        (
          operation:
            | Promise<unknown>[]
            | ((transaction: typeof prisma) => Promise<unknown>),
        ) =>
          typeof operation === 'function'
            ? operation(prisma)
            : Promise.all(operation),
      ),
    };
    service = new OperationsService(prisma as unknown as PrismaService);
  });

  it('assigns ownership from the authenticated actor when creating a record', async () => {
    let storedInput:
      | {
          domain: string;
          recordId: string;
          ownerId: string | null;
          searchText: string;
          data: Record<string, JsonValue>;
        }
      | undefined;
    prisma.operationsRecord.create.mockImplementation(
      (args: {
        data: {
          domain: string;
          recordId: string;
          ownerId: string | null;
          searchText: string;
          data: Record<string, JsonValue>;
        };
      }) => {
        storedInput = args.data;
        return Promise.resolve({ data: args.data.data });
      },
    );

    const result = await service.create('cargo-requests', actor, {
      data: { id: 'cargo-1', importerId: 'spoofed-user', title: 'Cargo' },
      draft: true,
    });

    expect(result).toMatchObject({
      id: 'cargo-1',
      importerId: actor.id,
      title: 'Cargo',
    });
    expect(storedInput).toMatchObject({
      domain: 'cargo-requests',
      recordId: 'cargo-1',
      ownerId: actor.id,
    });
    if (!storedInput) throw new Error('Expected the record to be stored.');
    expect(storedInput.searchText).toContain(
      'cargo-1 importer-1 Cargo DRAFT CR-',
    );
  });

  it('upserts derived shipments by stable id and booking id', async () => {
    const ownerActor = { id: 'owner-1', role: UserRole.TRUCK_OWNER };
    const shipment = {
      id: 'sh-booking-1',
      bookingId: 'booking-1',
      ownerId: ownerActor.id,
      importerId: actor.id,
      truckId: 'truck-1',
      status: 'SCHEDULED',
    };

    await service.create('shipments', ownerActor, { data: shipment });

    expect(prisma.operationsRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          domain_recordId: {
            domain: 'shipments',
            recordId: shipment.id,
          },
        },
        create: expect.objectContaining({
          domain: 'shipments',
          ownerId: ownerActor.id,
          parentId: shipment.bookingId,
        }),
        update: expect.objectContaining({
          ownerId: ownerActor.id,
          parentId: shipment.bookingId,
        }),
      }),
    );
    expect(prisma.operationsRecord.create).not.toHaveBeenCalled();
  });

  it('lets a driver submit documents only for the driver profile linked to their login', async () => {
    const driverActor = { id: 'driver-user-1', role: UserRole.DRIVER };
    prisma.operationsRecord.findFirst.mockResolvedValue({
      recordId: 'driver-record-1',
    });
    prisma.operationsRecord.create.mockImplementation((args: { data: { data: Record<string, JsonValue> } }) =>
      Promise.resolve({ data: args.data.data }),
    );

    const submitted = await service.create('documents', driverActor, {
      data: {
        id: 'licence-1',
        subjectKind: 'DRIVER',
        subjectId: 'driver-record-1',
        type: 'DRIVER_LICENCE',
        title: 'Driving licence',
        fileName: 'licence.pdf',
        fileUrl: 'data:application/pdf;base64,AA==',
      },
    });

    expect(submitted).toMatchObject({
      subjectKind: 'DRIVER',
      subjectId: 'driver-record-1',
    });
    expect(prisma.operationsRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: driverActor.id }) }),
    );

    await expect(
      service.create('documents', driverActor, {
        data: {
          id: 'other-licence',
          subjectKind: 'DRIVER',
          subjectId: 'another-driver',
          type: 'DRIVER_LICENCE',
          title: 'Someone else licence',
          fileName: 'licence.pdf',
          fileUrl: 'data:application/pdf;base64,AA==',
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a persisted driver account and owner-scoped driver record', async () => {
    let storedUser:
      { email: string; role: UserRole; passwordHash: string } | undefined;
    let storedDriver:
      | {
          domain: string;
          ownerId: string;
          truckId: string;
          status: string;
        }
      | undefined;
    const owner = {
      id: 'owner-1',
      role: UserRole.TRUCK_OWNER,
      active: true,
      location: 'Kigali',
      company: 'Haulage Ltd',
    };
    prisma.user.findUnique.mockResolvedValue(owner);
    prisma.truck.findUnique.mockResolvedValue({
      id: 'truck-1',
      ownerId: owner.id,
    });
    prisma.operationsRecord.findMany.mockResolvedValue([]);
    prisma.user.create.mockImplementation(
      (args: {
        data: {
          email: string;
          role: UserRole;
          passwordHash: string;
        };
      }) => {
        storedUser = args.data;
        return Promise.resolve({ id: 'driver-user-1' });
      },
    );
    prisma.operationsRecord.create.mockImplementation(
      (args: {
        data: {
          domain: string;
          ownerId: string;
          truckId: string;
          status: string;
        };
      }) => {
        storedDriver = {
          domain: args.data.domain,
          ownerId: args.data.ownerId,
          truckId: args.data.truckId,
          status: args.data.status,
        };
        return Promise.resolve({});
      },
    );

    const result = await service.createDriver(
      { id: owner.id, role: UserRole.TRUCK_OWNER },
      {
        name: 'Driver One',
        phone: '+250788000001',
        email: 'DRIVER@EXAMPLE.COM',
        password: 'secure-pass',
        nationalId: '123456789',
        licenceNumber: 'LIC-001',
        licenceCategory: 'C',
        licenceExpiry: '2030-01-01',
        status: 'AVAILABLE',
        assignedTruckId: 'truck-1',
      },
    );

    expect(result).toMatchObject({
      userId: 'driver-user-1',
      ownerId: owner.id,
      email: 'driver@example.com',
      assignedTruckId: 'truck-1',
      verification: 'NOT_SUBMITTED',
    });
    expect(storedUser).toMatchObject({
      email: 'driver@example.com',
      role: UserRole.DRIVER,
    });
    if (!storedUser)
      throw new Error('Expected the driver account to be saved.');
    expect(storedUser.passwordHash).not.toBe('secure-pass');
    expect(storedDriver).toEqual({
      domain: 'drivers',
      ownerId: owner.id,
      truckId: 'truck-1',
      status: 'AVAILABLE',
    });
  });

  it('rejects a truck that does not belong to the authenticated owner', async () => {
    const owner = {
      id: 'owner-1',
      role: UserRole.TRUCK_OWNER,
      active: true,
      location: 'Kigali',
      company: null,
    };
    prisma.user.findUnique.mockResolvedValue(owner);
    prisma.truck.findUnique.mockResolvedValue({
      id: 'truck-1',
      ownerId: 'another-owner',
    });

    await expect(
      service.createDriver(
        { id: owner.id, role: UserRole.TRUCK_OWNER },
        {
          name: 'Driver One',
          phone: '+250788000001',
          email: 'driver@example.com',
          password: 'secure-pass',
          nationalId: '123456789',
          licenceNumber: 'LIC-001',
          licenceCategory: 'C',
          licenceExpiry: '2030-01-01',
          status: 'AVAILABLE',
          assignedTruckId: 'truck-1',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('returns a driver own profile to their driver login', async () => {
    let query: { data?: unknown } | undefined;
    prisma.operationsRecord.findMany.mockImplementation(
      (args: { where: { data?: unknown } }) => {
        query = args.where;
        return Promise.resolve([]);
      },
    );
    prisma.operationsRecord.count.mockResolvedValue(0);

    const result = await service.list(
      'drivers',
      { id: 'driver-user-1', role: UserRole.DRIVER },
      {},
    );

    expect(result.items).toEqual([]);
    expect(query?.data).toEqual({
      path: ['userId'],
      equals: 'driver-user-1',
    });
  });

  it('scopes notification lists and read access to the authenticated user', async () => {
    let query: { ownerId?: string } | undefined;
    prisma.operationsRecord.findMany.mockImplementation(
      (args: { where: { ownerId?: string } }) => {
        query = args.where;
        return Promise.resolve([]);
      },
    );
    prisma.operationsRecord.count.mockResolvedValue(0);

    await service.list('notifications', actor, {});
    expect(query?.ownerId).toBe(actor.id);

    prisma.operationsRecord.findUnique.mockResolvedValue({
      ownerId: 'another-user',
      data: { id: 'notification-1', userId: 'another-user' },
      audience: null,
    });
    await expect(
      service.get('notifications', 'notification-1', actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents users from reading records owned by another account', async () => {
    prisma.operationsRecord.findUnique.mockResolvedValue({
      ownerId: 'another-user',
      data: { id: 'cargo-1' },
    });

    await expect(
      service.get('cargo-requests', 'cargo-1', actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('restricts administrative domains to administrators', async () => {
    await expect(service.list('audit-logs', actor, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects unsupported domains', async () => {
    await expect(service.list('unknown', actor, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not allow deleting settlement records', async () => {
    await expect(
      service.remove('settlements', 'settlement-1', {
        id: 'admin-1',
        role: UserRole.ADMIN,
      }),
    ).rejects.toThrow('This operations domain does not allow record deletion.');
  });
});
