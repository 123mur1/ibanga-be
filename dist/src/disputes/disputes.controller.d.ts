import { UserRole } from '@prisma/client';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputesService } from './disputes.service';
type AuthedRequest = {
    user: {
        id: string;
        role: UserRole;
    };
};
export declare class DisputesController {
    private disputes;
    constructor(disputes: DisputesService);
    create(req: AuthedRequest, dto: CreateDisputeDto): Promise<{
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
    findAll(req: AuthedRequest): import("@prisma/client").Prisma.PrismaPromise<({
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
    resolve(req: AuthedRequest, id: string, dto: ResolveDisputeDto): Promise<{
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
