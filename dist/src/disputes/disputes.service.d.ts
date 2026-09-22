import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
type Actor = {
    id: string;
    role: UserRole;
};
export declare class DisputesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(actor: Actor, dto: CreateDisputeDto): Promise<{
        booking: {
            truck: {
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
        };
    } & {
        id: string;
        createdAt: Date;
        status: import("@prisma/client").$Enums.DisputeStatus;
        raisedBy: string;
        bookingId: string;
        reason: string;
        resolutionNotes: string | null;
        resolvedAt: Date | null;
    }>;
    findAll(actor: Actor): Prisma.PrismaPromise<({
        booking: {
            truck: {
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
        };
    } & {
        id: string;
        createdAt: Date;
        status: import("@prisma/client").$Enums.DisputeStatus;
        raisedBy: string;
        bookingId: string;
        reason: string;
        resolutionNotes: string | null;
        resolvedAt: Date | null;
    })[]>;
    resolve(actor: Actor, id: string, resolutionNotes: string): Promise<{
        booking: {
            truck: {
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
        };
    } & {
        id: string;
        createdAt: Date;
        status: import("@prisma/client").$Enums.DisputeStatus;
        raisedBy: string;
        bookingId: string;
        reason: string;
        resolutionNotes: string | null;
        resolvedAt: Date | null;
    }>;
}
export {};
