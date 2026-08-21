import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly supabase = inject(SupabaseService);
  readonly favoriteIds = signal<Set<string>>(new Set());
  readonly favoriteNotes = signal<Map<string, string | null>>(new Map());

  async loadFavoriteIds(): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) {
      this.favoriteIds.set(new Set());
      this.favoriteNotes.set(new Map());
      return;
    }
    const { data, error } = await this.supabase.client
      .from('favorites')
      .select('campground_id, note')
      .eq('user_id', userId);
    if (error) throw error;
    const rows = data ?? [];
    this.favoriteIds.set(new Set(rows.map((row: any) => row.campground_id)));
    this.favoriteNotes.set(new Map(rows.map((row: any) => [row.campground_id, row.note])));
  }

  async toggleFavorite(campgroundId: string): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to favorite a campground');

    const isFavorite = this.favoriteIds().has(campgroundId);
    if (isFavorite) {
      const { error } = await this.supabase.client
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('campground_id', campgroundId);
      if (error) throw error;
      this.favoriteIds.update((ids) => {
        const next = new Set(ids);
        next.delete(campgroundId);
        return next;
      });
      // The favorites row (and its note column) is gone from the database —
      // drop the local note too, or a stale note lingers in the UI and any
      // later edit would silently update zero rows.
      this.favoriteNotes.update((notes) => {
        const next = new Map(notes);
        next.delete(campgroundId);
        return next;
      });
    } else {
      const { error } = await this.supabase.client
        .from('favorites')
        .insert({ user_id: userId, campground_id: campgroundId });
      if (error) throw error;
      this.favoriteIds.update((ids) => new Set(ids).add(campgroundId));
      // A freshly-inserted favorites row has no note yet; seed null so the
      // local map matches the database rather than resurrecting an old note.
      this.favoriteNotes.update((notes) => {
        const next = new Map(notes);
        next.set(campgroundId, null);
        return next;
      });
    }
  }

  async updateNote(campgroundId: string, note: string): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to note a favorited campground');

    // `.select()` makes the update return the affected rows. Without it a
    // no-op update (the favorite was un-favorited elsewhere, or RLS filtered
    // the row out) comes back as `{ error: null }` and would look like a
    // successful save while nothing was persisted.
    const { data, error } = await this.supabase.client
      .from('favorites')
      .update({ note })
      .eq('user_id', userId)
      .eq('campground_id', campgroundId)
      .select('campground_id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No matching favorite to update');

    this.favoriteNotes.update((notes) => {
      const next = new Map(notes);
      next.set(campgroundId, note);
      return next;
    });
  }
}
