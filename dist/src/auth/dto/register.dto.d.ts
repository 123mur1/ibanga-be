import { UserRole } from '@prisma/client';
export declare class RegisterDto {
    name: string;
    email: string;
    password: string;
    phone?: string;
    location?: string;
    role: UserRole;
}
