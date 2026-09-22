import { UserRole } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
type AuthedRequest = {
    user: {
        id: string;
        role: UserRole;
    };
};
export declare class BookingsController {
    private bookings;
    constructor(bookings: BookingsService);
    create(req: AuthedRequest, dto: CreateBookingDto): Promise<{
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
    findAll(req: AuthedRequest): import("@prisma/client").Prisma.PrismaPromise<({
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
    findOne(req: AuthedRequest, id: string): Promise<{
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
    update(req: AuthedRequest, id: string, dto: UpdateBookingDto): Promise<{
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
}
export {};
