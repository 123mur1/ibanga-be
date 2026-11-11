import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateGuestReviewDto, CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

type AuthedRequest = { user: { id: string; role: UserRole } };

/** Guest reviews allowed per address per hour, to slow down spam. */
const GUEST_LIMIT = 5;
const GUEST_WINDOW_MS = 60 * 60 * 1000;
const guestPosts = new Map<string, number[]>();

function assertGuestAllowed(address: string) {
  const now = Date.now();
  const recent = (guestPosts.get(address) ?? []).filter(
    (time) => now - time < GUEST_WINDOW_MS,
  );
  if (recent.length >= GUEST_LIMIT) {
    throw new HttpException(
      'Too many reviews from this connection. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  guestPosts.set(address, [...recent, now]);
}

@Controller()
export class ReviewsController {
  constructor(private reviews: ReviewsService) {}

  /** Public, so the marketplace shows ratings to visitors too. */
  @Get('reviews')
  findAll(@Query('truckId') truckId?: string) {
    return this.reviews.findAll(truckId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('trucks/:id/reviews')
  create(
    @Req() req: AuthedRequest,
    @Param('id') truckId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(req.user, truckId, dto);
  }

  /** Public: visitors can review without an account. */
  @Post('trucks/:id/reviews/guest')
  createGuest(
    @Req() req: { ip?: string },
    @Param('id') truckId: string,
    @Body() dto: CreateGuestReviewDto,
  ) {
    assertGuestAllowed(req.ip ?? 'unknown');
    return this.reviews.createGuest(truckId, dto);
  }
}
