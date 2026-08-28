import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CampgroundAttribute } from '../models/campground-attribute.model';

@Injectable({ providedIn: 'root' })
export class CampgroundAttributesService {
  private readonly supabase = inject(SupabaseService);
  readonly attributes = signal<CampgroundAttribute[]>([]);

  async loadForCampground(campgroundId: string): Promise<void> {
    this.attributes.set([]);
    const { data, error } = await this.supabase.client
      .from('campground_attributes')
      .select('id, campground_id, type, name, value, created_at')
      .eq('campground_id', campgroundId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    this.attributes.set((data ?? []).map(mapRow));
  }

  async addAttribute(campgroundId: string, type: string, name: string, value: string | null): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('campground_attributes')
      .insert({ campground_id: campgroundId, type, name, value })
      .select('id, campground_id, type, name, value, created_at')
      .single();
    if (error) throw error;
    this.attributes.update((attrs) => [...attrs, mapRow(data)]);
  }

  async updateAttribute(attributeId: string, type: string, name: string, value: string | null): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('campground_attributes')
      .update({ type, name, value })
      .eq('id', attributeId)
      .select('id, campground_id, type, name, value, created_at');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No matching attribute to update');
    const updated = mapRow(data[0]);
    this.attributes.update((attrs) => attrs.map((a) => (a.id === attributeId ? updated : a)));
  }

  async deleteAttribute(attributeId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('campground_attributes')
      .delete()
      .eq('id', attributeId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No matching attribute to delete');
    this.attributes.update((attrs) => attrs.filter((a) => a.id !== attributeId));
  }
}

function mapRow(row: any): CampgroundAttribute {
  return {
    id: row.id,
    campgroundId: row.campground_id,
    type: row.type,
    name: row.name,
    value: row.value,
    createdAt: row.created_at,
  };
}
