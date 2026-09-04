interface NpsAddressRecord {
  type?: string;
  stateCode?: string;
}

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
  addresses?: NpsAddressRecord[];
}

export interface CampgroundRow {
  id: string;
  park_code: string;
  name: string;
  description: string;
  location: string; // WKT, e.g. 'POINT(lng lat)'
  state: string | null;
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservation_url: string;
  directions_url: string;
  images: unknown[];
  contact: unknown;
}

// NPS's field names here are this codebase's best recollection of its
// schema, unverified against a live response — a missing/renamed field
// must degrade to null, never throw.
function resolveState(addresses: NpsAddressRecord[] | undefined): string | null {
  if (!addresses || addresses.length === 0) return null;
  const physical = addresses.find((a) => a.type === "Physical");
  return (physical ?? addresses[0]).stateCode ?? null;
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
    state: resolveState(record.addresses),
    amenities: record.amenities ?? {},
    fees: record.fees ?? [],
    reservation_url: record.reservationUrl,
    directions_url: record.directionsUrl,
    images: record.images ?? [],
    contact: record.contacts ?? {},
  };
}
