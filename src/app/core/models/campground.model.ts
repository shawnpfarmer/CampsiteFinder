export interface Campground {
  id: string;
  parkCode: string | null;
  name: string;
  description: string;
  lat: number;
  lng: number;
  agency: string;
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservationUrl: string;
  directionsUrl: string;
  images: unknown[];
  contact: unknown;
  distanceMeters: number;
}
