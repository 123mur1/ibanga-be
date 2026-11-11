import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGuestReviewDto, CreateReviewDto } from './dto/create-review.dto';

type Actor = { id: string; role: UserRole };

type StoredReview = {
  id: string;
  truckId: string;
  authorId: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
  /** Posted without an account, under the name the visitor gave. */
  guest?: boolean;
};

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
   * A signed-in user reviews a vehicle. One review per person and vehicle: the record id combines
   * both, so a double submission cannot create two. Owners cannot review their own vehicles.
   */
  async create(actor: Actor, truckId: string, dto: CreateReviewDto) {
    const [truck, author] = await Promise.all([
      this.prisma.truck.findUnique({
        where: { id: truckId },
        select: { id: true, ownerId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { name: true },
      }),
    ]);
    if (!truck) throw new NotFoundException('Truck not found.');
    if (truck.ownerId === actor.id || actor.role === UserRole.ADMIN) {
      throw new ForbiddenException('You cannot review this vehicle.');
    }
    const review: StoredReview = {
      id: `${truckId}:${actor.id}`,
      truckId,
      authorId: actor.id,
      authorName: author?.name ?? 'iBanga user',
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

  /** A visitor reviews a vehicle without an account, under the name they give. */
  async createGuest(truckId: string, dto: CreateGuestReviewDto) {
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
      select: { id: true },
    });
    if (!truck) throw new NotFoundException('Truck not found.');
    const review: StoredReview = {
      id: `${truckId}:guest:${randomUUID()}`,
      truckId,
      authorId: 'guest',
      authorName: dto.authorName,
      rating: dto.rating,
      comment: dto.comment,
      createdAt: new Date().toISOString(),
      guest: true,
    };
    await this.prisma.operationsRecord.create({
      data: {
        domain: 'reviews',
        recordId: review.id,
        ownerId: null,
        truckId,
        searchText: `${review.authorName} ${review.comment}`,
        data: review,
      },
    });
    return review;
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
