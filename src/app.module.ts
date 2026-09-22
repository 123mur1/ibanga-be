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

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    TrucksModule,
    UsersModule,
    DemoModule,
    BookingsModule,
    DisputesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
