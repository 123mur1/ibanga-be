import { Injectable } from '@nestjs/common';
import { Prisma, TruckStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const DEMO_PASSWORD = 'demo1234';

const DEMO_USERS = [
  {
    name: 'Eric Ndayisaba',
    email: 'eric@ndayitrans.rw',
    phone: '+250 789 330 112',
    role: UserRole.TRUCK_OWNER,
    location: 'Kigali',
  },
  {
    name: 'Amina Hassan',
    email: 'amina@coastalhaul.ke',
    phone: '+254 722 556 018',
    role: UserRole.TRUCK_OWNER,
    location: 'Mombasa',
  },
  {
    name: 'Jeanine Uwase',
    email: 'jeanine@importco.rw',
    phone: '+250 788 441 220',
    role: UserRole.IMPORTER,
    location: 'Kigali',
  },
  {
    name: 'David Okello',
    email: 'david@okellocargo.ug',
    phone: '+256 772 118 904',
    role: UserRole.IMPORTER,
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
    description:
      '40ft container truck, regularly runs the Northern Corridor. Good for general imported goods.',
    photos: [
      '/photos/ibanga-container-highway.png',
      '/photos/ibanga-container-yard.png',
    ],
    status: TruckStatus.UNAVAILABLE,
  },
  {
    ownerEmail: 'eric@ndayitrans.rw',
    plateNumber: 'RAD 118 B',
    truckType: 'Refrigerated',
    capacity: 18,
    currentLocation: 'Musanze',
    preferredRoute: 'Kigali — Kampala',
    description:
      'Cold-chain truck for produce and pharmaceuticals. Temperature logs available on request.',
    photos: ['/photos/ibanga-reefer.png'],
    status: TruckStatus.UNAVAILABLE,
  },
  {
    ownerEmail: 'amina@coastalhaul.ke',
    plateNumber: 'KCD 903 A',
    truckType: 'Flatbed',
    capacity: 30,
    currentLocation: 'Mombasa',
    preferredRoute: 'Mombasa — Kigali',
    description:
      'Flatbed with chains and tarpaulin. Ideal for machinery, steel, and oversized crates.',
    photos: ['/photos/ibanga-flatbed.png', '/photos/ibanga-container-yard.png'],
    status: TruckStatus.AVAILABLE,
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
    status: TruckStatus.UNAVAILABLE,
  },
  {
    ownerEmail: 'eric@ndayitrans.rw',
    plateNumber: 'RAE 671 D',
    truckType: 'Box truck',
    capacity: 8,
    currentLocation: 'Kigali',
    preferredRoute: 'Kigali — Rusumo',
    description:
      'Covered box truck for packaged goods and last-mile from the border.',
    photos: ['/photos/ibanga-box.png'],
    status: TruckStatus.UNAVAILABLE,
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
    status: TruckStatus.AVAILABLE,
  },
];

@Injectable()
export class DemoService {
  constructor(private prisma: PrismaService) {}

  async reset() {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    await this.prisma.$transaction([
      this.prisma.dispute.deleteMany(),
      this.prisma.booking.deleteMany(),
      this.prisma.truck.deleteMany(),
      this.prisma.user.deleteMany({ where: { role: { not: UserRole.ADMIN } } }),
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

    const ownerIdByEmail = new Map(
      createdUsers
        .filter((user) => user.role === UserRole.TRUCK_OWNER)
        .map((owner) => [owner.email, owner.id]),
    );

    const trucks: Prisma.TruckCreateManyInput[] = DEMO_TRUCKS.flatMap(
      (truck) => {
        const ownerId = ownerIdByEmail.get(truck.ownerEmail);
        if (!ownerId) return [];
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
      },
    );

    if (trucks.length > 0) {
      await this.prisma.truck.createManyAndReturn({ data: trucks });
    }

    const [users, truckCount] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.truck.count(),
    ]);
    return { ok: true, users, trucks: truckCount };
  }
}
