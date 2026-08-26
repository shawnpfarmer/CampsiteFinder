import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AdminUserSummary } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly supabase = inject(SupabaseService);

  async listUsers(): Promise<AdminUserSummary[]> {
    const { data, error } = await this.supabase.client
      .from('users')
      .select('id, display_name, role')
      .order('display_name', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({ id: row.id, displayName: row.display_name, role: row.role }));
  }
}
