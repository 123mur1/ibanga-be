import { Injectable, NotFoundException } from '@nestjs/common';
import {
  decodeDataUrl,
  ImageCache,
  type DecodedFile,
} from '../common/data-url';
import { PrismaService } from '../prisma/prisma.service';

type TruckRef = { id: string; updatedAt: Date };
export type CoverPhoto = { photos: string[]; photoCount: number };

/** How many decoded photos the API keeps in memory. */
const MAX_CACHED_PHOTOS = 200;

/**
 * Photos are stored inline as data URLs, and pulling them out of a distant database is the
 * slowest part of listing trucks. Lists therefore leave photos out of the query and point the
 * cover at GET /trucks/:id/photos/0 instead. The URL carries the truck's last update time, so
 * the browser can cache the image for good and a changed photo gets a new URL.
 */
@Injectable()
export class TruckPhotos {
  private readonly cache = new ImageCache(MAX_CACHED_PHOTOS);

  constructor(private readonly prisma: PrismaService) {}

  /** Cover photo URL (or stored path) and gallery size for each truck, in one query. */
  async covers(trucks: TruckRef[]): Promise<Map<string, CoverPhoto>> {
    if (!trucks.length) return new Map();
    const rows = await this.prisma.$queryRaw<
      { id: string; count: number; plain: string | null }[]
    >`
      SELECT id,
        COALESCE(cardinality(photos), 0)::int AS count,
        CASE WHEN photos[1] LIKE 'data:%' THEN NULL ELSE photos[1] END AS plain
      FROM "Truck"
      WHERE id = ANY(${trucks.map((truck) => truck.id)})
    `;
    const updatedAt = new Map(
      trucks.map((truck) => [truck.id, truck.updatedAt.getTime()]),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        {
          photoCount: row.count,
          photos: !row.count
            ? []
            : [
                row.plain ??
                  `/trucks/${row.id}/photos/0?v=${updatedAt.get(row.id) ?? 0}`,
              ],
        },
      ]),
    );
  }

  /** Lists trucks with only their cover photo, read without loading the stored images. */
  async withCovers<T extends TruckRef>(
    trucks: T[],
  ): Promise<(T & CoverPhoto)[]> {
    const covers = await this.covers(trucks);
    return trucks.map((truck) => ({
      ...truck,
      ...(covers.get(truck.id) ?? { photos: [], photoCount: 0 }),
    }));
  }

  /** One stored photo as binary, for an <img> tag. */
  async photo(
    truckId: string,
    index: number,
    version: string,
  ): Promise<DecodedFile> {
    const key = `${truckId}:${index}:${version}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const [row] = await this.prisma.$queryRaw<{ photo: string | null }[]>`
      SELECT photos[${index + 1}] AS photo FROM "Truck" WHERE id = ${truckId}
    `;
    const photo = decodeDataUrl(row?.photo);
    if (!photo) throw new NotFoundException('Photo not found.');
    this.cache.set(key, photo);
    return photo;
  }
}
