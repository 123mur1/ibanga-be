import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UserSessionCache } from './user-session-cache';

@Global()
@Module({
  providers: [PrismaService, UserSessionCache],
  exports: [PrismaService, UserSessionCache],
})
export class PrismaModule {}
