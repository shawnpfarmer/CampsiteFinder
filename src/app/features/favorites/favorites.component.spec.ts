import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Router } from '@angular/router';
import { FavoritesComponent } from './favorites.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { TripsService } from '../../core/services/trips.service';

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
        { provide: TripsService, useValue: {} },
        { provide: Router, useValue: {} },
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
        { provide: TripsService, useValue: {} },
        { provide: Router, useValue: {} },
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
        { provide: TripsService, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;

    component.onNoteChange({ campgroundId: 'cg-1', note: 'book early' });

    expect(updateNoteSpy).toHaveBeenCalledWith('cg-1', 'book early');
  });

  it('only allows saving a trip once a name and at least one selection are present', () => {
    TestBed.configureTestingModule({
      imports: [FavoritesComponent],
      providers: [
        { provide: FavoritesService, useValue: { updateNote: vi.fn() } },
        { provide: CampgroundsService, useValue: { getByIds: vi.fn() } },
        { provide: TripsService, useValue: { createTrip: vi.fn() } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;

    expect(component.canSaveTrip).toBe(false);

    component.tripName = 'Maine Coast';
    expect(component.canSaveTrip).toBe(false);

    component.toggleSelectedForTrip('cg-1');
    expect(component.canSaveTrip).toBe(true);
  });

  it('creates a trip from the selected favorites and navigates to it', async () => {
    const createTripSpy = vi.fn().mockResolvedValue('trip-9');
    const navigateSpy = vi.fn();
    TestBed.configureTestingModule({
      imports: [FavoritesComponent],
      providers: [
        { provide: FavoritesService, useValue: { updateNote: vi.fn() } },
        { provide: CampgroundsService, useValue: { getByIds: vi.fn() } },
        { provide: TripsService, useValue: { createTrip: createTripSpy } },
        { provide: Router, useValue: { navigateByUrl: navigateSpy } },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;
    component.tripName = 'Maine Coast';
    component.toggleSelectedForTrip('cg-1');
    component.toggleSelectedForTrip('cg-2');

    await component.saveTrip();

    expect(createTripSpy).toHaveBeenCalledWith('Maine Coast', ['cg-1', 'cg-2']);
    expect(navigateSpy).toHaveBeenCalledWith('/trips/trip-9');
  });
});
