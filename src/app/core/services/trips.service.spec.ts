import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TripsService } from './trips.service';
import { SupabaseService } from './supabase.service';
import { CampgroundsService } from './campgrounds.service';

function createQueryBuilderMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit'].forEach((method) => {
    builder[method] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.then = (resolve: any) => resolve(result);
  return builder;
}

describe('TripsService', () => {
  let service: TripsService;
  let fromSpy: ReturnType<typeof vi.fn>;
  let getByIdsSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromSpy = vi.fn();
    getByIdsSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SupabaseService,
          useValue: { session: () => ({ user: { id: 'user-1' } }), client: { from: fromSpy } },
        },
        { provide: CampgroundsService, useValue: { getByIds: getByIdsSpy } },
      ],
    });
    service = TestBed.inject(TripsService);
  });

  it('loads trips for the signed-in user', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: [{ id: 'trip-1', name: 'Maine Coast', created_at: '2026-08-01T00:00:00Z' }],
        error: null,
      }),
    );

    await service.loadTrips();

    expect(service.trips()).toEqual([
      { id: 'trip-1', name: 'Maine Coast', createdAt: '2026-08-01T00:00:00Z' },
    ]);
  });

  it('returns null from getTrip when no row matches', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    const trip = await service.getTrip('missing');

    expect(trip).toBeNull();
  });

  it('hydrates trip stops and preserves position order regardless of getByIds order', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: [
          { id: 'stop-2', campground_id: 'cg-2', position: 0 },
          { id: 'stop-1', campground_id: 'cg-1', position: 1 },
        ],
        error: null,
      }),
    );
    getByIdsSpy.mockResolvedValue([
      { id: 'cg-1', name: 'A' } as any,
      { id: 'cg-2', name: 'B' } as any,
    ]);

    const stops = await service.getTripStops('trip-1');

    expect(stops).toEqual([
      { stopId: 'stop-2', campground: { id: 'cg-2', name: 'B' } },
      { stopId: 'stop-1', campground: { id: 'cg-1', name: 'A' } },
    ]);
    expect(getByIdsSpy).toHaveBeenCalledWith(['cg-2', 'cg-1']);
  });

  it('creates a trip with ordered stops and returns its id', async () => {
    const tripsBuilder = createQueryBuilderMock({ data: { id: 'trip-9' }, error: null });
    const stopsBuilder = createQueryBuilderMock({ data: null, error: null });
    const loadBuilder = createQueryBuilderMock({ data: [], error: null });
    fromSpy
      .mockReturnValueOnce(tripsBuilder)
      .mockReturnValueOnce(stopsBuilder)
      .mockReturnValueOnce(loadBuilder);

    const tripId = await service.createTrip('Maine Coast', ['cg-1', 'cg-2']);

    expect(tripId).toBe('trip-9');
    expect(stopsBuilder.insert).toHaveBeenCalledWith([
      { trip_id: 'trip-9', campground_id: 'cg-1', position: 0 },
      { trip_id: 'trip-9', campground_id: 'cg-2', position: 1 },
    ]);
  });

  it('scopes getTrip to the signed-in user as well as the trip id', async () => {
    const builder = createQueryBuilderMock({
      data: { id: 'trip-1', name: 'Maine Coast', created_at: '2026-08-01T00:00:00Z' },
      error: null,
    });
    fromSpy.mockReturnValue(builder);

    await service.getTrip('trip-1');

    expect(builder.eq).toHaveBeenCalledWith('id', 'trip-1');
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('renames a trip', async () => {
    service.trips.set([{ id: 'trip-1', name: 'Old Name', createdAt: '2026-08-01T00:00:00Z' }]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [{ id: 'trip-1' }], error: null }));

    await service.renameTrip('trip-1', 'New Name');

    expect(service.trips()[0].name).toBe('New Name');
  });

  it('throws and leaves trips untouched when a rename matches no rows', async () => {
    service.trips.set([{ id: 'trip-1', name: 'Old Name', createdAt: '2026-08-01T00:00:00Z' }]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

    await expect(service.renameTrip('trip-1', 'New Name')).rejects.toThrow(
      'No matching trip to rename',
    );
    expect(service.trips()[0].name).toBe('Old Name');
  });

  it('deletes a trip', async () => {
    service.trips.set([{ id: 'trip-1', name: 'Maine Coast', createdAt: '2026-08-01T00:00:00Z' }]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [{ id: 'trip-1' }], error: null }));

    await service.deleteTrip('trip-1');

    expect(service.trips()).toEqual([]);
  });

  it('throws and leaves trips untouched when a delete matches no rows', async () => {
    service.trips.set([{ id: 'trip-1', name: 'Maine Coast', createdAt: '2026-08-01T00:00:00Z' }]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

    await expect(service.deleteTrip('trip-1')).rejects.toThrow('No matching trip to delete');
    expect(service.trips().length).toBe(1);
  });

  it('adds a stop at the next position', async () => {
    const maxBuilder = createQueryBuilderMock({ data: [{ position: 2 }], error: null });
    const insertBuilder = createQueryBuilderMock({ data: null, error: null });
    fromSpy.mockReturnValueOnce(maxBuilder).mockReturnValueOnce(insertBuilder);

    await service.addStop('trip-1', 'cg-3');

    expect(insertBuilder.insert).toHaveBeenCalledWith({
      trip_id: 'trip-1',
      campground_id: 'cg-3',
      position: 3,
    });
  });

  it('adds the first stop at position 0 when the trip has none yet', async () => {
    const maxBuilder = createQueryBuilderMock({ data: [], error: null });
    const insertBuilder = createQueryBuilderMock({ data: null, error: null });
    fromSpy.mockReturnValueOnce(maxBuilder).mockReturnValueOnce(insertBuilder);

    await service.addStop('trip-1', 'cg-1');

    expect(insertBuilder.insert).toHaveBeenCalledWith({
      trip_id: 'trip-1',
      campground_id: 'cg-1',
      position: 0,
    });
  });

  it('removes a stop by its own id', async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    fromSpy.mockReturnValue(builder);

    await service.removeStop('trip-1', 'stop-5');

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 'stop-5');
  });

  it('reorders stops by rewriting each position', async () => {
    const builder = createQueryBuilderMock({ data: null, error: null });
    fromSpy.mockReturnValue(builder);

    await service.reorderStops('trip-1', ['stop-b', 'stop-a']);

    expect(builder.eq).toHaveBeenCalledWith('id', 'stop-b');
    expect(builder.eq).toHaveBeenCalledWith('id', 'stop-a');
    expect(builder.update).toHaveBeenCalledWith({ position: 0 });
    expect(builder.update).toHaveBeenCalledWith({ position: 1 });
  });

  it('throws when a query errors', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: new Error('boom') }));

    await expect(service.loadTrips()).rejects.toThrow();
  });
});
