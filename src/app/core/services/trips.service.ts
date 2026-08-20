import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CampgroundsService } from './campgrounds.service';
import { Trip, TripStop } from '../models/trip.model';

@Injectable({ providedIn: 'root' })
export class TripsService {
  private readonly supabase = inject(SupabaseService);
  private readonly campgroundsService = inject(CampgroundsService);

  readonly trips = signal<Trip[]>([]);

  async loadTrips(): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) {
      this.trips.set([]);
      return;
    }
    const { data, error } = await this.supabase.client
      .from('trips')
      .select('id, name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    this.trips.set(
      (data ?? []).map((row: any) => ({ id: row.id, name: row.name, createdAt: row.created_at })),
    );
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    const { data, error } = await this.supabase.client
      .from('trips')
      .select('id, name, created_at')
      .eq('id', tripId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { id: data.id, name: data.name, createdAt: data.created_at };
  }

  async getTripStops(tripId: string): Promise<TripStop[]> {
    const { data, error } = await this.supabase.client
      .from('trip_stops')
      .select('id, campground_id, position')
      .eq('trip_id', tripId)
      .order('position', { ascending: true });
    if (error) throw error;
    const stopRows = data ?? [];
    if (stopRows.length === 0) return [];

    const campgrounds = await this.campgroundsService.getByIds(
      stopRows.map((s: any) => s.campground_id),
    );
    const byId = new Map(campgrounds.map((c) => [c.id, c]));
    return stopRows
      .map((s: any) => {
        const campground = byId.get(s.campground_id);
        return campground ? { stopId: s.id, campground } : null;
      })
      .filter((s: TripStop | null): s is TripStop => s !== null);
  }

  async createTrip(name: string, campgroundIds: string[]): Promise<string> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to create a trip');

    const { data, error } = await this.supabase.client
      .from('trips')
      .insert({ user_id: userId, name })
      .select('id')
      .single();
    if (error) throw error;

    const tripId = data.id;
    if (campgroundIds.length > 0) {
      const stopRows = campgroundIds.map((campgroundId, index) => ({
        trip_id: tripId,
        campground_id: campgroundId,
        position: index,
      }));
      const { error: stopsError } = await this.supabase.client.from('trip_stops').insert(stopRows);
      if (stopsError) throw stopsError;
    }

    await this.loadTrips();
    return tripId;
  }

  async renameTrip(tripId: string, name: string): Promise<void> {
    const { error } = await this.supabase.client.from('trips').update({ name }).eq('id', tripId);
    if (error) throw error;
    this.trips.update((trips) => trips.map((t) => (t.id === tripId ? { ...t, name } : t)));
  }

  async deleteTrip(tripId: string): Promise<void> {
    const { error } = await this.supabase.client.from('trips').delete().eq('id', tripId);
    if (error) throw error;
    this.trips.update((trips) => trips.filter((t) => t.id !== tripId));
  }

  async addStop(tripId: string, campgroundId: string): Promise<void> {
    const { data, error: maxError } = await this.supabase.client
      .from('trip_stops')
      .select('position')
      .eq('trip_id', tripId)
      .order('position', { ascending: false })
      .limit(1);
    if (maxError) throw maxError;
    const nextPosition = (data && data.length > 0 ? data[0].position : -1) + 1;

    const { error } = await this.supabase.client
      .from('trip_stops')
      .insert({ trip_id: tripId, campground_id: campgroundId, position: nextPosition });
    if (error) throw error;
  }

  async removeStop(tripId: string, stopId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('trip_stops')
      .delete()
      .eq('id', stopId)
      .eq('trip_id', tripId);
    if (error) throw error;
  }

  async reorderStops(tripId: string, orderedStopIds: string[]): Promise<void> {
    for (let i = 0; i < orderedStopIds.length; i++) {
      const { error } = await this.supabase.client
        .from('trip_stops')
        .update({ position: i })
        .eq('id', orderedStopIds[i])
        .eq('trip_id', tripId);
      if (error) throw error;
    }
  }
}
