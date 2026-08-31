# Finder Distance Radius Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users bound the Finder's results by a distance radius (25/50/100/250 mi, or no limit) instead of always taking the fixed nearest-50, composing with the existing agency filter.

**Architecture:** `nearest_campgrounds` gains an optional `max_distance_m` param — `null` preserves today's nearest-50-capped behavior exactly; when set, the row-count cap drops and every campground within that radius is returned, filtered via PostGIS's `st_dwithin`. `get_campgrounds_by_ids` is untouched — it's an ID lookup, not a "nearest" query. The frontend gains a `p-select` dropdown (miles, converted to meters for the RPC call) next to the existing agency multiselect, and the shared reload method (currently agency-specific) is renamed to reflect that it now handles multiple filter types.

**Tech Stack:** Same as the rest of this app — Angular 22 standalone components + signals, PrimeNG 22 (`p-select`, matching `admin.component.html`'s existing usage), `@supabase/supabase-js`, Vitest for Angular tests, Supabase Postgres/PostGIS for the RPC.

**Spec:** `docs/superpowers/specs/2026-08-30-campground-filters-design.md` (Distance Radius Filter section; this plan does not cover the Amenities or Fees sections of that spec — those are a separate plan).

## Decisions Made While Planning

- **Radius filtering mechanism:** `st_dwithin(c.location, <point>::geography, max_distance_m)` rather than thresholding the already-computed `distance_m` column, since `st_dwithin` is PostGIS's idiomatic radius predicate and can use a spatial index on `location` if one exists — same `c.location`/`st_setsrid(st_point(...))` expression already used elsewhere in this function, no new pattern introduced.
- **Dropping the cap:** `limit (case when max_distance_m is not null then null else result_limit end)` — Postgres's `LIMIT NULL` means "no limit." This keeps the single existing `limit` clause rather than branching into two separate queries.
- **Units:** the UI works in miles (matches how a US-focused camping app's users think); the component converts to meters (`1 mile = 1609.34 meters`) before calling the service, so the RPC and database stay in metric like the rest of this schema (`st_distance`/`st_dwithin` already operate in meters via `geography`).
- **Method rename:** `FinderComponent.onAgencyFilterChange()` becomes `onFilterChange()` since it now reloads on both agency and radius changes, not just agency. This touches the component, its spec, and the template's `(onChange)` binding — all three must be updated together in Task 3, not left inconsistent.
- **Explicit param passing:** matching this codebase's existing convention (e.g. `agency_filter: agencies ?? null` is always sent, never omitted), `getNearest` always sends `max_distance_m` explicitly (`null` when no radius is selected) rather than relying on the RPC's default.

## Global Constraints

- Additive only — do not modify `get_campgrounds_by_ids` or `nps-sync`/`ridb-sync` in this plan; this plan touches only `nearest_campgrounds` and the Finder's frontend.
- Default behavior (no radius selected) must be pixel-for-pixel identical to today's nearest-50 behavior — this is a filter users opt into, not a change to the default experience.
- Supabase project id for all MCP tool calls: `jpiicvvnipsckkhgjinn`.
- No RLS policy changes needed — this plan adds a function parameter and a UI control, not new tables or columns.

## File Structure

- `supabase/migrations/0011_nearest_campgrounds_radius.sql` — new: drop/recreate `nearest_campgrounds` with `max_distance_m`.
- `src/app/core/services/campgrounds.service.ts` — modify: `getNearest` gains `maxDistanceMeters?: number` param.
- `src/app/core/services/campgrounds.service.spec.ts` — modify.
- `src/app/features/finder/finder.component.ts` — modify: radius state, rename reload method, mile→meter conversion.
- `src/app/features/finder/finder.component.html` — modify: radius `p-select`, updated `(onChange)` binding.
- `src/app/features/finder/finder.component.spec.ts` — modify.

---

## Task 1: Migration — `nearest_campgrounds` gains `max_distance_m`

**Files:**
- Create: `supabase/migrations/0011_nearest_campgrounds_radius.sql`

**Interfaces:**
- Consumes: nothing new (extends the existing `nearest_campgrounds` from migration `0010_ridb_agency_filter_rpcs.sql`).
- Produces: `nearest_campgrounds(user_lat double precision, user_lng double precision, result_limit int default 50, agency_filter text[] default null, max_distance_m double precision default null)`, same return columns as today (unchanged). Consumed by Task 2 (`CampgroundsService`).

- [ ] **Step 1: Confirm the next migration number is still free**

Run: `ls supabase/migrations/`
Expected: highest existing file is `0010_ridb_agency_filter_rpcs.sql` — `0011` is free. If not, renumber this task's file to the next free number.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0011_nearest_campgrounds_radius.sql`:

```sql
drop function nearest_campgrounds(double precision, double precision, int, text[]);

create function public.nearest_campgrounds(
  user_lat double precision,
  user_lng double precision,
  result_limit int default 50,
  agency_filter text[] default null,
  max_distance_m double precision default null
)
returns table (
  id text,
  park_code text,
  name text,
  description text,
  lat double precision,
  lng double precision,
  agency text,
  amenities jsonb,
  fees jsonb,
  reservation_url text,
  directions_url text,
  images jsonb,
  contact jsonb,
  distance_m double precision
)
language sql
stable
as $$
  select
    c.id, c.park_code, c.name, c.description,
    st_y(c.location::geometry) as lat,
    st_x(c.location::geometry) as lng,
    c.agency, c.amenities, c.fees, c.reservation_url, c.directions_url,
    c.images, c.contact,
    st_distance(c.location, st_setsrid(st_point(user_lng, user_lat), 4326)::geography) as distance_m
  from public.campgrounds c
  where (agency_filter is null or c.agency = any(agency_filter))
    and (
      max_distance_m is null
      or st_dwithin(c.location, st_setsrid(st_point(user_lng, user_lat), 4326)::geography, max_distance_m)
    )
  order by c.location <-> st_setsrid(st_point(user_lng, user_lat), 4326)::geography
  limit (case when max_distance_m is not null then null else result_limit end);
$$;

grant execute on function public.nearest_campgrounds(double precision, double precision, int, text[], double precision) to anon, authenticated;
```

- [ ] **Step 3: Apply the migration**

Using `mcp__claude_ai_Supabase__apply_migration`, apply the SQL above to project `jpiicvvnipsckkhgjinn` as migration `0011_nearest_campgrounds_radius` (adjust the number if Step 1 found a later one already taken).

- [ ] **Step 4: Verify the RPC change — default behavior is unchanged**

Using `mcp__claude_ai_Supabase__execute_sql` against project `jpiicvvnipsckkhgjinn`, run:

```sql
select count(*) from nearest_campgrounds(44.3, -68.2, 50, null, null);
```

Expected: same row count as calling the function without `max_distance_m` did before this migration (up to 50 rows, whatever's nearest to that coordinate) — confirms `max_distance_m => null` doesn't change default behavior.

- [ ] **Step 5: Verify the radius filter actually bounds results**

Using `mcp__claude_ai_Supabase__execute_sql` against project `jpiicvvnipsckkhgjinn`, run:

```sql
select count(*), max(distance_m) from nearest_campgrounds(44.9, -93.2, 50, null, 50000);
select count(*) from nearest_campgrounds(44.9, -93.2, 50, null, null);
```

Expected: the first query's `max(distance_m)` is `<= 50000` (50km radius) and its row count is *not* capped at 50 if more than 50 campgrounds exist within 50km of that Minneapolis-area coordinate (compare against the second query's count, which stays capped at 50). If the first query happens to return fewer than 50 rows regardless, that's fine too — the test that matters is `max(distance_m) <= 50000`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0011_nearest_campgrounds_radius.sql
git commit -m "Add max_distance_m radius param to nearest_campgrounds"
```

---

## Task 2: `CampgroundsService.getNearest` — forward the radius

**Files:**
- Modify: `src/app/core/services/campgrounds.service.ts`
- Test: `src/app/core/services/campgrounds.service.spec.ts`

**Interfaces:**
- Consumes: `nearest_campgrounds`'s new `max_distance_m` param (Task 1).
- Produces: `CampgroundsService.getNearest(coords: Coordinates, limit?: number, agencies?: string[], maxDistanceMeters?: number): Promise<Campground[]>`. Consumed by Task 3 (`FinderComponent`).

- [ ] **Step 1: Update the failing tests first**

Edit `src/app/core/services/campgrounds.service.spec.ts` — the two existing tests that assert `getNearest`'s RPC call args need `max_distance_m: null` added to their expected object (since the RPC now always receives that key). Update `'maps RPC rows to Campground objects'`:

```typescript
  it('maps RPC rows to Campground objects', async () => {
    rpcSpy.mockResolvedValue({
      data: [{
        id: 'abc', park_code: 'acad', name: 'Blackwoods', description: 'desc',
        lat: 44.31, lng: -68.2, agency: 'NPS', amenities: {}, fees: [], reservation_url: 'https://x',
        directions_url: 'https://y', images: [], contact: {}, distance_m: 1200,
      }],
      error: null,
    });

    const result = await service.getNearest({ lat: 44.3, lng: -68.1 });

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: null, max_distance_m: null,
    });
    expect(result[0].name).toBe('Blackwoods');
    expect(result[0].agency).toBe('NPS');
    expect(result[0].distanceMeters).toBe(1200);
  });
```

Update `'forwards an agency filter to the RPC'`:

```typescript
  it('forwards an agency filter to the RPC', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });

    await service.getNearest({ lat: 44.3, lng: -68.1 }, 50, ['USFS', 'BLM']);

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: ['USFS', 'BLM'], max_distance_m: null,
    });
  });
```

Add a new test immediately after it:

```typescript
  it('forwards a max distance filter to the RPC', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });

    await service.getNearest({ lat: 44.3, lng: -68.1 }, 50, undefined, 80467);

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: null, max_distance_m: 80467,
    });
  });
```

Leave every other test in the file (the `getByIds` tests, `searchByName` tests, error-path tests) unchanged — `get_campgrounds_by_ids` is not touched by this plan.

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `npx ng test --watch=false`
Expected: FAIL on the three tests just added/edited — `getNearest` doesn't send `max_distance_m` yet.

- [ ] **Step 3: Update the implementation**

Edit `src/app/core/services/campgrounds.service.ts` — change only the `getNearest` method (leave `getByIds` and `searchByName` untouched):

```typescript
  async getNearest(
    coords: Coordinates,
    limit = 50,
    agencies?: string[],
    maxDistanceMeters?: number,
  ): Promise<Campground[]> {
    const { data, error } = await this.supabase.client.rpc('nearest_campgrounds', {
      user_lat: coords.lat,
      user_lng: coords.lng,
      result_limit: limit,
      agency_filter: agencies ?? null,
      max_distance_m: maxDistanceMeters ?? null,
    });

    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      id: row.id,
      parkCode: row.park_code,
      name: row.name,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      agency: row.agency,
      amenities: row.amenities ?? {},
      fees: row.fees ?? [],
      reservationUrl: row.reservation_url,
      directionsUrl: row.directions_url,
      images: row.images ?? [],
      contact: row.contact,
      distanceMeters: row.distance_m,
    }));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS — all `CampgroundsService` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/campgrounds.service.ts src/app/core/services/campgrounds.service.spec.ts
git commit -m "Forward a max-distance filter from CampgroundsService.getNearest"
```

---

## Task 3: Radius dropdown in the Finder view

**Files:**
- Modify: `src/app/features/finder/finder.component.ts`
- Modify: `src/app/features/finder/finder.component.html`
- Test: `src/app/features/finder/finder.component.spec.ts`

**Interfaces:**
- Consumes: `CampgroundsService.getNearest(coords, limit?, agencies?, maxDistanceMeters?)` (Task 2).
- Produces: `FinderComponent.RADIUS_OPTIONS: { label: string; value: number | null }[]`, `FinderComponent.selectedRadiusMiles: number | null`, `FinderComponent.onFilterChange(): Promise<void>` (renamed from `onAgencyFilterChange`).

- [ ] **Step 1: Write the failing tests first**

Edit `src/app/features/finder/finder.component.spec.ts` — rename every existing call site of `onAgencyFilterChange` to `onFilterChange` (there are two: the "reloads with the selected agencies..." test and the "does not reload on filter change..." test):

```typescript
  it('reloads with the selected agencies and the last-used coordinates when the filter changes', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.selectedAgencies = ['USFS'];
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, ['USFS'], undefined,
    );
  });

  it('does not reload on filter change before any coordinates have been resolved', async () => {
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).not.toHaveBeenCalled();
  });
```

Add two new tests immediately after them:

```typescript
  it('defaults to no distance limit', () => {
    expect(component.selectedRadiusMiles).toBeNull();
  });

  it('converts the selected radius from miles to meters and reloads', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.selectedRadiusMiles = 50;
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, 80467,
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `onFilterChange`/`selectedRadiusMiles`/`RADIUS_OPTIONS` don't exist yet (the renamed-call tests fail because `onFilterChange` isn't defined).

- [ ] **Step 3: Update the component**

Edit `src/app/features/finder/finder.component.ts`:

```typescript
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { CampgroundMapComponent } from './campground-map/campground-map.component';
import { CampgroundTableComponent } from './campground-table/campground-table.component';
import { GeolocationService, Coordinates } from '../../core/services/geolocation.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { Campground } from '../../core/models/campground.model';

const METERS_PER_MILE = 1609.34;

@Component({
  selector: 'app-finder',
  standalone: true,
  imports: [
    CampgroundMapComponent,
    CampgroundTableComponent,
    MessageModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
  ],
  templateUrl: './finder.component.html',
  styleUrl: './finder.component.scss',
})
export class FinderComponent implements OnInit {
  readonly campgrounds = signal<Campground[]>([]);
  readonly selected = signal<Campground | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly ALL_AGENCIES = ['NPS', 'USFS', 'BLM', 'USACE', 'FWS'];
  selectedAgencies: string[] = [...this.ALL_AGENCIES];

  readonly RADIUS_OPTIONS: { label: string; value: number | null }[] = [
    { label: '25 mi', value: 25 },
    { label: '50 mi', value: 50 },
    { label: '100 mi', value: 100 },
    { label: '250 mi', value: 250 },
    { label: 'No limit', value: null },
  ];
  selectedRadiusMiles: number | null = null;

  manualLat: number | null = null;
  manualLng: number | null = null;

  private lastCoords: Coordinates | null = null;

  constructor(
    private readonly geolocation: GeolocationService,
    private readonly campgroundsService: CampgroundsService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadNearest();
  }

  async loadNearest(coords?: Coordinates): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const location = coords ?? (await this.geolocation.getCurrentPosition());
      this.lastCoords = location;
      const maxDistanceMeters =
        this.selectedRadiusMiles != null ? this.selectedRadiusMiles * METERS_PER_MILE : undefined;
      const results = await this.campgroundsService.getNearest(
        location,
        50,
        this.selectedAgencies,
        maxDistanceMeters,
      );
      this.campgrounds.set(results);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Unable to load nearby campgrounds.');
    } finally {
      this.loading.set(false);
    }
  }

  onManualSubmit(): void {
    if (this.manualLat != null && this.manualLng != null) {
      this.loadNearest({ lat: this.manualLat, lng: this.manualLng });
    }
  }

  onFilterChange(): Promise<void> {
    return this.lastCoords ? this.loadNearest(this.lastCoords) : Promise.resolve();
  }

  onSelectionChange(campground: Campground | null): void {
    this.selected.set(campground);
  }
}
```

- [ ] **Step 4: Add the radius control to the template**

Edit `src/app/features/finder/finder.component.html` — add the `p-select` inside the existing `.agency-filter` div, and update the multiselect's `(onChange)` binding to call the renamed method:

```html
<div class="finder">
  @if (loading()) {
    <p-message severity="info">Finding campgrounds near you...</p-message>
  }

  @if (error()) {
    <p-message severity="warn">{{ error() }}</p-message>
    <form class="manual-location" (ngSubmit)="onManualSubmit()">
      <input pInputText type="number" step="any" placeholder="Latitude" [(ngModel)]="manualLat" name="manualLat" required />
      <input pInputText type="number" step="any" placeholder="Longitude" [(ngModel)]="manualLng" name="manualLng" required />
      <button pButton type="submit">Search this location</button>
    </form>
  }

  @if (!error()) {
    <div class="agency-filter">
      <p-multiselect
        [options]="ALL_AGENCIES"
        [(ngModel)]="selectedAgencies"
        (onChange)="onFilterChange()"
        placeholder="Filter by agency"
        name="agencyFilter"
      />
      <p-select
        [options]="RADIUS_OPTIONS"
        [(ngModel)]="selectedRadiusMiles"
        optionLabel="label"
        optionValue="value"
        (onChange)="onFilterChange()"
        placeholder="Distance"
        name="radiusFilter"
      />
    </div>
  }

  @if (!loading() && !error()) {
    <div class="finder-layout">
      <app-campground-map [campgrounds]="campgrounds()" [selectedId]="selected()?.id ?? null" />
      <app-campground-table
        [campgrounds]="campgrounds()"
        [selected]="selected()"
        (selectedChange)="onSelectionChange($event)"
      />
    </div>
  }
</div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS — all `FinderComponent` tests green, including the two new radius tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/finder/finder.component.ts src/app/features/finder/finder.component.html src/app/features/finder/finder.component.spec.ts
git commit -m "Add distance radius filter to the Finder view"
```

---

## Task 4: Final Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite and build**

```bash
npx ng test --watch=false
npx ng build
```

Expected: all PASS, build succeeds with no new errors (the pre-existing bundle-size and leaflet-CJS warnings are unrelated to this plan and expected to remain).

- [ ] **Step 2: Manual end-to-end pass in the browser**

Run `npx ng serve`, open the Finder view.

1. Confirm a "Distance" dropdown appears next to the agency multiselect, defaulting to "No limit".
2. Confirm the initial result set (no radius selected) looks identical to before this plan — same campgrounds, same count.
3. Select "50 mi" — confirm the map/table update, and that every visible result is plausibly within 50 miles of your location (spot-check the Distance column if the table shows one).
4. Select "No limit" again — confirm results return to the original unfiltered set.
5. Combine an agency filter (e.g. "USACE" only) with a radius (e.g. "250 mi") — confirm both constraints apply together.
6. Check the browser console for errors at every step above.

- [ ] **Step 3: Report results**

Confirm all steps above pass with no console errors before considering this plan complete. If any step fails, treat it as a bug against the specific task that introduced it, not a new task.
