import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Campground } from '../models/campground.model';
import { Coordinates } from './geolocation.service';

@Injectable({ providedIn: 'root' })
export class CampgroundsService {
  private readonly supabase = inject(SupabaseService);

  async getNearest(coords: Coordinates, limit = 50): Promise<Campground[]> {
    const { data, error } = await this.supabase.client.rpc('nearest_campgrounds', {
      user_lat: coords.lat,
      user_lng: coords.lng,
      result_limit: limit,
    });

    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      id: row.id,
      parkCode: row.park_code,
      name: row.name,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      amenities: row.amenities ?? {},
      fees: row.fees ?? [],
      reservationUrl: row.reservation_url,
      directionsUrl: row.directions_url,
      images: row.images ?? [],
      contact: row.contact,
      distanceMeters: row.distance_m,
    }));
  }

  async getByIds(ids: string[]): Promise<Campground[]> {
    const { data, error } = await this.supabase.client.rpc('get_campgrounds_by_ids', {
      campground_ids: ids,
    });

    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      id: row.id,
      parkCode: row.park_code,
      name: row.name,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      amenities: row.amenities ?? {},
      fees: row.fees ?? [],
      reservationUrl: row.reservation_url,
      directionsUrl: row.directions_url,
      images: row.images ?? [],
      contact: row.contact,
      distanceMeters: 0,
    }));
  }
}
