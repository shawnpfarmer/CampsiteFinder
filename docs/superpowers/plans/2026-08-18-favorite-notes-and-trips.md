# Favorite Notes & Trip Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user attach a note to a favorited campground, and select a batch of favorites to save as a named, reorderable "trip" with full CRUD (rename, add/remove stops, reorder, delete) and an ordered-route map view.

**Architecture:** Extends the existing `favorites` table with a `note` column and adds two new tables (`trips`, `trip_stops`) behind the same per-user RLS pattern already used throughout this app. A new `TripsService` (mirroring the existing `CampgroundsService`/`FavoritesService` pattern) wraps all trip CRUD. The Favorites page gains an inline note column and a dedicated "Plan a trip" checklist panel (not a mode of the shared table, to avoid touching its existing single-row map-sync selection). Two new routed views (`TripsListComponent`, `TripDetailComponent`) round out the feature, reusing `CampgroundMapComponent` (extended with an ordered/numbered-route mode) but not `CampgroundTableComponent` (the reorderable stop list is its own small table).

**Tech Stack:** Same as the rest of this app — Angular 22 standalone components + signals, PrimeNG (Aura theme), `@supabase/supabase-js`, Leaflet via `@bluehalo/ngx-leaflet`, Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-08-18-favorite-notes-and-trips-design.md`

## Global Constraints

- Angular: standalone components, no SSR.
- PrimeNG: Aura theme preset, PrimeIcons for iconography.
- Supabase Postgres: every table has RLS enabled — no unguarded public writes. Trip/trip-stop ownership is enforced via the same `auth.uid() = user_id` pattern as `favorites`/`profiles`.
- **This scaffold's test runner is Vitest, not Karma/Jasmine.** Every task's test-verification step uses `npx ng test --watch=false` (no `--browsers` flag) and Vitest-native `vi.fn()`/`.mockResolvedValue()`/`.mockRejectedValue()` — never `jasmine.createSpy`/`.and.returnValue`/`expectAsync`, which do not compile in this project (confirmed in earlier tasks: no Jasmine compat layer exists here).
- **All routes are lazy (`loadComponent`), not eager (`component:`).** An earlier task found eager route imports blow the production bundle budget.
- **Delete confirmations use the browser's native `window.confirm()`**, not a new PrimeNG `ConfirmDialog`/`ConfirmationService` module — this project has repeatedly hit PrimeNG API mismatches between docs/plan-authored code and the installed version (`p-sortIcon` → `p-sort-icon`, `p-message`'s `[text]` binding, `pTemplate` being a silent no-op, `pButton`'s nonexistent `label`/`icon` inputs); every new PrimeNG surface in this plan has already been verified against `node_modules/primeng/types/*.d.ts` (see each task's notes) rather than assumed from general PrimeNG knowledge.
- If any PrimeNG tag/binding still produces an `NG8001`/`NG8002` template error despite that verification, do NOT fix it by adding `CUSTOM_ELEMENTS_SCHEMA`/`NO_ERRORS_SCHEMA` — stop and report it; something about the installed version has changed again.
- **No task is considered verified until driven in a real browser** (established after an earlier task's unit tests passed while the UI was actually broken in seven different ways). `npx ng test`/`npx ng build` passing is necessary, not sufficient.
- Out of scope for this feature (see spec for full reasoning): cross-page "trip tray," shared/collaborative trips, trip export/routing/drive-time, rich-text notes, note versioning, duplicate-stop prevention at the database level.

---

## Task 1: Database Schema — Favorite Notes & Trips

**Files:**
- Create: `supabase/migrations/0003_favorite_notes_and_trips.sql`

**Interfaces:**
- Produces: `favorites.note` column (nullable text); tables `trips` (`id, user_id, name, created_at`), `trip_stops` (`id, trip_id, campground_id, position`), both RLS-protected.

- [ ] **Step 1: Confirm the next migration number is still free**

Run: `ls supabase/migrations/`
Expected: highest existing file is `0002_lock_down_handle_new_user.sql` (or later, if other work has landed since this plan was written — if so, name this file the next number up instead of `0003`, and use that number throughout this task).

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0003_favorite_notes_and_trips.sql`:

```sql
alter table favorites add column note text;

create table trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table trips enable row level security;
create policy "users manage own trips" on trips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  campground_id text not null references campgrounds (id) on delete cascade,
  position int not null
);

alter table trip_stops enable row level security;
create policy "users manage own trip stops" on trip_stops
  for all using (
    exists (select 1 from trips where trips.id = trip_stops.trip_id and trips.user_id = auth.uid())
  ) with check (
    exists (select 1 from trips where trips.id = trip_stops.trip_id and trips.user_id = auth.uid())
  );

create index trip_stops_trip_id_idx on trip_stops (trip_id);
```

- [ ] **Step 3: Apply the migration**

Using the `mcp__claude_ai_Supabase__apply_migration` tool, apply the SQL above to project `jpiicvvnipsckkhgjinn` as migration `0003_favorite_notes_and_trips` (adjust the number if Step 1 found a later one already taken).

- [ ] **Step 4: Verify the schema**

Using `mcp__claude_ai_Supabase__execute_sql` on project `jpiicvvnipsckkhgjinn`:

```sql
select column_name from information_schema.columns where table_name = 'favorites' and column_name = 'note';
select tablename, rowsecurity from pg_tables where tablename in ('trips', 'trip_stops');
```

Expected: first query returns one row (`note`); second returns both tables with `rowsecurity = true`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_favorite_notes_and_trips.sql
git commit -m "Add favorites.note column and trips/trip_stops tables"
```

---

## Task 2: FavoritesService — Notes Support

**Files:**
- Modify: `src/app/core/services/favorites.service.ts`
- Modify: `src/app/core/services/favorites.service.spec.ts`

**Interfaces:**
- Consumes: `favorites.note` column (Task 1).
- Produces: `FavoritesService.favoriteNotes: Signal<Map<string, string | null>>`, `FavoritesService.updateNote(campgroundId: string, note: string): Promise<void>` — consumed by `CampgroundTableComponent`'s notes column wiring (Task 6) and directly by the Favorites page (Task 6).

- [ ] **Step 1: Write the failing tests**

Replace `src/app/core/services/favorites.service.spec.ts` with:

```ts
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

  it('removes a campground from favorites when already favorited', async () => {
    service.favoriteIds.set(new Set(['cg-3']));
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.toggleFavorite('cg-3');

    expect(service.favoriteIds().has('cg-3')).toBe(false);
  });

  it('updates a favorite note and stores it locally', async () => {
    fromSpy.mockReturnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.updateNote('cg-1', 'book early');

    expect(service.favoriteNotes().get('cg-1')).toBe('book early');
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `favoriteNotes`/`updateNote` do not exist yet on `FavoritesService`.

- [ ] **Step 3: Implement the service changes**

Replace `src/app/core/services/favorites.service.ts` with:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly supabase = inject(SupabaseService);
  readonly favoriteIds = signal<Set<string>>(new Set());
  readonly favoriteNotes = signal<Map<string, string | null>>(new Map());

  async loadFavoriteIds(): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) {
      this.favoriteIds.set(new Set());
      this.favoriteNotes.set(new Map());
      return;
    }
    const { data, error } = await this.supabase.client
      .from('favorites')
      .select('campground_id, note')
      .eq('user_id', userId);
    if (error) throw error;
    const rows = data ?? [];
    this.favoriteIds.set(new Set(rows.map((row: any) => row.campground_id)));
    this.favoriteNotes.set(new Map(rows.map((row: any) => [row.campground_id, row.note])));
  }

  async toggleFavorite(campgroundId: string): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to favorite a campground');

    const isFavorite = this.favoriteIds().has(campgroundId);
    if (isFavorite) {
      const { error } = await this.supabase.client
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('campground_id', campgroundId);
      if (error) throw error;
      this.favoriteIds.update((ids) => {
        const next = new Set(ids);
        next.delete(campgroundId);
        return next;
      });
    } else {
      const { error } = await this.supabase.client
        .from('favorites')
        .insert({ user_id: userId, campground_id: campgroundId });
      if (error) throw error;
      this.favoriteIds.update((ids) => new Set(ids).add(campgroundId));
    }
  }

  async updateNote(campgroundId: string, note: string): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to note a favorited campground');

    const { error } = await this.supabase.client
      .from('favorites')
      .update({ note })
      .eq('user_id', userId)
      .eq('campground_id', campgroundId);
    if (error) throw error;

    this.favoriteNotes.update((notes) => {
      const next = new Map(notes);
      next.set(campgroundId, note);
      return next;
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/favorites.service.ts src/app/core/services/favorites.service.spec.ts
git commit -m "Add favorite note support to FavoritesService"
```

---

## Task 3: TripsService

**Files:**
- Create: `src/app/core/models/trip.model.ts`
- Create: `src/app/core/services/trips.service.ts`
- Test: `src/app/core/services/trips.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService` (existing), `CampgroundsService.getByIds` (existing), `trips`/`trip_stops` tables (Task 1).
- Produces: `interface Trip { id, name, createdAt }`, `interface TripStop { stopId, campground: Campground }`, `TripsService` with `trips: Signal<Trip[]>`, `loadTrips()`, `createTrip(name, campgroundIds): Promise<string>`, `getTrip(tripId): Promise<Trip | null>`, `getTripStops(tripId): Promise<TripStop[]>`, `renameTrip(tripId, name)`, `deleteTrip(tripId)`, `addStop(tripId, campgroundId)`, `removeStop(tripId, stopId)`, `reorderStops(tripId, orderedStopIds)` — consumed by every Trips UI task (6–9).

**Note:** `removeStop`/`reorderStops` take `trip_stops.id` (`stopId`), not `campgroundId` — a campground may legitimately appear more than once in the same trip (see spec's Out of Scope), so `campground_id` alone can't identify a specific stop.

- [ ] **Step 1: Add the models**

Create `src/app/core/models/trip.model.ts`:

```ts
import { Campground } from './campground.model';

export interface Trip {
  id: string;
  name: string;
  createdAt: string;
}

export interface TripStop {
  stopId: string;
  campground: Campground;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/app/core/services/trips.service.spec.ts`:

```ts
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

  it('renames a trip', async () => {
    service.trips.set([{ id: 'trip-1', name: 'Old Name', createdAt: '2026-08-01T00:00:00Z' }]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    await service.renameTrip('trip-1', 'New Name');

    expect(service.trips()[0].name).toBe('New Name');
  });

  it('deletes a trip', async () => {
    service.trips.set([{ id: 'trip-1', name: 'Maine Coast', createdAt: '2026-08-01T00:00:00Z' }]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    await service.deleteTrip('trip-1');

    expect(service.trips()).toEqual([]);
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

    expect(builder.update).toHaveBeenCalledWith({ position: 0 });
    expect(builder.update).toHaveBeenCalledWith({ position: 1 });
  });

  it('throws when a query errors', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: new Error('boom') }));

    await expect(service.loadTrips()).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `TripsService` does not exist yet.

- [ ] **Step 4: Implement the service**

Create `src/app/core/services/trips.service.ts`:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CampgroundsService } from './campgrounds.service';
import { Trip, TripStop } from '../models/trip.model';

@Injectable({ providedIn: 'root' })
export class TripsService {
  private readonly supabase = inject(SupabaseService);
  private readonly campgroundsService = inject(CampgroundsService);

  readonly trips = signal<Trip[]>([]);

  async loadTrips(): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) {
      this.trips.set([]);
      return;
    }
    const { data, error } = await this.supabase.client
      .from('trips')
      .select('id, name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    this.trips.set(
      (data ?? []).map((row: any) => ({ id: row.id, name: row.name, createdAt: row.created_at })),
    );
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    const { data, error } = await this.supabase.client
      .from('trips')
      .select('id, name, created_at')
      .eq('id', tripId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { id: data.id, name: data.name, createdAt: data.created_at };
  }

  async getTripStops(tripId: string): Promise<TripStop[]> {
    const { data, error } = await this.supabase.client
      .from('trip_stops')
      .select('id, campground_id, position')
      .eq('trip_id', tripId)
      .order('position', { ascending: true });
    if (error) throw error;
    const stopRows = data ?? [];
    if (stopRows.length === 0) return [];

    const campgrounds = await this.campgroundsService.getByIds(
      stopRows.map((s: any) => s.campground_id),
    );
    const byId = new Map(campgrounds.map((c) => [c.id, c]));
    return stopRows
      .map((s: any) => {
        const campground = byId.get(s.campground_id);
        return campground ? { stopId: s.id, campground } : null;
      })
      .filter((s: TripStop | null): s is TripStop => s !== null);
  }

  async createTrip(name: string, campgroundIds: string[]): Promise<string> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to create a trip');

    const { data, error } = await this.supabase.client
      .from('trips')
      .insert({ user_id: userId, name })
      .select('id')
      .single();
    if (error) throw error;

    const tripId = data.id;
    if (campgroundIds.length > 0) {
      const stopRows = campgroundIds.map((campgroundId, index) => ({
        trip_id: tripId,
        campground_id: campgroundId,
        position: index,
      }));
      const { error: stopsError } = await this.supabase.client.from('trip_stops').insert(stopRows);
      if (stopsError) throw stopsError;
    }

    await this.loadTrips();
    return tripId;
  }

  async renameTrip(tripId: string, name: string): Promise<void> {
    const { error } = await this.supabase.client.from('trips').update({ name }).eq('id', tripId);
    if (error) throw error;
    this.trips.update((trips) => trips.map((t) => (t.id === tripId ? { ...t, name } : t)));
  }

  async deleteTrip(tripId: string): Promise<void> {
    const { error } = await this.supabase.client.from('trips').delete().eq('id', tripId);
    if (error) throw error;
    this.trips.update((trips) => trips.filter((t) => t.id !== tripId));
  }

  async addStop(tripId: string, campgroundId: string): Promise<void> {
    const { data, error: maxError } = await this.supabase.client
      .from('trip_stops')
      .select('position')
      .eq('trip_id', tripId)
      .order('position', { ascending: false })
      .limit(1);
    if (maxError) throw maxError;
    const nextPosition = (data && data.length > 0 ? data[0].position : -1) + 1;

    const { error } = await this.supabase.client
      .from('trip_stops')
      .insert({ trip_id: tripId, campground_id: campgroundId, position: nextPosition });
    if (error) throw error;
  }

  async removeStop(tripId: string, stopId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('trip_stops')
      .delete()
      .eq('id', stopId)
      .eq('trip_id', tripId);
    if (error) throw error;
  }

  async reorderStops(tripId: string, orderedStopIds: string[]): Promise<void> {
    for (let i = 0; i < orderedStopIds.length; i++) {
      const { error } = await this.supabase.client
        .from('trip_stops')
        .update({ position: i })
        .eq('id', orderedStopIds[i])
        .eq('trip_id', tripId);
      if (error) throw error;
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/models/trip.model.ts src/app/core/services/trips.service.ts src/app/core/services/trips.service.spec.ts
git commit -m "Add TripsService wrapping trips/trip_stops CRUD"
```

---

## Task 4: CampgroundTableComponent — Notes Column

**Files:**
- Modify: `src/app/features/finder/campground-table/campground-table.component.ts`
- Modify: `src/app/features/finder/campground-table/campground-table.component.spec.ts`

**Interfaces:**
- Produces: new `CampgroundTableComponent` inputs `showNotes: boolean = false`, `notes: Map<string, string | null>`; new output `noteChange: EventEmitter<{ campgroundId: string; note: string }>` — consumed by the Favorites page (Task 6).

This mirrors the existing `showDistance` input exactly: additive, defaults to `false`/off, so `FinderComponent`'s usage (which never sets `showNotes`) is completely unaffected.

- [ ] **Step 1: Write the failing tests**

Replace `src/app/features/finder/campground-table/campground-table.component.spec.ts` with:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CampgroundTableComponent } from './campground-table.component';

describe('CampgroundTableComponent', () => {
  let fixture: ComponentFixture<CampgroundTableComponent>;
  let component: CampgroundTableComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CampgroundTableComponent] });
    fixture = TestBed.createComponent(CampgroundTableComponent);
    component = fixture.componentInstance;
  });

  it('emits selectedChange when a row is selected', () => {
    const campground = { id: '1', name: 'A' } as any;
    let emitted: any;
    component.selectedChange.subscribe((c) => (emitted = c));

    component.onSelectionChange(campground);

    expect(emitted).toBe(campground);
  });

  it('shows the Distance column by default', () => {
    component.campgrounds = [];
    fixture.detectChanges();

    const header = fixture.nativeElement.textContent;
    expect(header).toContain('Distance');
  });

  it('hides the Distance column when showDistance is false', () => {
    component.campgrounds = [];
    component.showDistance = false;
    fixture.detectChanges();

    const header = fixture.nativeElement.textContent;
    expect(header).not.toContain('Distance');
  });

  it('hides the Note column by default', () => {
    component.campgrounds = [];
    fixture.detectChanges();

    const header = fixture.nativeElement.textContent;
    expect(header).not.toContain('Note');
  });

  it('shows a Note column when showNotes is true', () => {
    component.campgrounds = [];
    component.showNotes = true;
    fixture.detectChanges();

    const header = fixture.nativeElement.textContent;
    expect(header).toContain('Note');
  });

  it('seeds noteDrafts from the notes input on change', () => {
    component.notes = new Map([['cg-1', 'great sites']]);

    component.ngOnChanges({ notes: {} as any });

    expect(component.noteDrafts['cg-1']).toBe('great sites');
  });

  it('emits noteChange with the current draft value on blur', () => {
    let emitted: any;
    component.noteChange.subscribe((e) => (emitted = e));
    component.noteDrafts['cg-1'] = 'updated note';

    component.onNoteBlur('cg-1');

    expect(emitted).toEqual({ campgroundId: 'cg-1', note: 'updated note' });
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `showNotes`/`notes`/`noteDrafts`/`onNoteBlur`/`noteChange` do not exist yet.

- [ ] **Step 3: Implement the component changes**

Replace `src/app/features/finder/campground-table/campground-table.component.ts` with:

```ts
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { FavoriteToggleComponent } from '../../../shared/favorite-toggle/favorite-toggle.component';
import { Campground } from '../../../core/models/campground.model';

@Component({
  selector: 'app-campground-table',
  standalone: true,
  imports: [TableModule, DecimalPipe, FormsModule, RouterLink, InputTextModule, FavoriteToggleComponent],
  template: `
    <p-table
      [value]="campgrounds"
      [paginator]="true"
      [rows]="10"
      selectionMode="single"
      [(selection)]="selected"
      (selectionChange)="onSelectionChange($event)"
    >
      <ng-template #header>
        <tr>
          <th pSortableColumn="name">Name <p-sort-icon field="name" /></th>
          <th pSortableColumn="parkCode">Park <p-sort-icon field="parkCode" /></th>
          @if (showDistance) {
            <th pSortableColumn="distanceMeters">Distance <p-sort-icon field="distanceMeters" /></th>
          }
          @if (showNotes) {
            <th>Note</th>
          }
          <th></th>
        </tr>
      </ng-template>
      <ng-template #body let-campground>
        <tr [pSelectableRow]="campground">
          <td><a [routerLink]="['/campground', campground.id]">{{ campground.name }}</a></td>
          <td>{{ campground.parkCode }}</td>
          @if (showDistance) {
            <td>{{ campground.distanceMeters / 1609.34 | number: '1.1-1' }} mi</td>
          }
          @if (showNotes) {
            <td>
              <input
                pInputText
                [(ngModel)]="noteDrafts[campground.id]"
                (blur)="onNoteBlur(campground.id)"
              />
            </td>
          }
          <td><app-favorite-toggle [campgroundId]="campground.id" /></td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class CampgroundTableComponent implements OnChanges {
  @Input({ required: true }) campgrounds: Campground[] = [];
  @Input() selected: Campground | null = null;
  @Input() showDistance = true;
  @Input() showNotes = false;
  @Input() notes: Map<string, string | null> = new Map();
  @Output() selectedChange = new EventEmitter<Campground | null>();
  @Output() noteChange = new EventEmitter<{ campgroundId: string; note: string }>();

  noteDrafts: Record<string, string> = {};

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['notes']) {
      const drafts: Record<string, string> = {};
      this.notes.forEach((note, campgroundId) => {
        drafts[campgroundId] = note ?? '';
      });
      this.noteDrafts = drafts;
    }
  }

  onSelectionChange(campground: Campground): void {
    this.selectedChange.emit(campground);
  }

  onNoteBlur(campgroundId: string): void {
    this.noteChange.emit({ campgroundId, note: this.noteDrafts[campgroundId] ?? '' });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/finder/campground-table/campground-table.component.ts src/app/features/finder/campground-table/campground-table.component.spec.ts
git commit -m "Add opt-in notes column to CampgroundTableComponent"
```

---

## Task 5: CampgroundMapComponent — Ordered Route Mode

**Files:**
- Modify: `src/app/features/finder/campground-map/campground-map.component.ts`
- Modify: `src/app/features/finder/campground-map/campground-map.component.spec.ts`
- Modify: `src/styles.scss`

**Interfaces:**
- Produces: new `CampgroundMapComponent` input `ordered: boolean = false` — when true, renders numbered markers (in `campgrounds` array order) plus a connecting polyline. Consumed by `TripDetailComponent` (Task 9).

**Important:** the numbered-marker style must go in the **global** `src/styles.scss`, not this component's own scoped stylesheet. Leaflet inserts marker DOM nodes directly (outside Angular's template compiler), so Angular's view-encapsulation-scoped CSS never matches them — a rule added to `campground-map.component.scss` would silently do nothing (the same category of gap as an earlier task's `.finder-layout` cosmetic issue). Do not add anything to `campground-map.component.scss` for this.

- [ ] **Step 1: Write the failing tests**

Replace `src/app/features/finder/campground-map/campground-map.component.spec.ts` with:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CampgroundMapComponent } from './campground-map.component';

describe('CampgroundMapComponent', () => {
  let fixture: ComponentFixture<CampgroundMapComponent>;
  let component: CampgroundMapComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CampgroundMapComponent] });
    fixture = TestBed.createComponent(CampgroundMapComponent);
    component = fixture.componentInstance;
  });

  it('creates one marker layer per campground', () => {
    component.campgrounds = [
      { id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any,
      { id: '2', lat: 45.0, lng: -69.0, name: 'B' } as any,
    ];
    component.ngOnChanges({ campgrounds: {} as any });

    expect(component.markerLayers.length).toBe(2);
  });

  it('does not add a route line when ordered is false', () => {
    component.campgrounds = [
      { id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any,
      { id: '2', lat: 45.0, lng: -69.0, name: 'B' } as any,
    ];
    component.ngOnChanges({ campgrounds: {} as any });

    expect(component.markerLayers.length).toBe(2);
  });

  it('numbers markers and adds a connecting route line when ordered is true', () => {
    component.campgrounds = [
      { id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any,
      { id: '2', lat: 45.0, lng: -69.0, name: 'B' } as any,
    ];
    component.ordered = true;
    component.ngOnChanges({ campgrounds: {} as any, ordered: {} as any });

    expect(component.markerLayers.length).toBe(3);
  });

  it('does not add a route line for a single-stop ordered trip', () => {
    component.campgrounds = [{ id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any];
    component.ordered = true;
    component.ngOnChanges({ campgrounds: {} as any, ordered: {} as any });

    expect(component.markerLayers.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `ordered` does not exist yet.

- [ ] **Step 3: Implement the component change**

Replace `src/app/features/finder/campground-map/campground-map.component.ts` with:

```ts
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { LeafletModule } from '@bluehalo/ngx-leaflet';
import * as L from 'leaflet';
import { Campground } from '../../../core/models/campground.model';

// Leaflet's Icon.Default always prepends an auto-detected `imagePath`
// directory to its icon filenames — it reads the computed background-image
// of a `.leaflet-default-icon-path` element (set via leaflet.css) and uses
// that directory. Angular's build hashes the CSS-referenced marker-icon.png
// into /media/, but the shadow image (only referenced from JS, not CSS)
// never gets copied there, so the guessed URL 404s. Setting `imagePath`
// explicitly (matching the `leaflet/dist/images` assets rule in
// angular.json, which serves these at the site root) bypasses that
// detection entirely.
L.Icon.Default.imagePath = '';
L.Icon.Default.mergeOptions({
  iconUrl: 'marker-icon.png',
  iconRetinaUrl: 'marker-icon-2x.png',
  shadowUrl: 'marker-shadow.png',
});

@Component({
  selector: 'app-campground-map',
  standalone: true,
  imports: [LeafletModule],
  template: `
    <div
      class="campground-map"
      leaflet
      [leafletOptions]="mapOptions"
      [leafletLayers]="markerLayers"
      (leafletMapReady)="onMapReady($event)"
    ></div>
  `,
  styleUrl: './campground-map.component.scss',
})
export class CampgroundMapComponent implements OnChanges {
  @Input({ required: true }) campgrounds: Campground[] = [];
  @Input() selectedId: string | null = null;
  @Input() ordered = false;

  private map: L.Map | undefined;

  readonly mapOptions: L.MapOptions = {
    layers: [
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }),
    ],
    zoom: 6,
    center: L.latLng(39.8283, -98.5795),
  };

  markerLayers: L.Layer[] = [];

  onMapReady(map: L.Map): void {
    this.map = map;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['campgrounds'] || changes['ordered']) {
      const markers = this.campgrounds.map((c, index) =>
        L.marker([c.lat, c.lng], this.ordered ? { icon: this.numberedIcon(index + 1) } : {}).bindPopup(
          c.name,
        ),
      );
      if (this.ordered && this.campgrounds.length > 1) {
        const route = L.polyline(this.campgrounds.map((c) => [c.lat, c.lng] as L.LatLngTuple));
        this.markerLayers = [...markers, route];
      } else {
        this.markerLayers = markers;
      }
    }
    if (changes['selectedId'] && this.selectedId && this.map) {
      const selected = this.campgrounds.find((c) => c.id === this.selectedId);
      if (selected) {
        this.map.setView([selected.lat, selected.lng], 12);
      }
    }
  }

  private numberedIcon(n: number): L.DivIcon {
    return L.divIcon({
      className: 'trip-stop-marker',
      html: `<span>${n}</span>`,
      iconSize: [28, 28],
    });
  }
}
```

- [ ] **Step 4: Add the global numbered-marker style**

Append to `src/styles.scss`:

```scss
.trip-stop-marker {
  background: #16a34a;
  color: #fff;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/finder/campground-map/campground-map.component.ts src/app/features/finder/campground-map/campground-map.component.spec.ts src/styles.scss
git commit -m "Add ordered/numbered-route mode to CampgroundMapComponent"
```

---

## Task 6: Favorites Page — Inline Note Editing

**Files:**
- Modify: `src/app/features/favorites/favorites.component.ts`
- Modify: `src/app/features/favorites/favorites.component.html`
- Modify: `src/app/features/favorites/favorites.component.spec.ts`

**Interfaces:**
- Consumes: `FavoritesService.favoriteNotes`/`updateNote` (Task 2), `CampgroundTableComponent`'s `showNotes`/`notes`/`noteChange` (Task 4).

- [ ] **Step 1: Write the failing test**

Replace `src/app/features/favorites/favorites.component.spec.ts` with:

```ts
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
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `onNoteChange` does not exist yet.

- [ ] **Step 3: Implement the component changes**

Replace `src/app/features/favorites/favorites.component.ts` with:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { CampgroundMapComponent } from '../finder/campground-map/campground-map.component';
import { CampgroundTableComponent } from '../finder/campground-table/campground-table.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [CampgroundMapComponent, CampgroundTableComponent],
  templateUrl: './favorites.component.html',
})
export class FavoritesComponent implements OnInit {
  readonly favorites = inject(FavoritesService);
  private readonly campgroundsService = inject(CampgroundsService);

  readonly campgrounds = signal<Campground[]>([]);
  readonly selected = signal<Campground | null>(null);

  async ngOnInit(): Promise<void> {
    await this.favorites.loadFavoriteIds();
    const ids = Array.from(this.favorites.favoriteIds());
    if (ids.length === 0) {
      this.campgrounds.set([]);
      return;
    }
    const results = await this.campgroundsService.getByIds(ids);
    this.campgrounds.set(results);
  }

  onSelectionChange(campground: Campground | null): void {
    this.selected.set(campground);
  }

  onNoteChange(event: { campgroundId: string; note: string }): void {
    this.favorites.updateNote(event.campgroundId, event.note);
  }
}
```

Replace `src/app/features/favorites/favorites.component.html` with:

```html
<div class="finder-layout">
  <app-campground-map [campgrounds]="campgrounds()" [selectedId]="selected()?.id ?? null" />
  <app-campground-table
    [campgrounds]="campgrounds()"
    [selected]="selected()"
    [showDistance]="false"
    [showNotes]="true"
    [notes]="favorites.favoriteNotes()"
    (selectedChange)="onSelectionChange($event)"
    (noteChange)="onNoteChange($event)"
  />
</div>
@if (campgrounds().length === 0) {
  <p>No favorites yet. Star a campground from the Finder to save it here.</p>
}
```

Note: `favorites` changed from `private readonly` to plain `readonly` — the template now reads `favorites.favoriteNotes()` directly, so it must be accessible from the template (same pattern already used by `FavoriteToggleComponent`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/favorites/favorites.component.ts src/app/features/favorites/favorites.component.html src/app/features/favorites/favorites.component.spec.ts
git commit -m "Wire inline note editing into the Favorites page"
```

---

## Task 7: Favorites Page — "Plan a Trip" Panel

**Files:**
- Modify: `src/app/features/favorites/favorites.component.ts`
- Modify: `src/app/features/favorites/favorites.component.html`
- Modify: `src/app/features/favorites/favorites.component.spec.ts`

**Interfaces:**
- Consumes: `TripsService.createTrip` (Task 3).
- Produces: on save, navigates to `/trips/:id` (route added in Task 9 — until then this will 404 if actually clicked in a browser; that's expected and resolved once Task 9 lands the route).

This is the dedicated trip-builder panel (design Approach A): a plain checklist next to — not a mode of — the existing map-synced table, so `CampgroundTableComponent`'s existing single-row selection behavior is untouched.

- [ ] **Step 1: Write the failing tests**

Replace `src/app/features/favorites/favorites.component.spec.ts` with:

```ts
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
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `canSaveTrip`/`toggleSelectedForTrip`/`saveTrip` do not exist yet.

- [ ] **Step 3: Implement the component changes**

Replace `src/app/features/favorites/favorites.component.ts` with:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CampgroundMapComponent } from '../finder/campground-map/campground-map.component';
import { CampgroundTableComponent } from '../finder/campground-table/campground-table.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { TripsService } from '../../core/services/trips.service';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [CampgroundMapComponent, CampgroundTableComponent, FormsModule, ButtonModule, InputTextModule],
  templateUrl: './favorites.component.html',
})
export class FavoritesComponent implements OnInit {
  readonly favorites = inject(FavoritesService);
  private readonly campgroundsService = inject(CampgroundsService);
  private readonly trips = inject(TripsService);
  private readonly router = inject(Router);

  readonly campgrounds = signal<Campground[]>([]);
  readonly selected = signal<Campground | null>(null);
  readonly planningTrip = signal(false);
  readonly selectedForTrip = signal<Set<string>>(new Set());
  tripName = '';

  async ngOnInit(): Promise<void> {
    await this.favorites.loadFavoriteIds();
    const ids = Array.from(this.favorites.favoriteIds());
    if (ids.length === 0) {
      this.campgrounds.set([]);
      return;
    }
    const results = await this.campgroundsService.getByIds(ids);
    this.campgrounds.set(results);
  }

  onSelectionChange(campground: Campground | null): void {
    this.selected.set(campground);
  }

  onNoteChange(event: { campgroundId: string; note: string }): void {
    this.favorites.updateNote(event.campgroundId, event.note);
  }

  togglePlanning(): void {
    this.planningTrip.update((v) => !v);
    this.selectedForTrip.set(new Set());
    this.tripName = '';
  }

  toggleSelectedForTrip(campgroundId: string): void {
    this.selectedForTrip.update((ids) => {
      const next = new Set(ids);
      if (next.has(campgroundId)) {
        next.delete(campgroundId);
      } else {
        next.add(campgroundId);
      }
      return next;
    });
  }

  get canSaveTrip(): boolean {
    return this.tripName.trim().length > 0 && this.selectedForTrip().size > 0;
  }

  async saveTrip(): Promise<void> {
    const tripId = await this.trips.createTrip(this.tripName.trim(), Array.from(this.selectedForTrip()));
    this.router.navigateByUrl(`/trips/${tripId}`);
  }
}
```

Replace `src/app/features/favorites/favorites.component.html` with:

```html
<div class="finder-layout">
  <app-campground-map [campgrounds]="campgrounds()" [selectedId]="selected()?.id ?? null" />
  <app-campground-table
    [campgrounds]="campgrounds()"
    [selected]="selected()"
    [showDistance]="false"
    [showNotes]="true"
    [notes]="favorites.favoriteNotes()"
    (selectedChange)="onSelectionChange($event)"
    (noteChange)="onNoteChange($event)"
  />
</div>
@if (campgrounds().length === 0) {
  <p>No favorites yet. Star a campground from the Finder to save it here.</p>
}

@if (campgrounds().length > 0) {
  <button pButton [text]="true" (click)="togglePlanning()">
    {{ planningTrip() ? 'Cancel' : 'Plan a trip' }}
  </button>
}

@if (planningTrip()) {
  <div class="trip-planner">
    <input pInputText type="text" placeholder="Trip name" [(ngModel)]="tripName" name="tripName" />
    <ul>
      @for (campground of campgrounds(); track campground.id) {
        <li>
          <label>
            <input
              type="checkbox"
              [checked]="selectedForTrip().has(campground.id)"
              (change)="toggleSelectedForTrip(campground.id)"
            />
            {{ campground.name }}
          </label>
        </li>
      }
    </ul>
    <button pButton [disabled]="!canSaveTrip" (click)="saveTrip()">Save Trip</button>
  </div>
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/favorites/favorites.component.ts src/app/features/favorites/favorites.component.html src/app/features/favorites/favorites.component.spec.ts
git commit -m "Add 'Plan a trip' panel to the Favorites page"
```

---

## Task 8: Trips List View + Navigation

**Files:**
- Create: `src/app/features/trips/trips-list.component.ts`
- Create: `src/app/features/trips/trips-list.component.html`
- Modify: `src/app/app.routes.ts`
- Modify: `src/app/app.html`
- Test: `src/app/features/trips/trips-list.component.spec.ts`

**Interfaces:**
- Consumes: `TripsService.trips`/`loadTrips`/`deleteTrip` (Task 3).
- Produces: route `'trips'` → `TripsListComponent` (guarded).

- [ ] **Step 1: Write the failing tests**

Create `src/app/features/trips/trips-list.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TripsListComponent } from './trips-list.component';
import { TripsService } from '../../core/services/trips.service';

describe('TripsListComponent', () => {
  it('loads trips on init', async () => {
    const loadTripsSpy = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [TripsListComponent],
      providers: [{ provide: TripsService, useValue: { trips: () => [], loadTrips: loadTripsSpy } }],
    });

    const component = TestBed.createComponent(TripsListComponent).componentInstance;
    await component.ngOnInit();

    expect(loadTripsSpy).toHaveBeenCalled();
  });

  it('deletes a trip when the user confirms', async () => {
    const deleteTripSpy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [TripsListComponent],
      providers: [
        { provide: TripsService, useValue: { trips: () => [], loadTrips: vi.fn(), deleteTrip: deleteTripSpy } },
      ],
    });

    const component = TestBed.createComponent(TripsListComponent).componentInstance;
    await component.onDelete('trip-1');

    expect(deleteTripSpy).toHaveBeenCalledWith('trip-1');
  });

  it('does not delete when the user cancels the confirm', async () => {
    const deleteTripSpy = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    TestBed.configureTestingModule({
      imports: [TripsListComponent],
      providers: [
        { provide: TripsService, useValue: { trips: () => [], loadTrips: vi.fn(), deleteTrip: deleteTripSpy } },
      ],
    });

    const component = TestBed.createComponent(TripsListComponent).componentInstance;
    await component.onDelete('trip-1');

    expect(deleteTripSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `TripsListComponent` does not exist yet.

- [ ] **Step 3: Implement the component**

Create `src/app/features/trips/trips-list.component.html`:

```html
@if (allTrips().length === 0) {
  <p>No trips yet. Select some favorites on the <a routerLink="/favorites">Favorites</a> page and choose "Plan a trip" to create one.</p>
} @else {
  <p-table [value]="allTrips()">
    <ng-template #header>
      <tr>
        <th>Name</th>
        <th>Created</th>
        <th></th>
      </tr>
    </ng-template>
    <ng-template #body let-trip>
      <tr>
        <td><a [routerLink]="['/trips', trip.id]">{{ trip.name }}</a></td>
        <td>{{ trip.createdAt | date }}</td>
        <td><button pButton [text]="true" (click)="onDelete(trip.id)">Delete</button></td>
      </tr>
    </ng-template>
  </p-table>
}
```

Create `src/app/features/trips/trips-list.component.ts`:

```ts
import { Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TripsService } from '../../core/services/trips.service';

@Component({
  selector: 'app-trips-list',
  standalone: true,
  imports: [TableModule, ButtonModule, DatePipe, RouterLink],
  templateUrl: './trips-list.component.html',
})
export class TripsListComponent implements OnInit {
  private readonly trips = inject(TripsService);

  readonly allTrips = this.trips.trips;

  async ngOnInit(): Promise<void> {
    await this.trips.loadTrips();
  }

  async onDelete(tripId: string): Promise<void> {
    if (!window.confirm('Delete this trip?')) {
      return;
    }
    await this.trips.deleteTrip(tripId);
  }
}
```

- [ ] **Step 4: Wire routing and navigation**

Update `src/app/app.routes.ts` — read the current file first (it has four lazy routes plus an `authGuard` import), then add a fifth route object in the same style:

```ts
{
  path: 'trips',
  loadComponent: () => import('./features/trips/trips-list.component').then((m) => m.TripsListComponent),
  canActivate: [authGuard],
},
```

Update `src/app/app.html` — add a "Trips" link between "Favorites" and the sign-in/sign-out conditional:

```html
<nav class="app-nav">
  <a routerLink="/">Finder</a>
  <a routerLink="/favorites">Favorites</a>
  <a routerLink="/trips">Trips</a>
  @if (supabase.isAuthenticated) {
    <button pButton [text]="true" (click)="onSignOut()">Sign out</button>
  } @else {
    <a routerLink="/login">Sign in</a>
  }
</nav>
<router-outlet />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

Also run: `npx ng build`
Expected: clean build, no new bundle-budget warnings (this route is lazy, same as the others).

- [ ] **Step 6: Commit**

```bash
git add src/app/features/trips/trips-list.component.ts src/app/features/trips/trips-list.component.html src/app/features/trips/trips-list.component.spec.ts src/app/app.routes.ts src/app/app.html
git commit -m "Add Trips list view and nav link"
```

---

## Task 9: Trip Detail View — Reorder, Add/Remove Stops, Rename, Delete

**Files:**
- Create: `src/app/features/trips/trip-detail.component.ts`
- Create: `src/app/features/trips/trip-detail.component.html`
- Modify: `src/app/app.routes.ts`
- Test: `src/app/features/trips/trip-detail.component.spec.ts`

**Interfaces:**
- Consumes: `TripsService` (all methods, Task 3), `FavoritesService` (Task 2/existing), `CampgroundsService.getByIds` (existing), `CampgroundMapComponent`'s `ordered` input (Task 5).
- Produces: route `'trips/:id'` → `TripDetailComponent` (guarded).

**PrimeNG note (verified against this installed version, not assumed):** row reordering uses the `[pReorderableRow]` directive on each `<tr>` (bound to that row's index) plus a `(onRowReorder)` output on `p-table` — both confirmed present in `node_modules/primeng/types/primeng-table.d.ts`. There is no `reorderableRows` boolean input in this version; tagging rows with `[pReorderableRow]` is what enables it. The emitted `TableRowReorderEvent` (`{ dragIndex, dropIndex }`, confirmed via `node_modules/primeng/types/primeng-types-table.d.ts`) is imported from `'primeng/types/table'`, not `'primeng/table'` — the latter does not re-export it. Because this `value` input is a signal (one-way from the parent), do not assume PrimeNG mutates the bound array for you: `onRowReorder` below explicitly recomputes the new order from the event's indices and writes it back to the component's own `stops` signal.

- [ ] **Step 1: Write the failing tests**

Create `src/app/features/trips/trip-detail.component.spec.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `TripDetailComponent` does not exist yet.

- [ ] **Step 3: Implement the component**

Create `src/app/features/trips/trip-detail.component.html`:

```html
@if (notFound()) {
  <p>Trip not found.</p>
} @else if (trip(); as t) {
  <div class="trip-detail">
    @if (editingName()) {
      <input pInputText type="text" [(ngModel)]="nameDraft" name="nameDraft" />
      <button pButton [text]="true" (click)="saveRename()">Save</button>
    } @else {
      <h1>{{ t.name }}</h1>
      <button pButton [text]="true" (click)="startRename()">Rename</button>
    }
    <button pButton [text]="true" (click)="onDeleteTrip()">Delete trip</button>

    <app-campground-map [campgrounds]="stopCampgrounds()" [ordered]="true" [selectedId]="null" />

    <p-table [value]="stops()" (onRowReorder)="onRowReorder($event)">
      <ng-template #header>
        <tr>
          <th style="width: 3rem"></th>
          <th>Name</th>
          <th>Park</th>
          <th></th>
        </tr>
      </ng-template>
      <ng-template #body let-stop let-i="rowIndex">
        <tr [pReorderableRow]="i">
          <td><span class="pi pi-bars" pReorderableRowHandle></span></td>
          <td>{{ stop.campground.name }}</td>
          <td>{{ stop.campground.parkCode }}</td>
          <td><button pButton [text]="true" (click)="onRemoveStop(stop.stopId)">Remove</button></td>
        </tr>
      </ng-template>
    </p-table>

    <div class="add-stop">
      <select [(ngModel)]="addStopCampgroundId" name="addStopCampgroundId">
        <option value="">Choose a favorite to add...</option>
        @for (option of availableToAdd(); track option.id) {
          <option [value]="option.id">{{ option.name }}</option>
        }
      </select>
      <button pButton [text]="true" [disabled]="!addStopCampgroundId" (click)="onAddStop()">Add</button>
    </div>
  </div>
}
```

Create `src/app/features/trips/trip-detail.component.ts`:

```ts
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import type { TableRowReorderEvent } from 'primeng/types/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CampgroundMapComponent } from '../finder/campground-map/campground-map.component';
import { TripsService } from '../../core/services/trips.service';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { Trip, TripStop } from '../../core/models/trip.model';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-trip-detail',
  standalone: true,
  imports: [TableModule, ButtonModule, InputTextModule, FormsModule, CampgroundMapComponent],
  templateUrl: './trip-detail.component.html',
})
export class TripDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tripsService = inject(TripsService);
  private readonly favorites = inject(FavoritesService);
  private readonly campgroundsService = inject(CampgroundsService);

  private tripId = '';

  readonly trip = signal<Trip | null>(null);
  readonly stops = signal<TripStop[]>([]);
  readonly notFound = signal(false);
  readonly editingName = signal(false);
  readonly favoriteCampgrounds = signal<Campground[]>([]);

  readonly stopCampgrounds = computed(() => this.stops().map((s) => s.campground));
  readonly availableToAdd = computed(() => {
    const inTrip = new Set(this.stops().map((s) => s.campground.id));
    return this.favoriteCampgrounds().filter((c) => !inTrip.has(c.id));
  });

  nameDraft = '';
  addStopCampgroundId = '';

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.notFound.set(true);
      return;
    }
    this.tripId = id;

    try {
      const [trip, stops] = await Promise.all([
        this.tripsService.getTrip(id),
        this.tripsService.getTripStops(id),
      ]);
      if (!trip) {
        this.notFound.set(true);
        return;
      }
      this.trip.set(trip);
      this.stops.set(stops);
    } catch {
      this.notFound.set(true);
      return;
    }

    await this.favorites.loadFavoriteIds();
    const favIds = Array.from(this.favorites.favoriteIds());
    this.favoriteCampgrounds.set(favIds.length > 0 ? await this.campgroundsService.getByIds(favIds) : []);
  }

  startRename(): void {
    this.nameDraft = this.trip()?.name ?? '';
    this.editingName.set(true);
  }

  async saveRename(): Promise<void> {
    const name = this.nameDraft.trim();
    if (!name) return;
    await this.tripsService.renameTrip(this.tripId, name);
    this.trip.update((t) => (t ? { ...t, name } : t));
    this.editingName.set(false);
  }

  async onDeleteTrip(): Promise<void> {
    if (!window.confirm('Delete this trip? This cannot be undone.')) return;
    await this.tripsService.deleteTrip(this.tripId);
    this.router.navigateByUrl('/trips');
  }

  async onAddStop(): Promise<void> {
    if (!this.addStopCampgroundId) return;
    await this.tripsService.addStop(this.tripId, this.addStopCampgroundId);
    this.addStopCampgroundId = '';
    this.stops.set(await this.tripsService.getTripStops(this.tripId));
  }

  async onRemoveStop(stopId: string): Promise<void> {
    await this.tripsService.removeStop(this.tripId, stopId);
    this.stops.update((stops) => stops.filter((s) => s.stopId !== stopId));
  }

  async onRowReorder(event: TableRowReorderEvent): Promise<void> {
    if (event.dragIndex == null || event.dropIndex == null) {
      return;
    }
    const reordered = [...this.stops()];
    const [moved] = reordered.splice(event.dragIndex, 1);
    reordered.splice(event.dropIndex, 0, moved);
    this.stops.set(reordered);

    await this.tripsService.reorderStops(
      this.tripId,
      reordered.map((s) => s.stopId),
    );
  }
}
```

- [ ] **Step 4: Wire the route**

Update `src/app/app.routes.ts` — add, alongside the `trips` route added in Task 8:

```ts
{
  path: 'trips/:id',
  loadComponent: () => import('./features/trips/trip-detail.component').then((m) => m.TripDetailComponent),
  canActivate: [authGuard],
},
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

Also run: `npx ng build`
Expected: clean build, no new bundle-budget warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/trips/trip-detail.component.ts src/app/features/trips/trip-detail.component.html src/app/features/trips/trip-detail.component.spec.ts src/app/app.routes.ts
git commit -m "Add trip detail view: reorder, add/remove stops, rename, delete"
```

---

## Self-Review Notes

- **Spec coverage:** note field + inline editing (Tasks 1, 2, 4, 6), trip creation from a favorites checklist (Task 7), independence from favorites once created (Task 3's `trip_stops` has its own identity, never re-derived from `favorites`), full trip CRUD — reorder/add/remove/rename/delete (Task 9), ordered-route map (Task 5, used by Task 9), `window.confirm()` for deletes not a new PrimeNG module (Tasks 8, 9), nav entry (Task 8). All spec sections are covered.
- **Type consistency:** `Trip`/`TripStop` (Task 3) are used identically by Tasks 8 and 9; `CampgroundTableComponent`'s `showNotes`/`notes`/`noteChange` (Task 4) match `FavoritesComponent`'s usage (Tasks 6–7) field-for-field; `TripsService`'s method signatures (Task 3) match every caller in Tasks 7–9 exactly (`createTrip(name, campgroundIds)`, `removeStop`/`reorderStops` taking `stopId`s not `campgroundId`s).
- **PrimeNG surface introduced by this plan** (`pReorderableRow`, `pReorderableRowHandle`, `onRowReorder`, `TableRowReorderEvent`) was verified directly against this project's installed `node_modules/primeng/types/*.d.ts` while writing this plan, not assumed from general PrimeNG familiarity — following the practice this project adopted after several earlier version-mismatch surprises (`p-sortIcon`, `p-message`, `pTemplate`, `pButton`'s `label`/`icon`).
- **Deferred/out of scope, per the spec:** cross-page trip tray, shared/collaborative trips, trip export/routing/drive-time, rich-text notes, note versioning, duplicate-stop database constraint. Not scheduled in any task above.
  - *Update 2026-08-23:* the cross-page trip tray shipped (bounded change, no separate plan doc) — see the "Add to Trip Everywhere Addendum" in the spec.
