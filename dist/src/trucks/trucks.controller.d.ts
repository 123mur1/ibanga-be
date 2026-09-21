import { UserRole } from '@prisma/client';
import { CreateTruckDto } from './dto/create-truck.dto';
import { QueryTrucksDto } from './dto/query-trucks.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateTruckDto } from './dto/update-truck.dto';
import { TrucksService } from './trucks.service';
type AuthedRequest = {
    user: {
        id: string;
        role: UserRole;
    };
};
type MaybeAuthedRequest = {
    user?: {
        id: string;
        role: UserRole;
    };
};
export declare class TrucksController {
    private trucks;
    constructor(trucks: TrucksService);
    create(req: AuthedRequest, dto: CreateTruckDto): import("@prisma/client").Prisma.Prisma__TruckClient<{
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
    findAll(req: MaybeAuthedRequest, query: QueryTrucksDto): import("@prisma/client").Prisma.PrismaPromise<({
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
    update(req: AuthedRequest, id: string, dto: UpdateTruckDto): Promise<{
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
    remove(req: AuthedRequest, id: string): Promise<{
        id: string;
    }>;
    setAvailability(req: AuthedRequest, id: string, dto: UpdateAvailabilityDto): Promise<{
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
export {};
