import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WalletController } from './wallet.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController, WalletController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}