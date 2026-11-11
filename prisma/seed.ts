/**
 * Seeds one truck owner and their fleet for the per-kilometre marketplace.
 *
 *   SEED_OWNER_EMAIL=...  SEED_OWNER_PASSWORD=...  npm run prisma:seed
 *
 * Safe to run more than once: the owner is matched by email and each vehicle by plate number,
 * and both are updated in place. Nothing else in the database is changed or deleted. Each vehicle
 * gets approved registration, inspection and insurance documents, so it is verified and appears
 * in the marketplace straight away.
 */
import { PrismaClient, TruckStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const OWNER = {
  email: (process.env.SEED_OWNER_EMAIL ?? 'fleet@ibanga.rw')
    .trim()
    .toLowerCase(),
  name: 'Eric Ndayisaba',
  company: 'Ndayisaba Transport Ltd',
  phone: '+250 788 410 220',
  location: 'Kigali',
};

type SeedTruck = {
  plateNumber: string;
  category: string;
  truckType: string;
  capacity: number;
  pricePerKmRwf: number;
  currentLocation: string;
  destinations: string[];
  acceptedCargo: string[];
  description: string;
  photo: string;
};

/** Photos are served by the frontend from public/photos. */
const PHOTO = {
  containerHighway: '/photos/ibanga-container-highway.png',
  containerYard: '/photos/ibanga-container-yard.png',
  reefer: '/photos/ibanga-reefer.png',
  flatbed: '/photos/ibanga-flatbed.png',
  box: '/photos/ibanga-box.png',
  semi: '/photos/ibanga-semi.png',
  tanker: '/photos/ibanga-tanker.png',
};

const TRUCKS: SeedTruck[] = [
  {
    plateNumber: 'RAH 201A',
    category: 'Heavy truck',
    truckType: 'Container',
    capacity: 24,
    pricePerKmRwf: 1800,
    currentLocation: 'Kigali',
    destinations: ['Mombasa', 'Dar es Salaam', 'Kampala', 'Nairobi'],
    acceptedCargo: [
      'General goods',
      'Electronics',
      'Textiles and clothing',
      'Household goods',
      'Coffee',
      'Tea',
    ],
    description:
      '40 ft container carrier on the northern and central corridors, with an experienced regional driver.',
    photo: PHOTO.containerHighway,
  },
  {
    plateNumber: 'RAH 202B',
    category: 'Medium truck',
    truckType: 'Refrigerated',
    capacity: 12,
    pricePerKmRwf: 1500,
    currentLocation: 'Musanze',
    destinations: ['Kigali', 'Kampala', 'Goma', 'Gisenyi'],
    acceptedCargo: [
      'Fresh produce',
      'Food and grains',
      'Beverages',
      'Medical supplies',
    ],
    description:
      'Temperature-controlled reefer (2–8 °C or frozen), ideal for fresh produce and medicines.',
    photo: PHOTO.reefer,
  },
  {
    plateNumber: 'RAH 203C',
    category: 'Heavy truck',
    truckType: 'Flatbed',
    capacity: 30,
    pricePerKmRwf: 2150,
    currentLocation: 'Mombasa',
    destinations: ['Kigali', 'Kampala', 'Nairobi', 'Isaka'],
    acceptedCargo: [
      'Building materials',
      'Steel and metal',
      'Machinery and equipment',
      'Vehicles and spare parts',
    ],
    description:
      'Heavy-duty flatbed for machinery, steel and oversized freight, with straps and corner protectors.',
    photo: PHOTO.flatbed,
  },
  {
    plateNumber: 'RAH 204D',
    category: 'Light truck',
    truckType: 'Box truck',
    capacity: 7,
    pricePerKmRwf: 950,
    currentLocation: 'Kigali',
    destinations: ['Huye', 'Musanze', 'Rwamagana', 'Muhanga', 'Nyagatare'],
    acceptedCargo: [
      'General goods',
      'Furniture',
      'Household goods',
      'Electronics',
      'Beverages',
    ],
    description:
      'Lockable box truck for packaged goods, retail stock and house moves within Rwanda.',
    photo: PHOTO.box,
  },
  {
    plateNumber: 'RAH 205E',
    category: 'Trailer and articulated',
    truckType: 'Semi-trailer',
    capacity: 34,
    pricePerKmRwf: 2400,
    currentLocation: 'Dar es Salaam',
    destinations: ['Kigali', 'Rusumo', 'Isaka', 'Bujumbura'],
    acceptedCargo: [
      'Building materials',
      'Cement',
      'Food and grains',
      'General goods',
    ],
    description:
      'Articulated semi-trailer for bulk and palletised loads on the central corridor.',
    photo: PHOTO.semi,
  },
  {
    plateNumber: 'RAH 206F',
    category: 'Heavy truck',
    truckType: 'Tanker',
    capacity: 28,
    pricePerKmRwf: 2000,
    currentLocation: 'Kigali',
    destinations: ['Mombasa', 'Dar es Salaam', 'Kampala', 'Goma'],
    acceptedCargo: ['Fuel and oil', 'Chemicals'],
    description:
      'Certified 28,000-litre tanker for fuel and chemicals, maintained to regional standards.',
    photo: PHOTO.tanker,
  },
  {
    plateNumber: 'RAH 207G',
    category: 'Medium truck',
    truckType: 'Tipper',
    capacity: 15,
    pricePerKmRwf: 1300,
    currentLocation: 'Kigali',
    destinations: ['Musanze', 'Huye', 'Muhanga', 'Rwamagana'],
    acceptedCargo: ['Building materials', 'Cement'],
    description:
      'Tipper for sand, gravel and construction materials on building sites across Rwanda.',
    photo: PHOTO.containerYard,
  },
  {
    plateNumber: 'RAH 208H',
    category: 'Trailer and articulated',
    truckType: 'Lowbed',
    capacity: 40,
    pricePerKmRwf: 2800,
    currentLocation: 'Kigali',
    destinations: ['Mombasa', 'Dar es Salaam', 'Kampala'],
    acceptedCargo: [
      'Machinery and equipment',
      'Vehicles and spare parts',
      'Steel and metal',
    ],
    description:
      'Lowbed trailer for excavators, tractors and other heavy or tall equipment.',
    photo: PHOTO.flatbed,
  },
  {
    plateNumber: 'RAH 209J',
    category: 'Pickup and van',
    truckType: 'Box truck',
    capacity: 2.5,
    pricePerKmRwf: 600,
    currentLocation: 'Kigali',
    destinations: ['Huye', 'Musanze', 'Gisenyi', 'Rwamagana', 'Nyagatare'],
    acceptedCargo: [
      'General goods',
      'Medical supplies',
      'Electronics',
      'Household goods',
    ],
    description:
      'Small covered van for quick deliveries of parcels, medical supplies and electronics.',
    photo: PHOTO.box,
  },
  {
    plateNumber: 'RAH 210K',
    category: 'Heavy truck',
    truckType: 'Container',
    capacity: 26,
    pricePerKmRwf: 1900,
    currentLocation: 'Nairobi',
    destinations: ['Kigali', 'Kampala', 'Mombasa'],
    acceptedCargo: [
      'General goods',
      'Electronics',
      'Textiles and clothing',
      'Furniture',
    ],
    description:
      'Container truck based in Nairobi for imports cleared at Mombasa and inland depots.',
    photo: PHOTO.containerYard,
  },
  {
    plateNumber: 'RAH 211L',
    category: 'Heavy truck',
    truckType: 'Refrigerated',
    capacity: 20,
    pricePerKmRwf: 1750,
    currentLocation: 'Kampala',
    destinations: ['Kigali', 'Nairobi', 'Mombasa', 'Goma'],
    acceptedCargo: [
      'Fresh produce',
      'Beverages',
      'Food and grains',
      'Medical supplies',
    ],
    description:
      'Large reefer for cross-border cold-chain loads between Uganda, Kenya and Rwanda.',
    photo: PHOTO.reefer,
  },
  {
    plateNumber: 'RAH 212M',
    category: 'Heavy truck',
    truckType: 'Semi-trailer',
    capacity: 22,
    pricePerKmRwf: 1600,
    currentLocation: 'Rusizi',
    destinations: ['Kigali', 'Bujumbura', 'Goma', 'Huye'],
    acceptedCargo: ['Food and grains', 'General goods', 'Cement', 'Coffee'],
    description:
      'Semi-trailer serving the western border towns, Bujumbura and Goma.',
    photo: PHOTO.semi,
  },
];

const REQUIRED_DOCUMENTS = [
  { type: 'VEHICLE_REGISTRATION', title: 'Vehicle registration' },
  { type: 'VEHICLE_INSPECTION', title: 'Technical inspection certificate' },
  { type: 'INSURANCE_POLICY', title: 'Insurance policy' },
] as const;

async function seedOwner() {
  const providedPassword = process.env.SEED_OWNER_PASSWORD?.trim();
  const password = providedPassword || randomBytes(9).toString('base64url');
  const existing = await prisma.user.findUnique({
    where: { email: OWNER.email },
  });
  if (existing && existing.role !== UserRole.TRUCK_OWNER) {
    throw new Error(
      `${OWNER.email} already belongs to a ${existing.role} account. Set SEED_OWNER_EMAIL to another address.`,
    );
  }
  // An existing owner keeps their password unless a new one is given.
  const passwordHash =
    !existing || providedPassword ? await bcrypt.hash(password, 10) : undefined;
  const owner = await prisma.user.upsert({
    where: { email: OWNER.email },
    create: {
      ...OWNER,
      role: UserRole.TRUCK_OWNER,
      passwordHash: passwordHash!,
    },
    update: {
      name: OWNER.name,
      company: OWNER.company,
      phone: OWNER.phone,
      location: OWNER.location,
      active: true,
      ...(passwordHash ? { passwordHash } : {}),
    },
  });
  await prisma.wallet.upsert({
    where: { userId: owner.id },
    create: { userId: owner.id },
    update: {},
  });
  return { owner, password: passwordHash ? password : null };
}

async function seedTruck(ownerId: string, truck: SeedTruck) {
  const existing = await prisma.truck.findUnique({
    where: { plateNumber: truck.plateNumber },
  });
  if (existing && existing.ownerId !== ownerId) {
    throw new Error(
      `Plate ${truck.plateNumber} already belongs to another owner; it was left unchanged.`,
    );
  }
  const data = {
    category: truck.category,
    truckType: truck.truckType,
    capacity: truck.capacity,
    pricePerKmRwf: truck.pricePerKmRwf,
    priceRwf: null,
    currentLocation: truck.currentLocation,
    destinations: truck.destinations,
    acceptedCargo: truck.acceptedCargo,
    preferredRoute:
      `${truck.currentLocation} — ${truck.destinations.join(', ')}`.slice(
        0,
        120,
      ),
    description: truck.description,
    photos: [truck.photo],
    status: TruckStatus.AVAILABLE,
  };
  const saved = await prisma.truck.upsert({
    where: { plateNumber: truck.plateNumber },
    create: { ...data, plateNumber: truck.plateNumber, ownerId },
    update: data,
  });

  const now = new Date();
  const issued = new Date(now.getTime() - 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const expires = new Date(now.getTime() + 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const document of REQUIRED_DOCUMENTS) {
    const id = `seed-${saved.id}-${document.type.toLowerCase()}`;
    const record = {
      id,
      ref: `DOC-${truck.plateNumber.replace(/\s+/g, '')}-${document.type.slice(0, 4)}`,
      type: document.type,
      subjectKind: 'TRUCK',
      subjectId: saved.id,
      ownerId,
      title: `${document.title} · ${truck.plateNumber}`,
      fileName: `${truck.plateNumber.replace(/\s+/g, '-')}-${document.type.toLowerCase()}.pdf`,
      fileUrl: '',
      hasFile: false,
      mimeType: 'application/pdf',
      issueDate: issued,
      expiryDate: expires,
      status: 'APPROVED',
      submittedAt: now.toISOString(),
      reviewedAt: now.toISOString(),
      version: 1,
    };
    await prisma.operationsRecord.upsert({
      where: { domain_recordId: { domain: 'documents', recordId: id } },
      create: {
        domain: 'documents',
        recordId: id,
        ownerId,
        status: 'APPROVED',
        searchText: `${record.ref} ${record.title}`,
        data: record,
      },
      update: { status: 'APPROVED', data: record },
    });
  }
  return saved;
}

async function main() {
  const { owner, password } = await seedOwner();
  for (const truck of TRUCKS) {
    const saved = await seedTruck(owner.id, truck);
    console.log(
      `  ${saved.plateNumber}  ${truck.category}, ${truck.truckType}, RWF ${truck.pricePerKmRwf}/km, in ${truck.currentLocation}`,
    );
  }
  console.log(
    `\nSeeded ${TRUCKS.length} verified vehicles for ${owner.name} <${owner.email}>.`,
  );
  if (password) {
    console.log(`Owner password: ${password}`);
    console.log('Save it now: it is not stored anywhere in plain text.');
  } else {
    console.log(
      'The owner already existed, so their password was not changed (set SEED_OWNER_PASSWORD to reset it).',
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
