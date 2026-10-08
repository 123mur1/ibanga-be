import {
  Body,
  Delete,
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
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { UpdateTrackingLocationDto } from './dto/update-tracking-location.dto';

type AuthedRequest = { user: { id: string; role: UserRole } };

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateBookingDto) {
    return this.bookings.create(req.user, dto);
  }

  @Get()
  findAll(@Req() req: AuthedRequest) {
    return this.bookings.findAll(req.user);
  }

  @Get(':id')
  findOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.bookings.findOne(req.user, id);
  }

  @Get(':id/location')
  getTrackingLocation(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.bookings.getTrackingLocation(req.user, id);
  }

  @Patch(':id/location')
  updateTrackingLocation(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTrackingLocationDto,
  ) {
    return this.bookings.updateTrackingLocation(req.user, id, dto);
  }

  @Delete(':id/location')
  clearTrackingLocation(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.bookings.clearTrackingLocation(req.user, id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateBookingDto,
  ) {
    return this.bookings.update(req.user, id, dto);
  }
}
