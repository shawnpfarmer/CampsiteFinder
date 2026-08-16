export interface Campground {
  id: string;
  parkCode: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservationUrl: string;
  directionsUrl: string;
  images: unknown[];
  contact: unknown;
  distanceMeters: number;
}
