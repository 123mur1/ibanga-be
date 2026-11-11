import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { TrucksModule } from '../trucks/trucks.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingDocumentsService } from './booking-documents.service';
import { TripUpdatesService } from './trip-updates.service';

@Module({
  imports: [PrismaModule, PaymentsModule, TrucksModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingDocumentsService, TripUpdatesService],
  exports: [BookingsService],
})
export class BookingsModule {}
