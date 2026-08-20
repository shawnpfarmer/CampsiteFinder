import { Campground } from './campground.model';

export interface Trip {
  id: string;
  name: string;
  createdAt: string;
}

export interface TripStop {
  stopId: string;
  campground: Campground;
}
