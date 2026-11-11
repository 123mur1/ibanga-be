import {
  Body,
  Delete,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PayBookingDto } from '../payments/wallet.dto';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingsService } from './bookings.service';
import { TripUpdatesService } from './trip-updates.service';
import { UploadBookingDocumentDto } from './dto/upload-booking-document.dto';
import { DelayDecisionDto, TripUpdateDto } from './dto/trip-update.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { SettleDisputeDto } from './dto/settle-dispute.dto';
import { UpdateTrackingLocationDto } from './dto/update-tracking-location.dto';

type AuthedRequest = { user: { id: string; role: UserRole } };

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(
    private bookings: BookingsService,
    private documents: BookingDocumentsService,
    private tripUpdates: TripUpdatesService,
  ) {}

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

  /** The importer confirms the cargo arrived and pays the remaining 50% in one step. */
  @Post(':id/confirm-receipt')
  confirmReceipt(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: PayBookingDto,
  ) {
    return this.bookings.confirmReceipt(req.user, id, dto);
  }

  @Get(':id/documents')
  listDocuments(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.documents.list(req.user, id);
  }

  @Post(':id/documents')
  uploadDocument(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UploadBookingDocumentDto,
  ) {
    return this.documents.upload(req.user, id, dto);
  }

  @Get(':id/documents/:documentId/file')
  async documentFile(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const file = await this.documents.file(req.user, id, documentId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.name.replace(/[^\w.\- ]+/g, '_')}"`,
    );
    res.send(file.body);
  }

  @Delete(':id/documents/:documentId')
  removeDocument(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documents.remove(req.user, id, documentId);
  }

  /** A message from the driver or owner to everyone on the trip, optionally with a delay. */
  @Post(':id/trip-updates')
  sendTripUpdate(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: TripUpdateDto,
  ) {
    return this.tripUpdates.send(req.user, id, dto);
  }

  /** An importer whose booking a delay overlaps: shift the dates or cancel with a full refund. */
  @Post(':id/delay-impacts/:impactId')
  decideDelay(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('impactId') impactId: string,
    @Body() dto: DelayDecisionDto,
  ) {
    return this.tripUpdates.decide(req.user, id, impactId, dto);
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

  /** Administrator decision on a disputed booking: refund the importer, pay the owner, or split. */
  @Post(':id/settle-dispute')
  settleDispute(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: SettleDisputeDto,
  ) {
    return this.bookings.settleDispute(req.user, id, dto);
  }

  /** Administrator: complete an approved cancellation (refund and fee per the policy). */
  @Post(':id/complete-cancellation')
  completeCancellation(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.bookings.completeCancellation(req.user, id);
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
