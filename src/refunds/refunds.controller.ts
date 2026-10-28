import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateRefundDto,
  DecideRefundDto,
  RespondRefundDto,
} from './dto/refund.dto';
import { RefundsService } from './refunds.service';

type AuthedRequest = { user: { id: string; role: UserRole } };

@Controller('refunds')
@UseGuards(JwtAuthGuard)
export class RefundsController {
  constructor(private refunds: RefundsService) {}

  /** Admins see every request, importers their own, truck owners those on their bookings. */
  @Get()
  findAll(@Req() req: AuthedRequest) {
    return this.refunds.findAll(req.user);
  }

  /** Importer asks for money back on a booking that went wrong. */
  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateRefundDto) {
    return this.refunds.create(req.user, dto);
  }

  /** Truck owner gives their side. */
  @Patch(':id/respond')
  respond(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: RespondRefundDto,
  ) {
    return this.refunds.respond(req.user, id, dto);
  }

  /** Administrator approves (refunding from escrow) or rejects. */
  @Patch(':id')
  decide(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: DecideRefundDto,
  ) {
    return this.refunds.decide(req.user, id, dto);
  }
}
