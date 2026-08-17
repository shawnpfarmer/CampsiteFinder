import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly supabase = inject(SupabaseService);
  readonly favoriteIds = signal<Set<string>>(new Set());

  async loadFavoriteIds(): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) {
      this.favoriteIds.set(new Set());
      return;
    }
    const { data, error } = await this.supabase.client
      .from('favorites')
      .select('campground_id')
      .eq('user_id', userId);
    if (error) throw error;
    this.favoriteIds.set(new Set((data ?? []).map((row: any) => row.campground_id)));
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
}
