import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AdminUser } from '../models/admin-user.model';

@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  private readonly supabase = inject(SupabaseService);
  readonly users = signal<AdminUser[]>([]);

  async loadUsers(): Promise<void> {
    const { data, error } = await this.supabase.client.rpc('get_users_for_admin');
    if (error) throw error;
    this.users.set((data ?? []).map(mapRow));
  }

  async updateRole(userId: string, role: 'user' | 'moderator' | 'admin'): Promise<void> {
    const { error } = await this.supabase.client.rpc('admin_update_user_role', {
      target_user_id: userId,
      new_role: role,
    });
    if (error) throw error;
    this.users.update((users) => users.map((u) => (u.id === userId ? { ...u, role } : u)));
  }

  async setSuspended(userId: string, suspended: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('admin_set_user_suspended', {
      target_user_id: userId,
      is_suspended: suspended,
    });
    if (error) throw error;
    this.users.update((users) => users.map((u) => (u.id === userId ? { ...u, suspended } : u)));
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('admin-delete-account', {
      body: { target_user_id: userId },
    });
    if (error) throw error;
    this.users.update((users) => users.filter((u) => u.id !== userId));
  }
}

function mapRow(row: any): AdminUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    suspended: row.suspended,
    createdAt: row.created_at,
  };
}
