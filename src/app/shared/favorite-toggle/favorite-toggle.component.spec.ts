import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FavoriteToggleComponent } from './favorite-toggle.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { SupabaseService } from '../../core/services/supabase.service';

describe('FavoriteToggleComponent', () => {
  let component: FavoriteToggleComponent;
  let toggleSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toggleSpy = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      imports: [FavoriteToggleComponent],
      providers: [
        {
          provide: FavoritesService,
          useValue: {
            favoriteIds: () => new Set(),
            toggleFavorite: toggleSpy,
            loadFavoriteIds: () => Promise.resolve(),
          },
        },
        { provide: SupabaseService, useValue: { isAuthenticated: true } },
      ],
    });

    component = TestBed.createComponent(FavoriteToggleComponent).componentInstance;
    component.campgroundId = 'cg-1';
  });

  it('calls toggleFavorite with the campground id on click', () => {
    component.onToggle();
    expect(toggleSpy).toHaveBeenCalledWith('cg-1');
  });
});
