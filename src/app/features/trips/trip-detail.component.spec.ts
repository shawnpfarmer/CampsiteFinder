import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TripDetailComponent } from './trip-detail.component';
import { TripsService } from '../../core/services/trips.service';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';

function activatedRouteWith(id: string) {
  return { snapshot: { paramMap: convertToParamMap({ id }) } };
}

describe('TripDetailComponent', () => {
  function configure(overrides: {
    getTrip?: any; getTripStops?: any; renameTrip?: any; deleteTrip?: any;
    addStop?: any; removeStop?: any; reorderStops?: any;
    loadFavoriteIds?: any; favoriteIds?: any; getByIds?: any; navigateByUrl?: any;
    routeId?: string;
  } = {}) {
    TestBed.configureTestingModule({
      imports: [TripDetailComponent],
      providers: [
        {
          provide: TripsService,
          useValue: {
            getTrip: overrides.getTrip ?? vi.fn().mockResolvedValue({ id: 'trip-1', name: 'Maine Coast', createdAt: '2026-08-01' }),
            getTripStops: overrides.getTripStops ?? vi.fn().mockResolvedValue([]),
            renameTrip: overrides.renameTrip ?? vi.fn().mockResolvedValue(undefined),
            deleteTrip: overrides.deleteTrip ?? vi.fn().mockResolvedValue(undefined),
            addStop: overrides.addStop ?? vi.fn().mockResolvedValue(undefined),
            removeStop: overrides.removeStop ?? vi.fn().mockResolvedValue(undefined),
            reorderStops: overrides.reorderStops ?? vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FavoritesService,
          useValue: {
            loadFavoriteIds: overrides.loadFavoriteIds ?? vi.fn().mockResolvedValue(undefined),
            favoriteIds: overrides.favoriteIds ?? (() => new Set()),
          },
        },
        { provide: CampgroundsService, useValue: { getByIds: overrides.getByIds ?? vi.fn().mockResolvedValue([]) } },
        { provide: Router, useValue: { navigateByUrl: overrides.navigateByUrl ?? vi.fn() } },
        { provide: ActivatedRoute, useValue: activatedRouteWith(overrides.routeId ?? 'trip-1') },
      ],
    });
    return TestBed.createComponent(TripDetailComponent).componentInstance;
  }

  it('loads the trip and its stops on init', async () => {
    const getTripStops = vi.fn().mockResolvedValue([
      { stopId: 'stop-1', campground: { id: 'cg-1', name: 'Blackwoods' } },
    ]);
    const component = configure({ getTripStops });

    await component.ngOnInit();

    expect(component.trip()?.name).toBe('Maine Coast');
    expect(component.stops().length).toBe(1);
    expect(component.notFound()).toBe(false);
  });

  it('sets notFound when the trip does not exist', async () => {
    const component = configure({ getTrip: vi.fn().mockResolvedValue(null) });

    await component.ngOnInit();

    expect(component.notFound()).toBe(true);
  });

  it('sets notFound when loading the trip rejects', async () => {
    const component = configure({ getTrip: vi.fn().mockRejectedValue(new Error('boom')) });

    await component.ngOnInit();

    expect(component.notFound()).toBe(true);
  });

  it('excludes campgrounds already in the trip from availableToAdd', async () => {
    const component = configure({
      getTripStops: vi.fn().mockResolvedValue([
        { stopId: 'stop-1', campground: { id: 'cg-1', name: 'Blackwoods' } },
      ]),
      favoriteIds: () => new Set(['cg-1', 'cg-2']),
      getByIds: vi.fn().mockResolvedValue([
        { id: 'cg-1', name: 'Blackwoods' },
        { id: 'cg-2', name: 'Seawall' },
      ]),
    });

    await component.ngOnInit();

    expect(component.availableToAdd().map((c: any) => c.id)).toEqual(['cg-2']);
  });

  it('reorders stops locally and persists the new order', async () => {
    const reorderStops = vi.fn().mockResolvedValue(undefined);
    const component = configure({
      getTripStops: vi.fn().mockResolvedValue([
        { stopId: 'stop-a', campground: { id: 'cg-1', name: 'A' } },
        { stopId: 'stop-b', campground: { id: 'cg-2', name: 'B' } },
      ]),
      reorderStops,
    });
    await component.ngOnInit();

    // Simulate PrimeNG's Table.onRowDrop, which mutates the bound array
    // in place (via its own reorderArray splice) before emitting onRowReorder.
    const stopsArray = component.stops();
    const [moved] = stopsArray.splice(0, 1);
    stopsArray.splice(1, 0, moved);

    await component.onRowReorder({ dragIndex: 0, dropIndex: 1 });

    expect(component.stops().map((s: any) => s.stopId)).toEqual(['stop-b', 'stop-a']);
    expect(reorderStops).toHaveBeenCalledWith('trip-1', ['stop-b', 'stop-a']);
  });

  it('removes a stop locally and via the service', async () => {
    const removeStop = vi.fn().mockResolvedValue(undefined);
    const component = configure({
      getTripStops: vi.fn().mockResolvedValue([
        { stopId: 'stop-a', campground: { id: 'cg-1', name: 'A' } },
      ]),
      removeStop,
    });
    await component.ngOnInit();

    await component.onRemoveStop('stop-a');

    expect(removeStop).toHaveBeenCalledWith('trip-1', 'stop-a');
    expect(component.stops()).toEqual([]);
  });

  it('renames the trip', async () => {
    const renameTrip = vi.fn().mockResolvedValue(undefined);
    const component = configure({ renameTrip });
    await component.ngOnInit();

    component.startRename();
    component.nameDraft = 'New Name';
    await component.saveRename();

    expect(renameTrip).toHaveBeenCalledWith('trip-1', 'New Name');
    expect(component.trip()?.name).toBe('New Name');
    expect(component.editingName()).toBe(false);
  });

  it('deletes the trip and navigates to the trips list when confirmed', async () => {
    const deleteTrip = vi.fn().mockResolvedValue(undefined);
    const navigateByUrl = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const component = configure({ deleteTrip, navigateByUrl });
    await component.ngOnInit();

    await component.onDeleteTrip();

    expect(deleteTrip).toHaveBeenCalledWith('trip-1');
    expect(navigateByUrl).toHaveBeenCalledWith('/trips');
  });

  it('surfaces an error when renaming fails and stays in edit mode', async () => {
    const component = configure({ renameTrip: vi.fn().mockRejectedValue(new Error('boom')) });
    await component.ngOnInit();

    component.startRename();
    component.nameDraft = 'New Name';
    await component.saveRename();

    expect(component.error()).toBe("Couldn't rename this trip — try again.");
    expect(component.trip()?.name).toBe('Maine Coast');
    expect(component.editingName()).toBe(true);
  });

  it('surfaces an error when deleting fails and does not navigate away', async () => {
    const navigateByUrl = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const component = configure({
      deleteTrip: vi.fn().mockRejectedValue(new Error('boom')),
      navigateByUrl,
    });
    await component.ngOnInit();

    await component.onDeleteTrip();

    expect(component.error()).toBe("Couldn't delete this trip — try again.");
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('surfaces an error when adding a stop fails', async () => {
    const component = configure({ addStop: vi.fn().mockRejectedValue(new Error('boom')) });
    await component.ngOnInit();

    component.addStopCampgroundId = 'cg-2';
    await component.onAddStop();

    expect(component.error()).toBe("Couldn't add that stop — try again.");
  });

  it('surfaces an error when removing a stop fails and keeps the stop listed', async () => {
    const component = configure({
      getTripStops: vi.fn().mockResolvedValue([
        { stopId: 'stop-a', campground: { id: 'cg-1', name: 'A' } },
      ]),
      removeStop: vi.fn().mockRejectedValue(new Error('boom')),
    });
    await component.ngOnInit();

    await component.onRemoveStop('stop-a');

    expect(component.error()).toBe("Couldn't remove that stop — try again.");
    expect(component.stops().length).toBe(1);
  });

  it('has no stop expanded initially', () => {
    const component = configure();

    expect(component.expandedStopId).toBeNull();
  });

  it('expands a stop when its name is toggled', async () => {
    const component = configure({
      getTripStops: vi.fn().mockResolvedValue([
        { stopId: 'stop-1', campground: { id: 'cg-1', name: 'A' } },
      ]),
    });
    await component.ngOnInit();

    component.toggleExpanded('stop-1');

    expect(component.expandedStopId).toBe('stop-1');
  });

  it('collapses an expanded stop when toggled again', async () => {
    const component = configure();
    component.toggleExpanded('stop-1');

    component.toggleExpanded('stop-1');

    expect(component.expandedStopId).toBeNull();
  });

  it('only expands one stop at a time', async () => {
    const component = configure();
    component.toggleExpanded('stop-1');

    component.toggleExpanded('stop-2');

    expect(component.expandedStopId).toBe('stop-2');
  });

  it('surfaces an error and resyncs from the server when reordering fails', async () => {
    const serverOrder = [
      { stopId: 'stop-a', campground: { id: 'cg-1', name: 'A' } },
      { stopId: 'stop-b', campground: { id: 'cg-2', name: 'B' } },
    ];
    // Fresh copy per call — the test mutates the returned array the way
    // PrimeNG's in-place row splice does.
    const getTripStops = vi.fn().mockImplementation(() => Promise.resolve([...serverOrder]));
    const component = configure({
      getTripStops,
      reorderStops: vi.fn().mockRejectedValue(new Error('boom')),
    });
    await component.ngOnInit();

    // PrimeNG has already spliced the bound array into the new on-screen order.
    const stopsArray = component.stops();
    const [moved] = stopsArray.splice(0, 1);
    stopsArray.splice(1, 0, moved);

    await component.onRowReorder({ dragIndex: 0, dropIndex: 1 });

    expect(component.error()).toBe("Couldn't reorder stops — try again.");
    expect(component.stops().map((s: any) => s.stopId)).toEqual(['stop-a', 'stop-b']);
  });
});
