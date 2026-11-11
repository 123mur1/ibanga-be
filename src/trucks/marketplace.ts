/**
 * Shared marketplace vocabulary. The frontend offers the same lists (LOCATIONS, VEHICLE_CATEGORIES,
 * CARGO_TYPES in src/lib/types.ts), so every value an owner picks can be filtered and priced.
 */

/** Places vehicles operate between, with coordinates for the distance fallback. */
export const PLACES: Record<
  string,
  { country: string; lat: number; lng: number }
> = {
  Kigali: { country: 'Rwanda', lat: -1.9441, lng: 30.0619 },
  Musanze: { country: 'Rwanda', lat: -1.4998, lng: 29.6348 },
  Huye: { country: 'Rwanda', lat: -2.5967, lng: 29.7394 },
  Gisenyi: { country: 'Rwanda', lat: -1.7028, lng: 29.2564 },
  Rusizi: { country: 'Rwanda', lat: -2.4846, lng: 28.9075 },
  Nyagatare: { country: 'Rwanda', lat: -1.2938, lng: 30.3275 },
  Muhanga: { country: 'Rwanda', lat: -2.0845, lng: 29.7564 },
  Rwamagana: { country: 'Rwanda', lat: -1.9487, lng: 30.4347 },
  Rusumo: { country: 'Rwanda', lat: -2.3833, lng: 30.7833 },
  Gatuna: { country: 'Rwanda', lat: -1.4333, lng: 30.0 },
  Kagitumba: { country: 'Rwanda', lat: -1.0567, lng: 30.4597 },
  Goma: {
    country: 'Democratic Republic of the Congo',
    lat: -1.6585,
    lng: 29.2203,
  },
  Bujumbura: { country: 'Burundi', lat: -3.3614, lng: 29.3599 },
  Kampala: { country: 'Uganda', lat: 0.3476, lng: 32.5825 },
  Nairobi: { country: 'Kenya', lat: -1.2921, lng: 36.8219 },
  Mombasa: { country: 'Kenya', lat: -4.0435, lng: 39.6682 },
  Isaka: { country: 'Tanzania', lat: -3.8833, lng: 32.9333 },
  'Dar es Salaam': { country: 'Tanzania', lat: -6.7924, lng: 39.2083 },
};

export const LOCATIONS = Object.keys(PLACES);

/**
 * Areas (districts, sectors, neighbourhoods, ports and border posts) inside each listed city.
 * A booking records country → city → area for its pickup and destination; prices use the city
 * (or Google with the full address). The frontend keeps the same tree in src/lib/locations.ts.
 */
export const CITY_AREAS: Record<string, string[]> = {
  Kigali: [
    'Nyarugenge',
    'Gasabo',
    'Kicukiro',
    'Nyabugogo',
    'Remera',
    'Kimironko',
    'Kanombe',
    'Gikondo',
    'Masaka',
    'Kigali Special Economic Zone',
  ],
  Musanze: ['Muhoza', 'Cyuve', 'Kinigi', 'Busogo'],
  Huye: ['Ngoma', 'Tumba', 'Mbazi', 'Rusatira'],
  Gisenyi: ['Gisenyi', 'Nyamyumba', 'Rugerero', 'Petite Barrière border'],
  Rusizi: ['Kamembe', 'Gihundwe', 'Bugarama', 'Rusizi I border'],
  Nyagatare: ['Nyagatare town', 'Matimba', 'Rwimiyaga', 'Karangazi'],
  Muhanga: ['Nyamabuye', 'Shyogwe', 'Kabacuzi'],
  Rwamagana: ['Kigabiro', 'Muhazi', 'Fumbwe'],
  Rusumo: ['Rusumo border post', 'Kirehe', 'Nyakarambi'],
  Gatuna: ['Gatuna border post', 'Kaniga'],
  Kagitumba: ['Kagitumba border post', 'Matimba'],
  Goma: ['Himbi', 'Katindo', 'Birere', 'Mabanga'],
  Bujumbura: ['Rohero', 'Buyenzi', 'Kinama', 'Port of Bujumbura'],
  Kampala: [
    'Central',
    'Nakawa',
    'Kawempe',
    'Rubaga',
    'Makindye',
    'Namanve Industrial Park',
  ],
  Nairobi: ['CBD', 'Industrial Area', 'Embakasi', 'Westlands', 'ICD Nairobi'],
  Mombasa: ['Kilindini Port', 'Changamwe', 'Nyali', 'Likoni', 'Mombasa CBD'],
  Isaka: ['Isaka Dry Port', 'Isaka town'],
  'Dar es Salaam': [
    'Dar es Salaam Port',
    'Kurasini',
    'Ilala',
    'Kinondoni',
    'Temeke',
  ],
};

/** The country a listed city is in, matched without regard to case. */
export function countryOf(city: string | null | undefined): string | null {
  const place = knownPlace(city);
  return place ? PLACES[place].country : null;
}

/** "Area, City, Country" for display and for Google, leaving out missing parts. */
export function fullAddress(city: string, area?: string | null) {
  const place = knownPlace(city) ?? city;
  return [area?.trim(), place, countryOf(place)].filter(Boolean).join(', ');
}

export const VEHICLE_CATEGORIES = [
  'Pickup and van',
  'Light truck',
  'Medium truck',
  'Heavy truck',
  'Trailer and articulated',
];

export const CARGO_TYPES = [
  'Coffee',
  'Tea',
  'Food and grains',
  'Fresh produce',
  'Beverages',
  'Building materials',
  'Cement',
  'Steel and metal',
  'Fuel and oil',
  'Chemicals',
  'Machinery and equipment',
  'Vehicles and spare parts',
  'Electronics',
  'Textiles and clothing',
  'Furniture',
  'Household goods',
  'Medical supplies',
  'General goods',
  'Other',
];

/** The listed place a stored location names, matched without regard to case. */
export function knownPlace(name: string | null | undefined): string | null {
  const key = (name ?? '').trim().toLowerCase();
  return LOCATIONS.find((place) => place.toLowerCase() === key) ?? null;
}
