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
    } else {
      const { error } = await this.supabase.client
        .from('favorites')
        .insert({ user_id: userId, campground_id: campgroundId });
      if (error) throw error;
      this.favoriteIds.update((ids) => new Set(ids).add(campgroundId));
    }
  }

  async updateNote(campgroundId: string, note: string): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to note a favorited campground');

    const { error } = await this.supabase.client
      .from('favorites')
      .update({ note })
      .eq('user_id', userId)
      .eq('campground_id', campgroundId);
    if (error) throw error;

    this.favoriteNotes.update((notes) => {
      const next = new Map(notes);
      next.set(campgroundId, note);
      return next;
    });
  }
}
