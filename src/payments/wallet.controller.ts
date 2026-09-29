import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateDepositDto, CreateWithdrawalDto, WalletActor } from './wallet.dto';
import { PaymentsService } from './payments.service';

type AuthedRequest = { user: WalletActor };

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private payments: PaymentsService) {}

  @Get()
  getWallet(@Req() req: AuthedRequest) {
    return this.payments.getWallet(req.user.id);
  }

  @Get('admin/commission')
  getAdminCommission(@Req() req: AuthedRequest) {
    return this.payments.getAdminCommission(req.user);
  }

  @Get('banks')
  getBanks() {
    return this.payments.getRwandaBanks();
  }

  @Get('banks/:bankCode/branches')
  getBankBranches(@Param('bankCode') bankCode: string) {
    return this.payments.getRwandaBankBranches(bankCode);
  }

  @Post('deposits')
  createDeposit(
    @Req() req: AuthedRequest,
    @Body() dto: CreateDepositDto,
  ) {
    return this.payments.createDeposit(req.user.id, dto);
  }

  @Post('withdrawals')
  createWithdrawal(
    @Req() req: AuthedRequest,
    @Body() dto: CreateWithdrawalDto,
  ) {
    return this.payments.createWithdrawal(req.user.id, dto);
  }

  @Post('bookings/:id/pay')
  payBooking(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.payments.payBooking(req.user, id);
  }
}