import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OperationsService, type OperationsActor } from './operations.service';
import { CancelCargoRequestDto } from './dto/cancel-cargo-request.dto';
import { CreateDriverDto } from './dto/create-driver.dto';
import { SaveOperationsRecordDto } from './dto/save-operations-record.dto';

type AuthedRequest = { user: OperationsActor };

function parsePositiveInteger(value: string | undefined, name: string) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`${name} must be a positive integer.`);
  }
  return parsed;
}

@Controller('operations')
@UseGuards(JwtAuthGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('cargo-requests/:id/quotations')
  listQuotationsForRequest(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.operations.listQuotationsForRequest(id, req.user);
  }

  @Post('cargo-requests/:id/publish')
  publishCargoDraft(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.operations.publishCargoDraft(id, req.user);
  }

  @Post('cargo-requests/:id/cancel')
  cancelCargoRequest(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
    @Body() dto: CancelCargoRequestDto,
  ) {
    return this.operations.cancelCargoRequest(id, req.user, dto.reason);
  }

  @Post('drivers')
  createDriver(@Req() req: AuthedRequest, @Body() dto: CreateDriverDto) {
    return this.operations.createDriver(req.user, dto);
  }

  @Post('quotations/:id/withdraw')
  withdrawQuotation(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.operations.withdrawQuotation(id, req.user);
  }

  @Post('quotations/:id/accept')
  acceptQuotation(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.operations.acceptQuotation(id, req.user);
  }

  /** Several domains in one response: `?domains=a,b`, or every readable domain. */
  @Get('snapshot')
  snapshot(@Req() req: AuthedRequest, @Query('domains') domains?: string) {
    return this.operations.snapshot(
      req.user,
      domains
        ?.split(',')
        .map((domain) => domain.trim())
        .filter(Boolean),
    );
  }

  @Get(':domain')
  list(
    @Param('domain') domain: string,
    @Req() req: AuthedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.operations.list(domain, req.user, {
      page: parsePositiveInteger(page, 'page'),
      pageSize: parsePositiveInteger(pageSize, 'pageSize'),
      search,
    });
  }

  @Get(':domain/:id')
  get(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.operations.get(domain, id, req.user);
  }

  @Post(':domain')
  create(
    @Param('domain') domain: string,
    @Req() req: AuthedRequest,
    @Body() dto: SaveOperationsRecordDto,
  ) {
    return this.operations.create(domain, req.user, dto);
  }

  @Patch(':domain/:id')
  update(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
    @Body() dto: SaveOperationsRecordDto,
  ) {
    return this.operations.update(domain, id, req.user, dto);
  }

  @Delete(':domain/:id')
  remove(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.operations.remove(domain, id, req.user);
  }
}
