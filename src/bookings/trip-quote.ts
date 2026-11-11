import { BadRequestException } from '@nestjs/common';
import type { Truck } from '@prisma/client';
import { measureTrip, type RouteLeg } from '../trucks/distance';
import { countryOf, knownPlace } from '../trucks/marketplace';

export type TripRequest = {
  pickupCity?: string | null;
  pickupArea?: string | null;
  destinationCity?: string | null;
  destinationArea?: string | null;
};

export type TripQuote = {
  truckLocation: string;
  pickupCity: string;
  pickupCountry: string;
  pickupArea: string | null;
  destinationCity: string;
  destinationCountry: string;
  destinationArea: string | null;
  legs: RouteLeg[];
  km: number;
  source: 'google' | 'estimate';
  pricePerKmRwf: number;
  priceRwf: number;
  /** Paid within the window after the owner accepts. */
  depositRwf: number;
  /** Paid when the importer confirms receipt. */
  balanceRwf: number;
};

/** Half the price, rounded up, so the deposit and the balance always add up to the price. */
export function depositOf(priceRwf: number) {
  return Math.ceil(priceRwf / 2);
}

/**
 * Prices a trip on the server, never from the client: the vehicle drives from where it is to
 * the pickup, then to the destination, then back home; every km is charged at its rate.
 * The pickup and the destination must each be the vehicle's home city or a place it serves.
 */
export async function quoteTrip(
  truck: Pick<Truck, 'currentLocation' | 'destinations' | 'pricePerKmRwf'>,
  request: TripRequest,
): Promise<TripQuote> {
  if (!truck.pricePerKmRwf) {
    throw new BadRequestException(
      'This vehicle has no price per kilometre yet, so it cannot be booked.',
    );
  }
  const base = knownPlace(truck.currentLocation);
  if (!base) {
    throw new BadRequestException(
      'The owner has not set where this vehicle is, so the trip cannot be priced.',
    );
  }
  const served = new Set([base, ...truck.destinations]);
  const pickupCity = knownPlace(request.pickupCity) ?? base;
  const destinationCity = knownPlace(request.destinationCity);
  if (!served.has(pickupCity)) {
    throw new BadRequestException(
      `This vehicle does not pick up in ${pickupCity}. Choose ${[...served].join(', ')}.`,
    );
  }
  if (!destinationCity || !served.has(destinationCity)) {
    throw new BadRequestException(
      `Choose a destination this vehicle serves: ${[...served].join(', ')}.`,
    );
  }
  const pickupArea = request.pickupArea?.trim() || null;
  const destinationArea = request.destinationArea?.trim() || null;
  if (pickupCity === destinationCity && pickupArea === destinationArea) {
    throw new BadRequestException(
      'The pickup and the destination are the same place.',
    );
  }
  const trip = await measureTrip(
    { city: base },
    { city: pickupCity, area: pickupArea },
    { city: destinationCity, area: destinationArea },
  );
  if (!trip) {
    throw new BadRequestException(
      'We could not measure the distance for this route. Try again later.',
    );
  }
  const priceRwf = Math.round(trip.km * truck.pricePerKmRwf);
  const depositRwf = depositOf(priceRwf);
  return {
    truckLocation: base,
    pickupCity,
    pickupCountry: countryOf(pickupCity)!,
    pickupArea,
    destinationCity,
    destinationCountry: countryOf(destinationCity)!,
    destinationArea,
    legs: trip.legs,
    km: trip.km,
    source: trip.source,
    pricePerKmRwf: truck.pricePerKmRwf,
    priceRwf,
    depositRwf,
    balanceRwf: priceRwf - depositRwf,
  };
}
