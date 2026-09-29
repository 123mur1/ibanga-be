import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post('webhooks/flutterwave')
  @HttpCode(200)
  handleFlutterwaveWebhook(
    @Headers('verif-hash') signature: string | undefined,
    @Req() req: Request,
  ) {
    return this.payments.handleFlutterwaveWebhook(signature, req.body);
  }
}