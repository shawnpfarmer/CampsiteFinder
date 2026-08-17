import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FavoritesService } from './favorites.service';
import { SupabaseService } from './supabase.service';

function createSupabaseTableMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.delete = vi.fn().mockReturnValue(builder);
  builder.insert = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.then = (resolve: any) => resolve(result);
  return builder;
}

describe('FavoritesService', () => {
  let service: FavoritesService;
  let fromSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SupabaseService,
          useValue: { session: () => ({ user: { id: 'user-1' } }), client: { from: fromSpy } },
        },
      ],
    });
    service = TestBed.inject(FavoritesService);
  });

  it('loads favorite ids for the signed-in user', async () => {
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: [{ campground_id: 'cg-1' }], error: null }));

    await service.loadFavoriteIds();

    expect(service.favoriteIds().has('cg-1')).toBe(true);
  });

  it('adds a campground to favorites when not already favorited', async () => {
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.toggleFavorite('cg-2');

    expect(service.favoriteIds().has('cg-2')).toBe(true);
  });

  it('removes a campground from favorites when already favorited', async () => {
    service.favoriteIds.set(new Set(['cg-3']));
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.toggleFavorite('cg-3');

    expect(service.favoriteIds().has('cg-3')).toBe(false);
  });
});
