import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserProfile } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly supabase = inject(SupabaseService);
  readonly profile = signal<UserProfile | null>(null);

  async loadProfile(): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) {
      this.profile.set(null);
      return;
    }
    const { data, error } = await this.supabase.client
      .from('users')
      .select('id, display_name, theme, role')
      .eq('id', userId)
      .single();
    if (error) throw error;
    this.profile.set({
      id: data.id,
      displayName: data.display_name,
      theme: data.theme,
      role: data.role,
    });
    if (data.theme) {
      document.documentElement.dataset['theme'] = data.theme;
    }
  }

  async updateDisplayName(displayName: string): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to update display name');

    const { error: updateError } = await this.supabase.client
      .from('users')
      .update({ display_name: displayName })
      .eq('id', userId);
    if (updateError) throw updateError;

    // Keeps the session's user_metadata in sync with the users row (mirrors
    // AlienHunter01's pattern). Nothing in this app reads display_name from
    // the session today, but this keeps the two from silently drifting.
    const { error: metadataError } = await this.supabase.client.auth.updateUser({
      data: { display_name: displayName },
    });
    if (metadataError) throw metadataError;

    this.profile.update((p) => (p ? { ...p, displayName } : p));
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.supabase.client.auth.updateUser({ password });
    if (error) throw error;
  }

  async updateTheme(theme: 'light' | 'dark'): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to update theme');

    const { error } = await this.supabase.client
      .from('users')
      .update({ theme })
      .eq('id', userId);
    if (error) throw error;

    document.documentElement.dataset['theme'] = theme;
    this.profile.update((p) => (p ? { ...p, theme } : p));
  }

  async deleteAccount(): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('delete-account');
    if (error) throw error;
    await this.supabase.client.auth.signOut();
    this.profile.set(null);
  }
}
