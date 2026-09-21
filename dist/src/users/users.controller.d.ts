import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
type AuthedRequest = {
    user: {
        id: string;
        role: UserRole;
    };
};
export declare class UsersController {
    private users;
    constructor(users: UsersService);
    findAll(): import("@prisma/client").Prisma.PrismaPromise<{
        email: string;
        name: string;
        phone: string | null;
        location: string | null;
        role: import("@prisma/client").$Enums.UserRole;
        id: string;
        createdAt: Date;
    }[]>;
    remove(req: AuthedRequest, id: string): Promise<{
        id: string;
    }>;
}
export {};
