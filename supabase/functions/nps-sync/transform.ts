export interface NpsCampgroundRecord {
  id: string;
  parkCode: string;
  name: string;
  description: string;
  latitude: string;
  longitude: string;
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservationUrl: string;
  directionsUrl: string;
  images: unknown[];
  contacts: unknown;
}

export interface CampgroundRow {
  id: string;
  park_code: string;
  name: string;
  description: string;
  location: string; // WKT, e.g. 'POINT(lng lat)'
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservation_url: string;
  directions_url: string;
  images: unknown[];
  contact: unknown;
}

export function toCampgroundRow(record: NpsCampgroundRecord): CampgroundRow | null {
  const lat = parseFloat(record.latitude);
  const lng = parseFloat(record.longitude);
  if (!record.id || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  return {
    id: record.id,
    park_code: record.parkCode,
    name: record.name,
    description: record.description,
    location: `POINT(${lng} ${lat})`,
    amenities: record.amenities ?? {},
    fees: record.fees ?? [],
    reservation_url: record.reservationUrl,
    directions_url: record.directionsUrl,
    images: record.images ?? [],
    contact: record.contacts ?? {},
  };
}
