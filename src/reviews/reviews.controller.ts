import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

type AuthedRequest = { user: { id: string; role: UserRole } };

@Controller()
export class ReviewsController {
  constructor(private reviews: ReviewsService) {}

  /** Public, so the marketplace shows ratings to visitors too. */
  @Get('reviews')
  findAll(@Query('truckId') truckId?: string) {
    return this.reviews.findAll(truckId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.IMPORTER)
  @Post('trucks/:id/reviews')
  create(
    @Req() req: AuthedRequest,
    @Param('id') truckId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(req.user, truckId, dto);
  }
}
