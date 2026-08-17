import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FavoritesComponent } from './favorites.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { SupabaseService } from '../../core/services/supabase.service';

describe('FavoritesComponent', () => {
  it('loads full campground details for each favorited id', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [{
        id: 'cg-1', park_code: 'acad', name: 'Blackwoods', description: '',
        lat: 44.3, lng: -68.2, amenities: {}, fees: [], reservation_url: '',
        directions_url: '', images: [], contact: {},
      }],
      error: null,
    });

    TestBed.configureTestingModule({
      imports: [FavoritesComponent],
      providers: [
        {
          provide: FavoritesService,
          useValue: { loadFavoriteIds: () => Promise.resolve(), favoriteIds: () => new Set(['cg-1']) },
        },
        { provide: SupabaseService, useValue: { client: { rpc: rpcSpy } } },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;
    await component.ngOnInit();

    expect(rpcSpy).toHaveBeenCalledWith('get_campgrounds_by_ids', { campground_ids: ['cg-1'] });
    expect(component.campgrounds()[0].name).toBe('Blackwoods');
  });

  it('shows an empty list when there are no favorites', async () => {
    TestBed.configureTestingModule({
      imports: [FavoritesComponent],
      providers: [
        {
          provide: FavoritesService,
          useValue: { loadFavoriteIds: () => Promise.resolve(), favoriteIds: () => new Set() },
        },
        { provide: SupabaseService, useValue: { client: { rpc: vi.fn() } } },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;
    await component.ngOnInit();

    expect(component.campgrounds()).toEqual([]);
  });
});
