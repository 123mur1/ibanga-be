"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemoService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const prisma_service_1 = require("../prisma/prisma.service");
const DEMO_PASSWORD = 'demo1234';
const DEMO_USERS = [
    {
        name: 'Eric Ndayisaba',
        email: 'eric@ndayitrans.rw',
        phone: '+250 789 330 112',
        role: client_1.UserRole.TRUCK_OWNER,
        location: 'Kigali',
    },
    {
        name: 'Amina Hassan',
        email: 'amina@coastalhaul.ke',
        phone: '+254 722 556 018',
        role: client_1.UserRole.TRUCK_OWNER,
        location: 'Mombasa',
    },
    {
        name: 'Jeanine Uwase',
        email: 'jeanine@importco.rw',
        phone: '+250 788 441 220',
        role: client_1.UserRole.IMPORTER,
        location: 'Kigali',
    },
    {
        name: 'David Okello',
        email: 'david@okellocargo.ug',
        phone: '+256 772 118 904',
        role: client_1.UserRole.IMPORTER,
        location: 'Kampala',
    },
];
const DEMO_TRUCKS = [
    {
        ownerEmail: 'eric@ndayitrans.rw',
        plateNumber: 'RAD 452 C',
        truckType: 'Container',
        capacity: 28,
        currentLocation: 'Kigali',
        preferredRoute: 'Kigali — Mombasa',
        description: '40ft container truck, regularly runs the Northern Corridor. Good for general imported goods.',
        photos: [
            '/photos/ibanga-container-highway.png',
            '/photos/ibanga-container-yard.png',
        ],
        status: client_1.TruckStatus.UNAVAILABLE,
    },
    {
        ownerEmail: 'eric@ndayitrans.rw',
        plateNumber: 'RAD 118 B',
        truckType: 'Refrigerated',
        capacity: 18,
        currentLocation: 'Musanze',
        preferredRoute: 'Kigali — Kampala',
        description: 'Cold-chain truck for produce and pharmaceuticals. Temperature logs available on request.',
        photos: ['/photos/ibanga-reefer.png'],
        status: client_1.TruckStatus.UNAVAILABLE,
    },
    {
        ownerEmail: 'amina@coastalhaul.ke',
        plateNumber: 'KCD 903 A',
        truckType: 'Flatbed',
        capacity: 30,
        currentLocation: 'Mombasa',
        preferredRoute: 'Mombasa — Kigali',
        description: 'Flatbed with chains and tarpaulin. Ideal for machinery, steel, and oversized crates.',
        photos: ['/photos/ibanga-flatbed.png', '/photos/ibanga-container-yard.png'],
        status: client_1.TruckStatus.AVAILABLE,
    },
    {
        ownerEmail: 'amina@coastalhaul.ke',
        plateNumber: 'KCA 220 T',
        truckType: 'Tanker',
        capacity: 32,
        currentLocation: 'Nairobi',
        preferredRoute: 'Nairobi — Kigali',
        description: 'Fuel and liquid cargo tanker. Certified hoses and valves.',
        photos: ['/photos/ibanga-tanker.png'],
        status: client_1.TruckStatus.UNAVAILABLE,
    },
    {
        ownerEmail: 'eric@ndayitrans.rw',
        plateNumber: 'RAE 671 D',
        truckType: 'Box truck',
        capacity: 8,
        currentLocation: 'Kigali',
        preferredRoute: 'Kigali — Rusumo',
        description: 'Covered box truck for packaged goods and last-mile from the border.',
        photos: ['/photos/ibanga-box.png'],
        status: client_1.TruckStatus.UNAVAILABLE,
    },
    {
        ownerEmail: 'amina@coastalhaul.ke',
        plateNumber: 'KBB 441 M',
        truckType: 'Semi-trailer',
        capacity: 34,
        currentLocation: 'Dar es Salaam',
        preferredRoute: 'Dar es Salaam — Kigali',
        description: 'Long-haul semi for containerized imports from the port.',
        photos: ['/photos/ibanga-semi.png', '/photos/ibanga-container-highway.png'],
        status: client_1.TruckStatus.AVAILABLE,
    },
];
let DemoService = class DemoService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async reset() {
        const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
        await this.prisma.$transaction([
            this.prisma.dispute.deleteMany(),
            this.prisma.booking.deleteMany(),
            this.prisma.truck.deleteMany(),
            this.prisma.user.deleteMany({ where: { role: { not: client_1.UserRole.ADMIN } } }),
        ]);
        const createdUsers = await this.prisma.user.createManyAndReturn({
            data: DEMO_USERS.map((user) => ({
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                location: user.location,
                passwordHash,
            })),
        });
        const ownerIdByEmail = new Map(createdUsers
            .filter((user) => user.role === client_1.UserRole.TRUCK_OWNER)
            .map((owner) => [owner.email, owner.id]));
        const trucks = DEMO_TRUCKS.flatMap((truck) => {
            const ownerId = ownerIdByEmail.get(truck.ownerEmail);
            if (!ownerId)
                return [];
            return [
                {
                    ownerId,
                    plateNumber: truck.plateNumber,
                    truckType: truck.truckType,
                    capacity: truck.capacity,
                    currentLocation: truck.currentLocation,
                    preferredRoute: truck.preferredRoute,
                    description: truck.description,
                    photos: truck.photos,
                    status: truck.status,
                },
            ];
        });
        if (trucks.length > 0) {
            await this.prisma.truck.createManyAndReturn({ data: trucks });
        }
        const [users, truckCount] = await Promise.all([
            this.prisma.user.count(),
            this.prisma.truck.count(),
        ]);
        return { ok: true, users, trucks: truckCount };
    }
};
exports.DemoService = DemoService;
exports.DemoService = DemoService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DemoService);
//# sourceMappingURL=demo.service.js.map