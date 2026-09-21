import { TruckStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTruckDto } from './dto/create-truck.dto';
import { QueryTrucksDto } from './dto/query-trucks.dto';
import { UpdateTruckDto } from './dto/update-truck.dto';
export declare class TrucksService {
    private prisma;
    constructor(prisma: PrismaService);
    create(ownerId: string, dto: CreateTruckDto): import("@prisma/client").Prisma.Prisma__TruckClient<{
        owner: {
            email: string;
            name: string;
            phone: string | null;
            location: string | null;
            id: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        plateNumber: string;
        truckType: string;
        capacity: number;
        currentLocation: string | null;
        preferredRoute: string | null;
        description: string | null;
        photos: string[];
        status: import("@prisma/client").$Enums.TruckStatus;
        ownerId: string;
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    findAll(userId: string | undefined, userRole: UserRole | undefined, query: QueryTrucksDto): import("@prisma/client").Prisma.PrismaPromise<({
        owner: {
            email: string;
            name: string;
            phone: string | null;
            location: string | null;
            id: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        plateNumber: string;
        truckType: string;
        capacity: number;
        currentLocation: string | null;
        preferredRoute: string | null;
        description: string | null;
        photos: string[];
        status: import("@prisma/client").$Enums.TruckStatus;
        ownerId: string;
    })[]>;
    findOne(id: string): Promise<{
        owner: {
            email: string;
            name: string;
            phone: string | null;
            location: string | null;
            id: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        plateNumber: string;
        truckType: string;
        capacity: number;
        currentLocation: string | null;
        preferredRoute: string | null;
        description: string | null;
        photos: string[];
        status: import("@prisma/client").$Enums.TruckStatus;
        ownerId: string;
    }>;
    private findOwned;
    private hasActiveBooking;
    update(id: string, ownerId: string, dto: UpdateTruckDto): Promise<{
        owner: {
            email: string;
            name: string;
            phone: string | null;
            location: string | null;
            id: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        plateNumber: string;
        truckType: string;
        capacity: number;
        currentLocation: string | null;
        preferredRoute: string | null;
        description: string | null;
        photos: string[];
        status: import("@prisma/client").$Enums.TruckStatus;
        ownerId: string;
    }>;
    remove(id: string, ownerId: string): Promise<{
        id: string;
    }>;
    setAvailability(id: string, ownerId: string, status: TruckStatus): Promise<{
        owner: {
            email: string;
            name: string;
            phone: string | null;
            location: string | null;
            id: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        plateNumber: string;
        truckType: string;
        capacity: number;
        currentLocation: string | null;
        preferredRoute: string | null;
        description: string | null;
        photos: string[];
        status: import("@prisma/client").$Enums.TruckStatus;
        ownerId: string;
    }>;
}
