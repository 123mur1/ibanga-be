import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TrucksController } from './trucks.controller';
import { TrucksService } from './trucks.service';
import { TruckPhotos } from './truck-photos';

@Module({
  imports: [PrismaModule],
  controllers: [TrucksController],
  providers: [TrucksService, TruckPhotos],
  exports: [TruckPhotos],
})
export class TrucksModule {}
