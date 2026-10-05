import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsService } from './payments.service';
import { WalletController } from './wallet.controller';

@Module({
  imports: [PrismaModule],
  controllers: [WalletController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}