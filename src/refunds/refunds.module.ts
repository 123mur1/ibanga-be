import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [PrismaModule, BookingsModule],
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
