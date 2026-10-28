import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';

/** How long a signed-in user's record is reused before it is read from the database again. */
const TTL_MS = 60_000;

/**
 * Every authenticated request used to read its user from the database before doing any work,
 * which is slow when the database is far away. The record is kept here for a short time instead.
 * Code that changes a user (status, profile, deletion) must call `invalidate`, so deactivation
 * still takes effect on the next request.
 */
@Injectable()
export class UserSessionCache {
  private readonly users = new Map<string, { user: User; expiresAt: number }>();

  get(userId: string): User | undefined {
    const entry = this.users.get(userId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.users.delete(userId);
      return undefined;
    }
    return entry.user;
  }

  set(user: User): void {
    this.users.set(user.id, { user, expiresAt: Date.now() + TTL_MS });
  }

  invalidate(userId: string): void {
    this.users.delete(userId);
  }

  clear(): void {
    this.users.clear();
  }
}
