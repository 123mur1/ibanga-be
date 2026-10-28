import type { Response } from 'express';

export type DecodedFile = { contentType: string; body: Buffer };

/** Decodes a `data:` URL into its bytes, or null when the value is not one. */
export function decodeDataUrl(
  value: string | null | undefined,
): DecodedFile | null {
  const match = value?.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) return null;
  return {
    contentType: match[1],
    body: match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3])),
  };
}

/**
 * Sends a stored image. A versioned URL (`?v=` last update time) never changes content, so the
 * browser may keep it for good; a new photo gets a new URL.
 */
export function sendImage(
  res: Response,
  file: DecodedFile,
  version: string | undefined,
) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Cache-Control',
    version ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
  res.send(file.body);
}

/** A small insertion-ordered cache of decoded images, so repeat requests skip the database. */
export class ImageCache {
  private readonly entries = new Map<string, DecodedFile>();

  constructor(private readonly limit: number) {}

  get(key: string) {
    return this.entries.get(key);
  }

  set(key: string, file: DecodedFile) {
    if (this.entries.size >= this.limit) {
      // Maps keep insertion order, so the first key is the oldest entry.
      for (const oldest of this.entries.keys()) {
        this.entries.delete(oldest);
        break;
      }
    }
    this.entries.set(key, file);
  }
}
