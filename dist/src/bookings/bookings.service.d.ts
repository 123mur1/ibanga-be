import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
type Actor = {
    id: string;
    role: UserRole;
};
export declare class BookingsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(actor: Actor, dto: CreateBookingDto): Promise<{
        truck: {
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
        };
        importer: {
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
        status: import("@prisma/client").$Enums.BookingStatus;
        truckId: string;
        importerId: string;
        cargoType: string;
        cargoDescription: string | null;
        cargoWeight: number;
        pickupLocation: string;
        destination: string;
        pickupDate: Date;
        expectedDeliveryDate: Date;
        additionalInstructions: string | null;
        agreedPrice: string;
    }>;
    findAll(actor: Actor): Prisma.PrismaPromise<({
        truck: {
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
        };
        importer: {
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
        status: import("@prisma/client").$Enums.BookingStatus;
        truckId: string;
        importerId: string;
        cargoType: string;
        cargoDescription: string | null;
        cargoWeight: number;
        pickupLocation: string;
        destination: string;
        pickupDate: Date;
        expectedDeliveryDate: Date;
        additionalInstructions: string | null;
        agreedPrice: string;
    })[]>;
    findOne(actor: Actor, id: string): Promise<{
        truck: {
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
        };
        importer: {
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
        status: import("@prisma/client").$Enums.BookingStatus;
        truckId: string;
        importerId: string;
        cargoType: string;
        cargoDescription: string | null;
        cargoWeight: number;
        pickupLocation: string;
        destination: string;
        pickupDate: Date;
        expectedDeliveryDate: Date;
        additionalInstructions: string | null;
        agreedPrice: string;
    }>;
    update(actor: Actor, id: string, dto: UpdateBookingDto): Promise<{
        truck: {
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
        };
        importer: {
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
        status: import("@prisma/client").$Enums.BookingStatus;
        truckId: string;
        importerId: string;
        cargoType: string;
        cargoDescription: string | null;
        cargoWeight: number;
        pickupLocation: string;
        destination: string;
        pickupDate: Date;
        expectedDeliveryDate: Date;
        additionalInstructions: string | null;
        agreedPrice: string;
    }>;
    private assertCanView;
    private assertStatusChange;
}
export {};
