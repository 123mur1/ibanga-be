import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UserPhotosController } from './user-photos.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController, UserPhotosController],
  providers: [UsersService],
})
export class UsersModule {}
