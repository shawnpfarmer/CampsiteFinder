import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FavoritesComponent } from './favorites.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';

describe('FavoritesComponent', () => {
  it('loads full campground details for each favorited id', async () => {
    const getByIdsSpy = vi.fn().mockResolvedValue([{
      id: 'cg-1', parkCode: 'acad', name: 'Blackwoods', description: '',
      lat: 44.3, lng: -68.2, amenities: {}, fees: [], reservationUrl: '',
      directionsUrl: '', images: [], contact: {}, distanceMeters: 0,
    }]);

    TestBed.configureTestingModule({
      imports: [FavoritesComponent],
      providers: [
        {
          provide: FavoritesService,
          useValue: { loadFavoriteIds: () => Promise.resolve(), favoriteIds: () => new Set(['cg-1']) },
        },
        { provide: CampgroundsService, useValue: { getByIds: getByIdsSpy } },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;
    await component.ngOnInit();

    expect(getByIdsSpy).toHaveBeenCalledWith(['cg-1']);
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
        { provide: CampgroundsService, useValue: { getByIds: vi.fn() } },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;
    await component.ngOnInit();

    expect(component.campgrounds()).toEqual([]);
  });

  it('delegates note edits to FavoritesService.updateNote', () => {
    const updateNoteSpy = vi.fn();
    TestBed.configureTestingModule({
      imports: [FavoritesComponent],
      providers: [
        { provide: FavoritesService, useValue: { updateNote: updateNoteSpy } },
        { provide: CampgroundsService, useValue: { getByIds: vi.fn() } },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;

    component.onNoteChange({ campgroundId: 'cg-1', note: 'book early' });

    expect(updateNoteSpy).toHaveBeenCalledWith('cg-1', 'book early');
  });
});
