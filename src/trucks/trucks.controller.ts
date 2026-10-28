import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateTruckDto } from './dto/create-truck.dto';
import { QueryTrucksDto } from './dto/query-trucks.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateTruckDto } from './dto/update-truck.dto';
import type { Response } from 'express';
import { sendImage } from '../common/data-url';
import { TrucksService } from './trucks.service';
import { TruckPhotos } from './truck-photos';

type AuthedRequest = { user: { id: string; role: UserRole } };
type MaybeAuthedRequest = { user?: { id: string; role: UserRole } };

@Controller('trucks')
export class TrucksController {
  constructor(
    private trucks: TrucksService,
    private photos: TruckPhotos,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRUCK_OWNER)
  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateTruckDto) {
    return this.trucks.create(req.user.id, dto);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(@Req() req: MaybeAuthedRequest, @Query() query: QueryTrucksDto) {
    return this.trucks.findAll(req.user?.id, req.user?.role, query);
  }

  /** One truck photo as an image. The `v` query (last update time) makes the URL cacheable. */
  @Get(':id/photos/:index')
  async photo(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Query('v') version: string | undefined,
    @Res() res: Response,
  ) {
    sendImage(res, await this.photos.photo(id, index, version ?? ''), version);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.trucks.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRUCK_OWNER)
  @Patch(':id')
  update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTruckDto,
  ) {
    return this.trucks.update(id, req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRUCK_OWNER)
  @Delete(':id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.trucks.remove(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRUCK_OWNER)
  @Patch(':id/availability')
  setAvailability(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.trucks.setAvailability(id, req.user.id, dto.status);
  }
}
