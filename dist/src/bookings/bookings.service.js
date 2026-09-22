"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const BOOKING_INCLUDE = {
    truck: {
        include: {
            owner: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    location: true,
                },
            },
        },
    },
    importer: {
        select: { id: true, name: true, email: true, phone: true, location: true },
    },
};
let BookingsService = class BookingsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(actor, dto) {
        if (actor.role !== client_1.UserRole.IMPORTER)
            throw new common_1.ForbiddenException('Only importers can create bookings.');
        const pickupDate = new Date(dto.pickupDate);
        const expectedDeliveryDate = new Date(dto.expectedDeliveryDate);
        if (expectedDeliveryDate < pickupDate)
            throw new common_1.BadRequestException('Expected delivery must be after pickup.');
        const truck = await this.prisma.truck.findUnique({
            where: { id: dto.truckId },
        });
        if (!truck)
            throw new common_1.NotFoundException('Truck not found.');
        if (truck.status !== client_1.TruckStatus.AVAILABLE)
            throw new common_1.BadRequestException('This truck is not available to book.');
        if (dto.cargoWeight > truck.capacity)
            throw new common_1.BadRequestException('Cargo weight exceeds this truck capacity.');
        const created = await this.prisma.$queryRaw `
      WITH claimed_truck AS (
        UPDATE "Truck"
        SET "status" = CAST(${client_1.TruckStatus.UNAVAILABLE} AS "TruckStatus")
        WHERE "id" = ${truck.id}
          AND "status" = CAST(${client_1.TruckStatus.AVAILABLE} AS "TruckStatus")
        RETURNING "id"
      )
      INSERT INTO "Booking" (
        "truckId", "importerId", "cargoType", "cargoDescription",
        "cargoWeight", "pickupLocation", "destination", "pickupDate",
        "expectedDeliveryDate", "additionalInstructions"
      )
      SELECT
        "id", ${actor.id}, ${dto.cargoType}, ${dto.cargoDescription ?? null},
        ${dto.cargoWeight}, ${dto.pickupLocation}, ${dto.destination}, ${pickupDate},
        ${expectedDeliveryDate}, ${dto.additionalInstructions ?? null}
      FROM claimed_truck
      RETURNING "id"
    `;
        if (created.length !== 1) {
            throw new common_1.BadRequestException('This truck was just booked by another importer.');
        }
        return this.prisma.booking.findUniqueOrThrow({
            where: { id: created[0].id },
            include: BOOKING_INCLUDE,
        });
    }
    findAll(actor) {
        const where = actor.role === client_1.UserRole.ADMIN
            ? {}
            : actor.role === client_1.UserRole.IMPORTER
                ? { importerId: actor.id }
                : { truck: { ownerId: actor.id } };
        return this.prisma.booking.findMany({
            where,
            include: BOOKING_INCLUDE,
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(actor, id) {
        const booking = await this.prisma.booking.findUnique({
            where: { id },
            include: BOOKING_INCLUDE,
        });
        if (!booking)
            throw new common_1.NotFoundException('Booking not found.');
        this.assertCanView(actor, booking);
        return booking;
    }
    async update(actor, id, dto) {
        if (!dto.status && dto.agreedPrice === undefined)
            throw new common_1.BadRequestException('Provide a status or agreed price.');
        const booking = await this.findOne(actor, id);
        const isOwner = booking.truck.ownerId === actor.id;
        const isImporter = booking.importerId === actor.id;
        if (dto.agreedPrice !== undefined &&
            (!isOwner || booking.status !== client_1.BookingStatus.PENDING)) {
            throw new common_1.ForbiddenException('Only the truck owner can set the price on a pending booking.');
        }
        if (dto.status)
            this.assertStatusChange(actor, booking.status, dto.status, isOwner, isImporter, booking.agreedPrice, dto.agreedPrice);
        const updated = await this.prisma.booking.update({
            where: { id },
            data: {
                ...(dto.agreedPrice !== undefined
                    ? { agreedPrice: dto.agreedPrice.trim() }
                    : {}),
                ...(dto.status ? { status: dto.status } : {}),
            },
            include: BOOKING_INCLUDE,
        });
        if (dto.status === client_1.BookingStatus.REJECTED ||
            dto.status === client_1.BookingStatus.COMPLETED) {
            await this.prisma.truck.update({
                where: { id: booking.truckId },
                data: { status: client_1.TruckStatus.AVAILABLE },
            });
        }
        return updated;
    }
    assertCanView(actor, booking) {
        if (actor.role !== client_1.UserRole.ADMIN &&
            booking.importerId !== actor.id &&
            booking.truck.ownerId !== actor.id) {
            throw new common_1.ForbiddenException('You cannot access this booking.');
        }
    }
    assertStatusChange(actor, current, next, isOwner, isImporter, agreedPrice, nextPrice) {
        if (actor.role === client_1.UserRole.ADMIN)
            return;
        const ownerTransitions = {
            PENDING: [client_1.BookingStatus.ACCEPTED, client_1.BookingStatus.REJECTED],
            ACCEPTED: [client_1.BookingStatus.IN_PROGRESS],
            IN_PROGRESS: [client_1.BookingStatus.DELIVERED],
        };
        const allowed = isOwner
            ? ownerTransitions[current]
            : isImporter && current === client_1.BookingStatus.DELIVERED
                ? [client_1.BookingStatus.COMPLETED]
                : [];
        if (!allowed?.includes(next))
            throw new common_1.ForbiddenException('That booking status change is not allowed.');
        if (next === client_1.BookingStatus.ACCEPTED && !(nextPrice ?? agreedPrice).trim())
            throw new common_1.BadRequestException('Agree a price before accepting this booking.');
    }
};
exports.BookingsService = BookingsService;
exports.BookingsService = BookingsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BookingsService);
//# sourceMappingURL=bookings.service.js.map