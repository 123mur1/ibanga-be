import {
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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateTruckDto } from './dto/create-truck.dto';
import { QueryTrucksDto } from './dto/query-trucks.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateTruckDto } from './dto/update-truck.dto';
import { TrucksService } from './trucks.service';

type AuthedRequest = { user: { id: string; role: UserRole } };
type MaybeAuthedRequest = { user?: { id: string; role: UserRole } };

@Controller('trucks')
export class TrucksController {
  constructor(private trucks: TrucksService) {}

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
