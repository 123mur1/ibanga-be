import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
export declare class AuthService {
    private prisma;
    private jwt;
    constructor(prisma: PrismaService, jwt: JwtService);
    register(dto: RegisterDto): Promise<{
        token: string;
        user: {
            id: string;
            name: string;
            email: string;
            phone: string | null;
            role: User["role"];
            location: string | null;
        };
    }>;
    login(dto: LoginDto): Promise<{
        token: string;
        user: {
            id: string;
            name: string;
            email: string;
            phone: string | null;
            role: User["role"];
            location: string | null;
        };
    }>;
    me(userId: string): Promise<{
        email: string;
        name: string;
        phone: string | null;
        location: string | null;
        role: import("@prisma/client").$Enums.UserRole;
        id: string;
    }>;
    private withToken;
}
