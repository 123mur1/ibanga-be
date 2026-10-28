import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { TrucksModule } from '../trucks/trucks.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [PrismaModule, PaymentsModule, TrucksModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
