import { resolveAgency, RidbOrganization } from "./agency.ts";

interface RidbAddressRecord {
  FacilityAddressType?: string;
  AddressStateCode?: string;
}

export interface RidbFacilityRecord {
  FacilityID: string;
  FacilityName: string;
  FacilityDescription?: string;
  FacilityLatitude: number | null;
  FacilityLongitude: number | null;
  FacilityReservationURL?: string;
  FacilityDirections?: string;
  FacilityPhone?: string;
  FacilityEmail?: string;
  FacilityTypeDescription?: string;
  ORGANIZATION?: RidbOrganization[];
  FACILITYADDRESS?: RidbAddressRecord[];
}

export interface CampgroundRow {
  id: string;
  park_code: null;
  name: string;
  description: string;
  location: string; // WKT, e.g. 'POINT(lng lat)'
  agency: string;
  source: "ridb";
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservation_url: string;
  directions_url: string;
  images: unknown[];
  contact: unknown;
  state: string | null;
}

// RIDB's field names here are this codebase's best recollection of its
// schema, unverified against a live response (see plan's Task notes) — a
// missing/renamed field must degrade to null, never throw.
function resolveState(addresses: RidbAddressRecord[] | undefined): string | null {
  if (!addresses || addresses.length === 0) return null;
  const physical = addresses.find((a) => a.FacilityAddressType === "Physical");
  return (physical ?? addresses[0]).AddressStateCode ?? null;
}

export function toCampgroundRow(facility: RidbFacilityRecord): CampgroundRow | null {
  if (!facility.FacilityID) return null;
  if (!facility.FacilityName) return null;

  const lat = facility.FacilityLatitude;
  const lng = facility.FacilityLongitude;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }

  const agency = resolveAgency(facility.ORGANIZATION);
  if (!agency || agency === "NPS") {
    return null;
  }

  // Be lenient: only skip on a type mismatch we're sure of. If the field is
  // absent (unverified against a live API — see plan's Task 9 Step 2),
  // don't skip.
  if (
    facility.FacilityTypeDescription != null &&
    facility.FacilityTypeDescription !== "Campground"
  ) {
    return null;
  }

  return {
    id: `ridb:${facility.FacilityID}`,
    park_code: null,
    name: facility.FacilityName,
    description: facility.FacilityDescription ?? "",
    location: `POINT(${lng} ${lat})`,
    agency,
    source: "ridb",
    amenities: {},
    fees: [],
    reservation_url: facility.FacilityReservationURL ?? "",
    // RIDB's FacilityDirections is free-text driving directions prose (e.g.
    // "Take Forest Road 13 north."), not a URL — do not put it in a field
    // the UI renders as a clickable href.
    directions_url: "",
    images: [],
    contact: { phone: facility.FacilityPhone ?? "", email: facility.FacilityEmail ?? "" },
    state: resolveState(facility.FACILITYADDRESS),
  };
}
