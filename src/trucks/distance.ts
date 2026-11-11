import { Logger } from '@nestjs/common';
import { PLACES, fullAddress, knownPlace } from './marketplace';

/**
 * Driving distance between two places, used to price a trip (distance × the vehicle's rate).
 *
 * With GOOGLE_MAPS_API_KEY set, it asks the Google Maps Routes API for the driving route. Without
 * a key, or if Google cannot answer, it estimates from the listed places' coordinates: the
 * straight-line distance times a typical road factor. The frontend uses the same rule, so the
 * price an importer sees matches what is charged.
 */

export type RouteDistance = { km: number; source: 'google' | 'estimate' };

const ROAD_FACTOR = 1.3;
const logger = new Logger('Distance');
const cache = new Map<string, RouteDistance>();

function address(place: string) {
  const known = knownPlace(place);
  return known ? `${known}, ${PLACES[known].country}` : place.trim();
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function googleDistance(
  from: string,
  to: string,
): Promise<RouteDistance | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'routes.distanceMeters',
        },
        body: JSON.stringify({
          origin: { address: address(from) },
          destination: { address: address(to) },
          travelMode: 'DRIVE',
          units: 'METRIC',
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      logger.warn(
        `Google Routes answered ${response.status}; using the estimate.`,
      );
      return null;
    }
    const data = (await response.json()) as {
      routes?: { distanceMeters?: number }[];
    };
    const meters = data.routes?.[0]?.distanceMeters;
    return meters
      ? { km: Math.max(1, Math.round(meters / 1000)), source: 'google' }
      : null;
  } catch (error) {
    logger.warn(`Google Routes failed (${String(error)}); using the estimate.`);
    return null;
  }
}

function estimatedDistance(from: string, to: string): RouteDistance | null {
  const a = knownPlace(from);
  const b = knownPlace(to);
  if (!a || !b) return null;
  return {
    km: Math.max(
      1,
      Math.round(haversineKm(PLACES[a], PLACES[b]) * ROAD_FACTOR),
    ),
    source: 'estimate',
  };
}

/** A stop on a trip: a listed city and, optionally, the area inside it. */
export type RouteStop = { city: string; area?: string | null };
export type RouteLeg = {
  from: string;
  to: string;
  km: number;
  source: 'google' | 'estimate';
};

/**
 * Two stops in the same city are still a short drive apart; without Google this is the estimate.
 * It keeps a trip inside one city from being priced at zero.
 */
const SAME_CITY_KM = 10;

/**
 * The whole trip the vehicle drives, every leg priced: from where it is now to the pickup, from
 * the pickup to the destination, and back to where it started. A vehicle in Kigali carrying
 * cargo from Mombasa to Kigali is priced Kigali → Mombasa → Kigali (the last leg is zero).
 * Returns null when a leg cannot be measured.
 */
export async function measureTrip(
  base: RouteStop,
  pickup: RouteStop,
  destination: RouteStop,
): Promise<{
  legs: RouteLeg[];
  km: number;
  source: 'google' | 'estimate';
} | null> {
  const pairs: [RouteStop, RouteStop][] = [
    [base, pickup],
    [pickup, destination],
    [destination, base],
  ];
  const legs: RouteLeg[] = [];
  for (const [from, to] of pairs) {
    const fromLabel = fullAddress(from.city, from.area);
    const toLabel = fullAddress(to.city, to.area);
    const sameCity =
      knownPlace(from.city) !== null &&
      knownPlace(from.city) === knownPlace(to.city);
    const samePlace =
      sameCity &&
      (from.area ?? '').trim().toLowerCase() ===
        (to.area ?? '').trim().toLowerCase();
    if (samePlace) {
      legs.push({ from: fromLabel, to: toLabel, km: 0, source: 'estimate' });
      continue;
    }
    const google =
      from.area || to.area ? await googleDistance(fromLabel, toLabel) : null;
    const measured =
      google ??
      (sameCity
        ? { km: SAME_CITY_KM, source: 'estimate' }
        : await measureDistance(from.city, to.city));
    if (!measured) return null;
    legs.push({ from: fromLabel, to: toLabel, ...measured });
  }
  return {
    legs,
    km: legs.reduce((sum, leg) => sum + leg.km, 0),
    source: legs.every((leg) => leg.source === 'google' || leg.km === 0)
      ? 'google'
      : 'estimate',
  };
}

/** Road distance in km, or null when neither Google nor the place list knows the route. */
export async function measureDistance(
  from: string,
  to: string,
): Promise<RouteDistance | null> {
  const cacheKey = `${from.trim().toLowerCase()}→${to.trim().toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const result =
    (await googleDistance(from, to)) ?? estimatedDistance(from, to);
  // Only Google answers are kept: an estimate is retried in case Google recovers.
  if (result?.source === 'google') cache.set(cacheKey, result);
  return result;
}
