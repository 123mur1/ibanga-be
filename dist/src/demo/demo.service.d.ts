import { PrismaService } from '../prisma/prisma.service';
export declare class DemoService {
    private prisma;
    constructor(prisma: PrismaService);
    reset(): Promise<{
        ok: boolean;
        users: number;
        trucks: number;
    }>;
}
