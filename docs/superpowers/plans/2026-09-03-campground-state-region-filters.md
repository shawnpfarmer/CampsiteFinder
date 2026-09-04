# Campground State & Region Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users filter the Finder page's campgrounds by state and by region (Northeast/Midwest/South/West), backed by a new `state` column populated at ingest time by both sync Edge Functions.

**Architecture:** Add a nullable `state` column to `campgrounds`, populate it in `ridb-sync`/`nps-sync`'s existing transforms from address data those APIs already return (no new API calls), add a `state_filter` param to the `nearest_campgrounds` RPC (mirroring the existing `agency_filter`), and wire a State MultiSelect + a Region MultiSelect into `FinderComponent` the same way `selectedAgencies` already works. Region is a client-side-only convenience: picking regions recomputes `selectedStates` from a static state→region table — no `region` column, no RPC changes for region.

**Tech Stack:** Angular 22 standalone components + signals, PrimeNG 22, `@supabase/supabase-js`, Postgres/PostGIS via Supabase, Deno (Edge Functions), Vitest for Angular tests, `deno test` for Edge Function tests.

**Spec:** [docs/superpowers/specs/2026-09-03-campground-state-region-filters-design.md](../specs/2026-09-03-campground-state-region-filters-design.md)

## Global Constraints

- `state` is nullable with no default — an unresolvable address must yield `null`, never a placeholder, so it simply won't match an active state filter (same null-means-unmatched behavior as every other optional filter in this codebase).
- Follow the existing migration convention exactly: `drop function ...; create function ...` with the new signature, then re-`grant execute ... to anon, authenticated`.
- Do not add a `states` filter parameter to `get_campgrounds_by_ids` / `CampgroundsService.getByIds` — no current caller needs it (favorites/trip-detail look up known ids). It still gains `state` in its returned columns, purely so `Campground.state` is populated consistently regardless of which RPC produced the row.
- The exact RIDB (`AddressStateCode`) and NPS (`stateCode`) field names below are this plan's best-recollection of each API's schema, not verified against a live response. Parse defensively — a missing/renamed field must degrade to `state: null`, never throw — matching the existing "unverified against a live API" comment style already in `ridb-sync/transform.ts`.

---

### Task 1: `state` column migration

**Files:**
- Create: `supabase/migrations/0012_campground_state.sql`

**Interfaces:**
- Produces: a nullable `state text` column and `campgrounds_state_idx` index on `public.campgrounds`, which Tasks 2-5 depend on.

- [ ] **Step 1: Write the migration**

```sql
alter table public.campgrounds add column state text;
create index campgrounds_state_idx on public.campgrounds (state);
```

- [ ] **Step 2: Apply it to the local/dev Supabase project and confirm it runs cleanly**

Run: `supabase db push` (or your project's usual migration-apply command)
Expected: migration `0012_campground_state` applies with no error; `select state from campgrounds limit 1;` returns `null` for existing rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0012_campground_state.sql
git commit -m "Add nullable state column to campgrounds"
```

---

### Task 2: Parse state in `ridb-sync`

**Files:**
- Modify: `supabase/functions/ridb-sync/transform.ts`
- Test: `supabase/functions/ridb-sync/transform.test.ts`

**Interfaces:**
- Consumes: `state text` column from Task 1 (only relevant at deploy time; this task's tests don't touch the DB).
- Produces: `CampgroundRow.state: string | null`, which Task 4's `CampgroundsService` mapping assumes is present on every RIDB-sourced row once deployed.

- [ ] **Step 1: Write the failing tests**

Add to `supabase/functions/ridb-sync/transform.test.ts`:

```ts
Deno.test("toCampgroundRow reads state from the Physical address entry", () => {
  const facility = {
    FacilityID: "10",
    FacilityName: "Physical Address Campground",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
    FACILITYADDRESS: [
      { FacilityAddressType: "Mailing", AddressStateCode: "DC" },
      { FacilityAddressType: "Physical", AddressStateCode: "WI" },
    ],
  };

  const row = toCampgroundRow(facility as any);

  assertEquals(row?.state, "WI");
});

Deno.test("toCampgroundRow falls back to the first address when none is typed Physical", () => {
  const facility = {
    FacilityID: "11",
    FacilityName: "Mailing Only Campground",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
    FACILITYADDRESS: [{ FacilityAddressType: "Mailing", AddressStateCode: "CO" }],
  };

  const row = toCampgroundRow(facility as any);

  assertEquals(row?.state, "CO");
});

Deno.test("toCampgroundRow sets state to null when no address is present", () => {
  const facility = {
    FacilityID: "12",
    FacilityName: "No Address Campground",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
  };

  const row = toCampgroundRow(facility as any);

  assertEquals(row?.state, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ridb-sync/transform.test.ts`
Expected: FAIL — `row?.state` is `undefined`, not `"WI"`/`"CO"`/`null` (property doesn't exist yet).

- [ ] **Step 3: Implement**

In `supabase/functions/ridb-sync/transform.ts`, add the address type and parsing function, and wire `state` into the returned row:

```ts
interface RidbAddressRecord {
  FacilityAddressType?: string;
  AddressStateCode?: string;
}

export interface RidbFacilityRecord {
  FacilityID: string;
  FacilityName: string;
  FacilityDescription?: string;
  FacilityLatitude: number | null;
  FacilityLongitude: number | null;
  FacilityReservationURL?: string;
  FacilityDirections?: string;
  FacilityPhone?: string;
  FacilityEmail?: string;
  FacilityTypeDescription?: string;
  ORGANIZATION?: RidbOrganization[];
  FACILITYADDRESS?: RidbAddressRecord[];
}

// RIDB's field names here are this codebase's best recollection of its
// schema, unverified against a live response (see plan's Task notes) — a
// missing/renamed field must degrade to null, never throw.
function resolveState(addresses: RidbAddressRecord[] | undefined): string | null {
  if (!addresses || addresses.length === 0) return null;
  const physical = addresses.find((a) => a.FacilityAddressType === "Physical");
  return (physical ?? addresses[0]).AddressStateCode ?? null;
}
```

Add `state: null` to the existing `CampgroundRow` interface as `state: string | null`, and in `toCampgroundRow`'s return object add:

```ts
    state: resolveState(facility.FACILITYADDRESS),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ridb-sync/transform.test.ts`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ridb-sync/transform.ts supabase/functions/ridb-sync/transform.test.ts
git commit -m "Parse state from RIDB facility address in ridb-sync"
```

---

### Task 3: Parse state in `nps-sync`

**Files:**
- Modify: `supabase/functions/nps-sync/transform.ts`
- Test: `supabase/functions/nps-sync/transform.test.ts`

**Interfaces:**
- Consumes: `state text` column from Task 1.
- Produces: `CampgroundRow.state: string | null` for NPS-sourced rows, same shape as Task 2's RIDB output.

- [ ] **Step 1: Write the failing tests**

Add to `supabase/functions/nps-sync/transform.test.ts`:

```ts
Deno.test("toCampgroundRow reads state from the Physical address entry", () => {
  const record = {
    id: "phys1",
    parkCode: "acad",
    name: "Physical Address Campground",
    description: "",
    latitude: "44.3106",
    longitude: "-68.2044",
    amenities: {},
    fees: [],
    reservationUrl: "",
    directionsUrl: "",
    images: [],
    contacts: {},
    addresses: [
      { type: "Mailing", stateCode: "DC" },
      { type: "Physical", stateCode: "ME" },
    ],
  };

  const row = toCampgroundRow(record as any);

  assertEquals(row?.state, "ME");
});

Deno.test("toCampgroundRow falls back to the first address when none is typed Physical", () => {
  const record = {
    id: "mail1",
    parkCode: "acad",
    name: "Mailing Only Campground",
    description: "",
    latitude: "44.3106",
    longitude: "-68.2044",
    amenities: {},
    fees: [],
    reservationUrl: "",
    directionsUrl: "",
    images: [],
    contacts: {},
    addresses: [{ type: "Mailing", stateCode: "ME" }],
  };

  const row = toCampgroundRow(record as any);

  assertEquals(row?.state, "ME");
});

Deno.test("toCampgroundRow sets state to null when no address is present", () => {
  const record = {
    id: "noaddr1",
    parkCode: "acad",
    name: "No Address Campground",
    description: "",
    latitude: "44.3106",
    longitude: "-68.2044",
    amenities: {},
    fees: [],
    reservationUrl: "",
    directionsUrl: "",
    images: [],
    contacts: {},
  };

  const row = toCampgroundRow(record as any);

  assertEquals(row?.state, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/nps-sync/transform.test.ts`
Expected: FAIL — `row?.state` is `undefined`.

- [ ] **Step 3: Implement**

In `supabase/functions/nps-sync/transform.ts`:

```ts
interface NpsAddressRecord {
  type?: string;
  stateCode?: string;
}

export interface NpsCampgroundRecord {
  id: string;
  parkCode: string;
  name: string;
  description: string;
  latitude: string;
  longitude: string;
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservationUrl: string;
  directionsUrl: string;
  images: unknown[];
  contacts: unknown;
  addresses?: NpsAddressRecord[];
}

export interface CampgroundRow {
  id: string;
  park_code: string;
  name: string;
  description: string;
  location: string; // WKT, e.g. 'POINT(lng lat)'
  state: string | null;
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservation_url: string;
  directions_url: string;
  images: unknown[];
  contact: unknown;
}

// NPS's field names here are this codebase's best recollection of its
// schema, unverified against a live response — a missing/renamed field
// must degrade to null, never throw.
function resolveState(addresses: NpsAddressRecord[] | undefined): string | null {
  if (!addresses || addresses.length === 0) return null;
  const physical = addresses.find((a) => a.type === "Physical");
  return (physical ?? addresses[0]).stateCode ?? null;
}

export function toCampgroundRow(record: NpsCampgroundRecord): CampgroundRow | null {
  const lat = parseFloat(record.latitude);
  const lng = parseFloat(record.longitude);
  if (!record.id || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  return {
    id: record.id,
    park_code: record.parkCode,
    name: record.name,
    description: record.description,
    location: `POINT(${lng} ${lat})`,
    state: resolveState(record.addresses),
    amenities: record.amenities ?? {},
    fees: record.fees ?? [],
    reservation_url: record.reservationUrl,
    directions_url: record.directionsUrl,
    images: record.images ?? [],
    contact: record.contacts ?? {},
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/nps-sync/transform.test.ts`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/nps-sync/transform.ts supabase/functions/nps-sync/transform.test.ts
git commit -m "Parse state from NPS campground address in nps-sync"
```

---

### Task 4: `state_filter` RPC migration

**Files:**
- Create: `supabase/migrations/0013_state_filter_rpcs.sql`

**Interfaces:**
- Consumes: `state` column from Task 1.
- Produces: `nearest_campgrounds(user_lat, user_lng, result_limit, agency_filter, max_distance_m, state_filter)` returning `state`; `get_campgrounds_by_ids(campground_ids, agency_filter)` returning `state` (no new parameter). Task 5's `CampgroundsService` calls both by these exact names.

- [ ] **Step 1: Write the migration**

```sql
drop function nearest_campgrounds(double precision, double precision, int, text[], double precision);
drop function get_campgrounds_by_ids(text[], text[]);

create function public.nearest_campgrounds(
  user_lat double precision,
  user_lng double precision,
  result_limit int default 50,
  agency_filter text[] default null,
  max_distance_m double precision default null,
  state_filter text[] default null
)
returns table (
  id text,
  park_code text,
  name text,
  description text,
  lat double precision,
  lng double precision,
  agency text,
  state text,
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
    c.agency, c.state, c.amenities, c.fees, c.reservation_url, c.directions_url,
    c.images, c.contact,
    st_distance(c.location, st_setsrid(st_point(user_lng, user_lat), 4326)::geography) as distance_m
  from public.campgrounds c
  where (agency_filter is null or c.agency = any(agency_filter))
    and (state_filter is null or c.state = any(state_filter))
    and (
      max_distance_m is null
      or st_dwithin(c.location, st_setsrid(st_point(user_lng, user_lat), 4326)::geography, max_distance_m)
    )
  order by c.location <-> st_setsrid(st_point(user_lng, user_lat), 4326)::geography
  limit (case when max_distance_m is not null then null else result_limit end);
$$;

grant execute on function public.nearest_campgrounds(double precision, double precision, int, text[], double precision, text[]) to anon, authenticated;

create function public.get_campgrounds_by_ids(campground_ids text[], agency_filter text[] default null)
returns table (
  id text, park_code text, name text, description text,
  lat double precision, lng double precision, agency text, state text,
  amenities jsonb, fees jsonb, reservation_url text, directions_url text,
  images jsonb, contact jsonb
)
language sql
stable
as $$
  select
    c.id, c.park_code, c.name, c.description,
    st_y(c.location::geometry) as lat,
    st_x(c.location::geometry) as lng,
    c.agency, c.state, c.amenities, c.fees, c.reservation_url, c.directions_url,
    c.images, c.contact
  from public.campgrounds c
  where c.id = any(campground_ids)
    and (agency_filter is null or c.agency = any(agency_filter));
$$;

grant execute on function public.get_campgrounds_by_ids(text[], text[]) to anon, authenticated;
```

- [ ] **Step 2: Apply and smoke-test**

Run: `supabase db push`
Expected: migration `0013_state_filter_rpcs` applies with no error;
`select * from nearest_campgrounds(39.5, -105.8, 5, null, null, array['CO']);` returns only Colorado rows (or zero rows if none are backfilled yet — not an error).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0013_state_filter_rpcs.sql
git commit -m "Add state_filter param to nearest_campgrounds; return state from both RPCs"
```

---

### Task 5: `Campground` model & `CampgroundsService`

**Files:**
- Modify: `src/app/core/models/campground.model.ts`
- Modify: `src/app/core/services/campgrounds.service.ts`
- Test: `src/app/core/services/campgrounds.service.spec.ts`

**Interfaces:**
- Consumes: `nearest_campgrounds`/`get_campgrounds_by_ids` returning `state` (Task 4).
- Produces: `Campground.state: string | null`; `CampgroundsService.getNearest(coords, limit?, agencies?, maxDistanceMeters?, states?)` — `states` is the **5th** parameter, appended after the existing four so no existing call site breaks positionally. Task 6's `FinderComponent` calls it with this exact signature.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/core/services/campgrounds.service.spec.ts` (and update the two existing assertions noted below):

```ts
  it('forwards a state filter to the RPC', async () => {
    rpcSpy.mockReturnValue(chainableRpc([]));

    await service.getNearest({ lat: 44.3, lng: -68.1 }, 50, undefined, undefined, ['CO', 'WY']);

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: null,
      max_distance_m: null, state_filter: ['CO', 'WY'],
    });
  });

  it('maps the state column onto the returned Campground', async () => {
    rpcSpy.mockReturnValue(chainableRpc([{
      id: 'abc', park_code: 'acad', name: 'Blackwoods', description: 'desc',
      lat: 44.31, lng: -68.2, agency: 'NPS', state: 'ME', amenities: {}, fees: [],
      reservation_url: 'https://x', directions_url: 'https://y', images: [], contact: {},
      distance_m: 1200,
    }]));

    const result = await service.getNearest({ lat: 44.3, lng: -68.1 });

    expect(result[0].state).toBe('ME');
  });

  it('maps the state column onto the returned Campground for getByIds', async () => {
    rpcSpy.mockResolvedValue({
      data: [{
        id: 'cg-1', park_code: 'acad', name: 'Blackwoods', description: 'desc',
        lat: 44.31, lng: -68.2, agency: 'NPS', state: 'ME', amenities: {}, fees: [],
        reservation_url: 'https://x', directions_url: 'https://y', images: [], contact: {},
      }],
      error: null,
    });

    const result = await service.getByIds(['cg-1']);

    expect(result[0].state).toBe('ME');
  });
```

Update the existing `'maps RPC rows to Campground objects'`, `'forwards an agency filter to the RPC'`, and `'forwards a max distance filter to the RPC'` tests' `toHaveBeenCalledWith` expectations to add `state_filter: null` alongside the existing `max_distance_m` key, e.g.:

```ts
    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: null,
      max_distance_m: null, state_filter: null,
    });
```

(apply the same `state_filter: null` addition to the agency-filter and max-distance tests' expected objects, and to the pagination test's — that one doesn't assert call args, so it needs no change).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL on the new tests (`state_filter` unexpected / `result[0].state` is `undefined`) and on the three updated assertions (actual call is missing `state_filter`).

- [ ] **Step 3: Implement**

In `src/app/core/models/campground.model.ts`, add:

```ts
  state: string | null;
```

In `src/app/core/services/campgrounds.service.ts`, update `getNearest`:

```ts
  async getNearest(
    coords: Coordinates,
    limit = 50,
    agencies?: string[],
    maxDistanceMeters?: number,
    states?: string[],
  ): Promise<Campground[]> {
    const PAGE_SIZE = 1000;
    const rows: any[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await this.supabase.client
        .rpc('nearest_campgrounds', {
          user_lat: coords.lat,
          user_lng: coords.lng,
          result_limit: limit,
          agency_filter: agencies ?? null,
          max_distance_m: maxDistanceMeters ?? null,
          state_filter: states ?? null,
        })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    return rows.map((row: any) => ({
      id: row.id,
      parkCode: row.park_code,
      name: row.name,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      agency: row.agency,
      state: row.state,
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

And add `state: row.state` to the row-mapping object inside `getByIds` (no new parameter there, per this plan's Global Constraints):

```ts
      agency: row.agency,
      state: row.state,
      amenities: row.amenities ?? {},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/models/campground.model.ts src/app/core/services/campgrounds.service.ts src/app/core/services/campgrounds.service.spec.ts
git commit -m "Add state to Campground model and thread states through CampgroundsService"
```

---

### Task 6: State & Region filters in `FinderComponent`

**Files:**
- Modify: `src/app/features/finder/finder.component.ts`
- Test: `src/app/features/finder/finder.component.spec.ts`

**Interfaces:**
- Consumes: `CampgroundsService.getNearest(coords, limit?, agencies?, maxDistanceMeters?, states?)` (Task 5).
- Produces: `ALL_STATES: string[]` (51 codes: 50 states + DC), `REGIONS: Record<string, string[]>` (`Northeast`/`Midwest`/`South`/`West`), `REGION_NAMES: string[]` (`Object.keys(REGIONS)`, for the template's MultiSelect options), `selectedStates: string[]`, `selectedRegions: string[]`, `onRegionFilterChange(): Promise<void>`. Task 7's template binds to all of these by these exact names.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/features/finder/finder.component.spec.ts`:

```ts
  it('defaults to all states and all regions selected', () => {
    expect(component.selectedStates).toEqual(component.ALL_STATES);
    expect(component.selectedRegions).toEqual(component.REGION_NAMES);
  });

  it('sends no state filter when all states are selected', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);

    await component.ngOnInit();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, SHOW_ALL_RADIUS_M, undefined,
    );
  });

  it('reloads with the selected states when the filter changes', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.selectedStates = ['CO'];
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, SHOW_ALL_RADIUS_M, ['CO'],
    );
  });

  it('recomputes selected states from the selected regions', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.selectedRegions = ['West'];
    await component.onRegionFilterChange();

    expect(component.selectedStates).toEqual(component.REGIONS['West']);
    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, SHOW_ALL_RADIUS_M, component.REGIONS['West'],
    );
  });
```

Update the existing `'loads with the show-all radius by default'`, `'reloads with the selected agencies...'`, `'applies the selected radius in meters...'`, and `'reverts to the show-all radius...'` tests' `toHaveBeenLastCalledWith` calls to add a trailing `undefined` (the default "all states selected" translates to no filter):

```ts
    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, component.ALL_AGENCIES, SHOW_ALL_RADIUS_M, undefined,
    );
```

(same trailing `undefined` added to the other two calls in those tests, keeping each test's existing agency/distance arguments unchanged).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `component.ALL_STATES`/`REGIONS`/`selectedRegions`/`onRegionFilterChange` don't exist yet, and the four updated assertions see one fewer argument than actually passed.

- [ ] **Step 3: Implement**

In `src/app/features/finder/finder.component.ts`, add the constants and fields (after `RADIUS_OPTIONS`):

```ts
  readonly REGIONS: Record<string, string[]> = {
    Northeast: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT', 'NJ', 'NY', 'PA'],
    Midwest: ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'],
    South: ['AL', 'AR', 'DE', 'FL', 'GA', 'KY', 'LA', 'MD', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA', 'WV', 'DC'],
    West: ['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NV', 'NM', 'OR', 'UT', 'WA', 'WY'],
  };
  readonly ALL_STATES = Object.values(this.REGIONS).flat();
  readonly REGION_NAMES = Object.keys(this.REGIONS);
  selectedStates: string[] = [...this.ALL_STATES];
  selectedRegions: string[] = [...this.REGION_NAMES];
```

Update `loadNearest` to compute and pass the states argument — a full selection means "no filter" because, unlike agency, `state` is nullable and an exhaustive list would wrongly exclude rows still awaiting a state backfill:

```ts
      const maxDistanceMeters = this.nearMeEnabled
        ? this.radiusMiles * METERS_PER_MILE
        : SHOW_ALL_RADIUS_M;
      // Sending the exhaustive state list would exclude any row whose state
      // hasn't been backfilled yet (state is nullable, unlike agency, so an
      // "all selected" state filter isn't a true no-op) — send undefined
      // instead so those rows keep showing up until synced.
      const states =
        this.selectedStates.length === this.ALL_STATES.length ? undefined : this.selectedStates;
      const results = await this.campgroundsService.getNearest(
        location,
        50,
        this.selectedAgencies,
        maxDistanceMeters,
        states,
      );
```

Add the region-change handler after `onFilterChange`:

```ts
  onRegionFilterChange(): Promise<void> {
    this.selectedStates = this.selectedRegions.flatMap((region) => this.REGIONS[region]);
    return this.onFilterChange();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/finder/finder.component.ts src/app/features/finder/finder.component.spec.ts
git commit -m "Add state and region filter state/logic to FinderComponent"
```

---

### Task 7: State & Region MultiSelects in the Finder template

**Files:**
- Modify: `src/app/features/finder/finder.component.html`

**Interfaces:**
- Consumes: `selectedStates`, `selectedRegions`, `ALL_STATES`, `REGION_NAMES`, `onFilterChange()`, `onRegionFilterChange()` (Task 6).

- [ ] **Step 1: Add the MultiSelects**

In `src/app/features/finder/finder.component.html`, inside the existing `.agency-filter` div, right after the agency `p-multiselect`:

```html
      <p-multiselect
        [options]="REGION_NAMES"
        [(ngModel)]="selectedRegions"
        (onChange)="onRegionFilterChange()"
        placeholder="Filter by region"
        name="regionFilter"
      />
      <p-multiselect
        [options]="ALL_STATES"
        [(ngModel)]="selectedStates"
        (onChange)="onFilterChange()"
        placeholder="Filter by state"
        name="stateFilter"
      />
```

- [ ] **Step 2: Rebuild and manually verify in the browser**

Run: `npm run start`, then open `http://localhost:4200`.
Expected: the Finder page shows three MultiSelects (Agency, Region, State) all defaulting to fully-selected; deselecting a region narrows the State MultiSelect's selection to that region's remaining states and reloads the map/table; deselecting individual states also reloads. No console errors.

- [ ] **Step 3: Run the full test suite once more**

Run: `npx ng test --watch=false`
Expected: PASS, all tests (this task only touches the template, not logic, but confirms nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add src/app/features/finder/finder.component.html
git commit -m "Add region and state MultiSelect filters to the Finder page"
```

---

## Deployment Note (not a code task)

After Tasks 1-4 are deployed to the live Supabase project, existing rows
still have `state = null` until each sync's Edge Function runs again — both
`ridb-sync` and `nps-sync` upsert by `id`, so a normal invocation backfills
`state` on every row it touches with no separate backfill script. Trigger
each function once after deploying (however they're normally invoked —
manually or via their existing schedule) to populate `state` for the
existing dataset.
