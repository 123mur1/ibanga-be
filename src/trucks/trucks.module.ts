import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TrucksController } from './trucks.controller';
import { TrucksService } from './trucks.service';

@Module({
  imports: [PrismaModule],
  controllers: [TrucksController],
  providers: [TrucksService],
})
export class TrucksModule {}
