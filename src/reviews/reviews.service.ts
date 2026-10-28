import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

type Actor = { id: string; role: UserRole };

type StoredReview = {
  id: string;
  truckId: string;
  authorId: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
};

/** Bookings that count as having shipped with the truck. */
const REVIEWABLE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.DELIVERED,
  BookingStatus.COMPLETED,
];

/**
 * Importer reviews of trucks. They are stored as operations records (domain "reviews"), so no
 * database migration is needed; the generic operations API cannot write them, only this service.
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public reviews, newest first, optionally for one truck. */
  async findAll(truckId?: string) {
    const records = await this.prisma.operationsRecord.findMany({
      where: { domain: 'reviews', ...(truckId ? { truckId } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    });
    const reviews = records.map(
      (record) => record.data as unknown as StoredReview,
    );
    return this.withAuthorPhotos(reviews);
  }

  /**
   * An importer reviews a truck that has delivered their cargo. One review per importer and
   * truck: the record id combines both, so a double submission cannot create two.
   */
  async create(actor: Actor, truckId: string, dto: CreateReviewDto) {
    if (actor.role !== UserRole.IMPORTER) {
      throw new ForbiddenException('Only importers can review a truck.');
    }
    const [truck, author, shipped] = await Promise.all([
      this.prisma.truck.findUnique({
        where: { id: truckId },
        select: { id: true },
      }),
      this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { name: true },
      }),
      this.prisma.booking.count({
        where: {
          truckId,
          importerId: actor.id,
          status: { in: REVIEWABLE_BOOKING_STATUSES },
        },
      }),
    ]);
    if (!truck) throw new NotFoundException('Truck not found.');
    if (!shipped) {
      throw new ForbiddenException(
        'You can review this truck once it has delivered your cargo.',
      );
    }
    const review: StoredReview = {
      id: `${truckId}:${actor.id}`,
      truckId,
      authorId: actor.id,
      authorName: author?.name ?? 'Importer',
      rating: dto.rating,
      comment: dto.comment,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.prisma.operationsRecord.create({
        data: {
          domain: 'reviews',
          recordId: review.id,
          ownerId: actor.id,
          truckId,
          searchText: `${review.authorName} ${review.comment}`,
          data: review,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You have already reviewed this truck.');
      }
      throw error;
    }
    const [withPhoto] = await this.withAuthorPhotos([review]);
    return withPhoto;
  }

  /** Points each author's avatar at GET /users/:id/photo when they have a photo. */
  private async withAuthorPhotos(reviews: StoredReview[]) {
    const authorIds = [...new Set(reviews.map((review) => review.authorId))];
    if (!authorIds.length) return [];
    const authors = await this.prisma.$queryRaw<
      { id: string; updatedAt: Date; hasPhoto: boolean }[]
    >`
      SELECT id, "updatedAt", COALESCE(photo LIKE 'data:%', false) AS "hasPhoto"
      FROM "User"
      WHERE id = ANY(${authorIds})
    `;
    const byId = new Map(authors.map((author) => [author.id, author]));
    return reviews.map((review) => {
      const author = byId.get(review.authorId);
      return {
        ...review,
        authorPhoto: author?.hasPhoto
          ? `/users/${author.id}/photo?v=${author.updatedAt.getTime()}`
          : undefined,
      };
    });
  }
}
