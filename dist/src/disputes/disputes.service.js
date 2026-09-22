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
exports.DisputesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const INCLUDE = {
    booking: { include: { truck: true } },
};
let DisputesService = class DisputesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(actor, dto) {
        if (actor.role !== client_1.UserRole.IMPORTER) {
            throw new common_1.ForbiddenException('Only importers can report a booking problem.');
        }
        const booking = await this.prisma.booking.findUnique({
            where: { id: dto.bookingId },
        });
        if (!booking)
            throw new common_1.NotFoundException('Booking not found.');
        if (booking.importerId !== actor.id)
            throw new common_1.ForbiddenException('You cannot report a problem on this booking.');
        if (booking.status !== client_1.BookingStatus.DELIVERED) {
            throw new common_1.BadRequestException('A problem can be reported after the truck marks delivery.');
        }
        const dispute = await this.prisma.dispute.create({
            data: {
                bookingId: booking.id,
                raisedBy: actor.id,
                reason: dto.reason.trim(),
            },
            include: INCLUDE,
        });
        await this.prisma.booking.update({
            where: { id: booking.id },
            data: { status: client_1.BookingStatus.DISPUTED },
        });
        return dispute;
    }
    findAll(actor) {
        const where = actor.role === client_1.UserRole.ADMIN
            ? {}
            : {
                OR: [
                    { raisedBy: actor.id },
                    { booking: { truck: { ownerId: actor.id } } },
                ],
            };
        return this.prisma.dispute.findMany({
            where,
            include: INCLUDE,
            orderBy: { createdAt: 'desc' },
        });
    }
    async resolve(actor, id, resolutionNotes) {
        if (actor.role !== client_1.UserRole.ADMIN)
            throw new common_1.ForbiddenException('Only admins can resolve disputes.');
        const dispute = await this.prisma.dispute.findUnique({
            where: { id },
            include: INCLUDE,
        });
        if (!dispute)
            throw new common_1.NotFoundException('Dispute not found.');
        if (dispute.status === client_1.DisputeStatus.RESOLVED)
            throw new common_1.BadRequestException('This dispute is already resolved.');
        await this.prisma.booking.update({
            where: { id: dispute.bookingId },
            data: { status: client_1.BookingStatus.COMPLETED },
        });
        await this.prisma.truck.update({
            where: { id: dispute.booking.truckId },
            data: { status: client_1.TruckStatus.AVAILABLE },
        });
        return this.prisma.dispute.update({
            where: { id },
            data: {
                status: client_1.DisputeStatus.RESOLVED,
                resolutionNotes: resolutionNotes.trim(),
                resolvedAt: new Date(),
            },
            include: INCLUDE,
        });
    }
};
exports.DisputesService = DisputesService;
exports.DisputesService = DisputesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DisputesService);
//# sourceMappingURL=disputes.service.js.map