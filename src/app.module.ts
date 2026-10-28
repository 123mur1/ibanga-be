import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { TrucksModule } from './trucks/trucks.module';
import { UsersModule } from './users/users.module';
import { DemoModule } from './demo/demo.module';
import { BookingsModule } from './bookings/bookings.module';
import { DisputesModule } from './disputes/disputes.module';
import { PaymentsModule } from './payments/payments.module';
import { OperationsModule } from './operations/operations.module';
import { ReviewsModule } from './reviews/reviews.module';
import { RefundsModule } from './refunds/refunds.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    TrucksModule,
    UsersModule,
    DemoModule,
    BookingsModule,
    DisputesModule,
    PaymentsModule,
    OperationsModule,
    ReviewsModule,
    RefundsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
