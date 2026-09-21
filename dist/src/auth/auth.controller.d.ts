import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
export declare class AuthController {
    private auth;
    constructor(auth: AuthService);
    register(dto: RegisterDto): Promise<{
        token: string;
        user: {
            id: string;
            name: string;
            email: string;
            phone: string | null;
            role: import("@prisma/client").User["role"];
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
            role: import("@prisma/client").User["role"];
            location: string | null;
        };
    }>;
    me(req: {
        user: {
            id: string;
        };
    }): Promise<{
        email: string;
        name: string;
        phone: string | null;
        location: string | null;
        role: import("@prisma/client").$Enums.UserRole;
        id: string;
    }>;
}
