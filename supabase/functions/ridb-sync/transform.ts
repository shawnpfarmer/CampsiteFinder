import { resolveAgency, RidbOrganization } from "./agency.ts";

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
  ORGANIZATION?: RidbOrganization[];
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
}

export function toCampgroundRow(facility: RidbFacilityRecord): CampgroundRow | null {
  if (!facility.FacilityID) return null;

  const lat = facility.FacilityLatitude;
  const lng = facility.FacilityLongitude;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }

  const agency = resolveAgency(facility.ORGANIZATION);
  if (!agency || agency === "NPS") {
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
    directions_url: facility.FacilityDirections ?? "",
    images: [],
    contact: { phone: facility.FacilityPhone ?? "", email: facility.FacilityEmail ?? "" },
  };
}
