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
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputesService } from './disputes.service';

type AuthedRequest = { user: { id: string; role: UserRole } };

@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private disputes: DisputesService) {}

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateDisputeDto) {
    return this.disputes.create(req.user, dto);
  }

  @Get()
  findAll(@Req() req: AuthedRequest) {
    return this.disputes.findAll(req.user);
  }

  @Patch(':id/resolve')
  resolve(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputes.resolve(req.user, id, dto.resolutionNotes);
  }
}
