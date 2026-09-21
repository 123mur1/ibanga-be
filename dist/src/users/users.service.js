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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const userSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    role: true,
    location: true,
    createdAt: true,
};
let UsersService = class UsersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    findAll() {
        return this.prisma.user.findMany({
            select: userSelect,
            orderBy: { createdAt: 'desc' },
        });
    }
    async remove(userId, requestingAdminId) {
        if (userId === requestingAdminId) {
            throw new common_1.BadRequestException('You cannot delete your own account.');
        }
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
        });
        if (!user)
            throw new common_1.NotFoundException('User not found.');
        if (user.role === client_1.UserRole.ADMIN) {
            throw new common_1.BadRequestException('Admin accounts cannot be deleted.');
        }
        const [bookingCount, disputeCount] = await Promise.all([
            this.prisma.booking.count({
                where: {
                    OR: [{ importerId: userId }, { truck: { ownerId: userId } }],
                },
            }),
            this.prisma.dispute.count({ where: { raisedBy: userId } }),
        ]);
        if (bookingCount > 0 || disputeCount > 0) {
            throw new common_1.ConflictException('This user has booking or dispute history and cannot be deleted. Suspend the account instead.');
        }
        await this.prisma.user.delete({ where: { id: userId } });
        return { id: userId };
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
//# sourceMappingURL=users.service.js.map