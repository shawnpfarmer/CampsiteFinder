import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FavoritesService } from './favorites.service';
import { SupabaseService } from './supabase.service';

function createSupabaseTableMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  builder.select = vi.fn().mockReturnValue(builder);
  builder.delete = vi.fn().mockReturnValue(builder);
  builder.insert = vi.fn().mockReturnValue(builder);
  builder.update = vi.fn().mockReturnValue(builder);
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
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: [{ campground_id: 'cg-1', note: null }], error: null }));

    await service.loadFavoriteIds();

    expect(service.favoriteIds().has('cg-1')).toBe(true);
  });

  it('loads favorite notes alongside ids for the signed-in user', async () => {
    fromSpy.mockReturnValue(
      createSupabaseTableMock({ data: [{ campground_id: 'cg-1', note: 'great sites' }], error: null }),
    );

    await service.loadFavoriteIds();

    expect(service.favoriteNotes().get('cg-1')).toBe('great sites');
  });

  it('adds a campground to favorites when not already favorited', async () => {
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.toggleFavorite('cg-2');

    expect(service.favoriteIds().has('cg-2')).toBe(true);
  });

  it('seeds a null note when a campground is newly favorited', async () => {
    service.favoriteNotes.set(new Map([['cg-2', 'a stale note from a previous favorite']]));
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.toggleFavorite('cg-2');

    expect(service.favoriteNotes().has('cg-2')).toBe(true);
    expect(service.favoriteNotes().get('cg-2')).toBeNull();
  });

  it('removes a campground from favorites when already favorited', async () => {
    service.favoriteIds.set(new Set(['cg-3']));
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.toggleFavorite('cg-3');

    expect(service.favoriteIds().has('cg-3')).toBe(false);
  });

  it('clears the local note when a campground is un-favorited', async () => {
    service.favoriteIds.set(new Set(['cg-3']));
    service.favoriteNotes.set(new Map([['cg-3', 'book early'], ['cg-4', 'keep me']]));
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.toggleFavorite('cg-3');

    expect(service.favoriteNotes().has('cg-3')).toBe(false);
    expect(service.favoriteNotes().get('cg-4')).toBe('keep me');
  });

  it('updates a favorite note and stores it locally', async () => {
    fromSpy.mockReturnValue(
      createSupabaseTableMock({ data: [{ campground_id: 'cg-1' }], error: null }),
    );

    await service.updateNote('cg-1', 'book early');

    expect(service.favoriteNotes().get('cg-1')).toBe('book early');
  });

  it('throws and leaves the local note map alone when the update matches no rows', async () => {
    service.favoriteNotes.set(new Map([['cg-1', 'original']]));
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: [], error: null }));

    await expect(service.updateNote('cg-1', 'book early')).rejects.toThrow(
      'No matching favorite to update',
    );
    expect(service.favoriteNotes().get('cg-1')).toBe('original');
  });
});
