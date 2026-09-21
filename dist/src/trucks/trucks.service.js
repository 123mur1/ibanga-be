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
exports.TrucksService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const OWNER_SELECT = {
    id: true,
    name: true,
    email: true,
    phone: true,
    location: true,
};
const TRUCK_INCLUDE = { owner: { select: OWNER_SELECT } };
const ACTIVE_BOOKING_STATUSES = [
    client_1.BookingStatus.PENDING,
    client_1.BookingStatus.ACCEPTED,
    client_1.BookingStatus.IN_PROGRESS,
    client_1.BookingStatus.DELIVERED,
    client_1.BookingStatus.DISPUTED,
];
let TrucksService = class TrucksService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(ownerId, dto) {
        return this.prisma.truck.create({
            data: { ...dto, ownerId },
            include: TRUCK_INCLUDE,
        });
    }
    findAll(userId, userRole, query) {
        if (query.mine) {
            if (!userId || userRole !== client_1.UserRole.TRUCK_OWNER) {
                throw new common_1.ForbiddenException('Only truck owners can view their own fleet.');
            }
            return this.prisma.truck.findMany({
                where: { ownerId: userId },
                include: TRUCK_INCLUDE,
                orderBy: { createdAt: 'desc' },
            });
        }
        return this.prisma.truck.findMany({
            where: {
                status: client_1.TruckStatus.AVAILABLE,
                ...(query.location
                    ? { currentLocation: { equals: query.location, mode: 'insensitive' } }
                    : {}),
                ...(query.truckType
                    ? { truckType: { equals: query.truckType, mode: 'insensitive' } }
                    : {}),
                ...(query.route
                    ? { preferredRoute: { contains: query.route, mode: 'insensitive' } }
                    : {}),
                ...(query.minCapacity ? { capacity: { gte: query.minCapacity } } : {}),
            },
            include: TRUCK_INCLUDE,
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(id) {
        const truck = await this.prisma.truck.findUnique({
            where: { id },
            include: TRUCK_INCLUDE,
        });
        if (!truck)
            throw new common_1.NotFoundException('Truck not found.');
        return truck;
    }
    async findOwned(id, ownerId) {
        const truck = await this.prisma.truck.findUnique({ where: { id } });
        if (!truck)
            throw new common_1.NotFoundException('Truck not found.');
        if (truck.ownerId !== ownerId) {
            throw new common_1.ForbiddenException('You can only manage your own trucks.');
        }
        return truck;
    }
    hasActiveBooking(truckId) {
        return this.prisma.booking.findFirst({
            where: { truckId, status: { in: ACTIVE_BOOKING_STATUSES } },
        });
    }
    async update(id, ownerId, dto) {
        await this.findOwned(id, ownerId);
        return this.prisma.truck.update({
            where: { id },
            data: dto,
            include: TRUCK_INCLUDE,
        });
    }
    async remove(id, ownerId) {
        await this.findOwned(id, ownerId);
        const active = await this.hasActiveBooking(id);
        if (active) {
            throw new common_1.ForbiddenException('Cannot delete a truck with an active booking.');
        }
        await this.prisma.truck.delete({ where: { id } });
        return { id };
    }
    async setAvailability(id, ownerId, status) {
        await this.findOwned(id, ownerId);
        if (status === client_1.TruckStatus.AVAILABLE) {
            const active = await this.hasActiveBooking(id);
            if (active) {
                throw new common_1.ForbiddenException('This truck has an active trip. It becomes available only after the importer confirms receipt, or after admin resolves a dispute.');
            }
        }
        return this.prisma.truck.update({
            where: { id },
            data: { status },
            include: TRUCK_INCLUDE,
        });
    }
};
exports.TrucksService = TrucksService;
exports.TrucksService = TrucksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TrucksService);
//# sourceMappingURL=trucks.service.js.map