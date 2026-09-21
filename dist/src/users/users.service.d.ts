import { PrismaService } from '../prisma/prisma.service';
export declare class UsersService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(): import("@prisma/client").Prisma.PrismaPromise<{
        email: string;
        name: string;
        phone: string | null;
        location: string | null;
        role: import("@prisma/client").$Enums.UserRole;
        id: string;
        createdAt: Date;
    }[]>;
    remove(userId: string, requestingAdminId: string): Promise<{
        id: string;
    }>;
}
