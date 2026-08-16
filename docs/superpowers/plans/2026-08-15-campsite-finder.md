# CampsiteFinder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working CampsiteFinder v1 — an Angular/PrimeNG PWA that finds the nearest federal campgrounds using a Supabase-cached copy of NPS data, shown on a Leaflet map and a PrimeNG DataTable, with Supabase-authenticated favorites.

**Architecture:** A scheduled Supabase Edge Function syncs NPS campground data into a PostGIS-enabled Postgres table. The Angular app never calls the NPS API directly — it queries Supabase via RPC functions (`nearest_campgrounds`, `get_campgrounds_by_ids`) for location-based lookups, rendering results in a Leaflet map and PrimeNG DataTable kept in sync by selection.

**Tech Stack:** Angular (standalone components, latest stable via `ng new`), PrimeNG (Aura theme preset via `@primeuix/themes`), `@bluehalo/ngx-leaflet` + `leaflet`, `@supabase/supabase-js`, Supabase (Postgres + PostGIS + Auth + Edge Functions/Deno + pg_cron), `@angular/pwa`.

## Global Constraints

- Angular: standalone components, no SSR (Leaflet/geolocation are browser-only).
- PrimeNG: Aura theme preset (`@primeuix/themes`), PrimeIcons for iconography.
- Map: Leaflet via `@bluehalo/ngx-leaflet`, OpenStreetMap tiles, no map API key required or used.
- Supabase Postgres: PostGIS extension enabled; every table has RLS enabled — no unguarded public writes.
- The NPS API key lives only in the `nps-sync` Edge Function's Supabase secret. It must never appear in Angular code, `environment.ts`, or any client-visible file.
- NPS sync runs on a weekly `pg_cron` schedule (`0 6 * * 1`, Mondays 06:00 UTC) and is idempotent (upsert), retaining existing data on failure rather than clearing it.
- Out of scope for all tasks below: live individual-campsite booking availability, a native mobile app, push notifications, and social features (sharing/comments/ratings). Do not add them.

---

## Task 1: Project Scaffold — Angular + PrimeNG

**Files:**
- Create: Angular CLI-generated project tree (`angular.json`, `package.json`, `tsconfig*.json`, `src/**`, `.gitignore`) at the repository root.
- Modify: `src/app/app.config.ts` — add PrimeNG provider.
- Modify: `src/styles.scss` — import PrimeIcons.

**Interfaces:**
- Produces: an `ApplicationConfig` (`appConfig`) in `src/app/app.config.ts` that later tasks add providers to.

- [ ] **Step 1: Scaffold the Angular project into the current directory**

The repo root already contains `.git/`, `docs/`, and `.gitignore` (which ignores `.superpowers/`, used by the SDD workflow driving this plan), so the directory is not empty and `ng new` needs `--force` to proceed:

```bash
npx @angular/cli@latest new campsite-finder --directory=. --style=scss --routing --skip-git --ssr=false --force
```

If prompted interactively for anything not covered by a flag, accept the default.

`ng new --force` overwrites `.gitignore` with Angular's generated one, which does not know about `.superpowers/`. Restore that line by appending it back:

```bash
echo ".superpowers/" >> .gitignore
```

- [ ] **Step 2: Verify the scaffold builds and its default test passes**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: the default `app` component spec passes.

Run: `npx ng build`
Expected: build succeeds with no errors.

- [ ] **Step 3: Install PrimeNG and wire up the theme**

Run: `npm install primeng @primeuix/themes primeicons`

Edit `src/app/app.config.ts`:

```ts
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
      },
    }),
  ],
};
```

Add to the top of `src/styles.scss`:

```scss
@import "primeicons/primeicons.css";
```

- [ ] **Step 4: Verify the build still succeeds with PrimeNG wired in**

Run: `npx ng build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Scaffold Angular app with PrimeNG (Aura theme)"
```

---

## Task 2: Supabase Schema — Campgrounds, Profiles, Favorites

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Produces: tables `campgrounds`, `profiles`, `favorites`; RPC functions `nearest_campgrounds(user_lat float8, user_lng float8, result_limit int default 50)` and `get_campgrounds_by_ids(campground_ids text[])`, both returning rows shaped `(id text, park_code text, name text, description text, lat float8, lng float8, amenities jsonb, fees jsonb, reservation_url text, directions_url text, images jsonb, contact jsonb[, distance_m float8])`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0001_init.sql`:

```sql
create extension if not exists postgis;

create table campgrounds (
  id text primary key,
  park_code text not null,
  name text not null,
  description text,
  location geography(Point, 4326) not null,
  amenities jsonb,
  fees jsonb,
  reservation_url text,
  directions_url text,
  images jsonb,
  contact jsonb,
  updated_at timestamptz not null default now()
);

create index campgrounds_location_idx on campgrounds using gist (location);

alter table campgrounds enable row level security;
create policy "anyone can read campgrounds" on campgrounds for select using (true);
-- no insert/update/delete policy for anon/authenticated: only the
-- nps-sync Edge Function (service role key) writes to this table.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
);

alter table profiles enable row level security;
create policy "anyone can read profiles" on profiles for select using (true);
create policy "users can insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "users can update own profile" on profiles for update using (auth.uid() = id);

create function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

create table favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  campground_id text not null references campgrounds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, campground_id)
);

alter table favorites enable row level security;
create policy "users manage own favorites" on favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function nearest_campgrounds(
  user_lat double precision,
  user_lng double precision,
  result_limit int default 50
)
returns table (
  id text,
  park_code text,
  name text,
  description text,
  lat double precision,
  lng double precision,
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
    c.id,
    c.park_code,
    c.name,
    c.description,
    st_y(c.location::geometry) as lat,
    st_x(c.location::geometry) as lng,
    c.amenities,
    c.fees,
    c.reservation_url,
    c.directions_url,
    c.images,
    c.contact,
    st_distance(c.location, st_setsrid(st_point(user_lng, user_lat), 4326)::geography) as distance_m
  from campgrounds c
  order by c.location <-> st_setsrid(st_point(user_lng, user_lat), 4326)::geography
  limit result_limit;
$$;

grant execute on function nearest_campgrounds(double precision, double precision, int) to anon, authenticated;

create or replace function get_campgrounds_by_ids(campground_ids text[])
returns table (
  id text,
  park_code text,
  name text,
  description text,
  lat double precision,
  lng double precision,
  amenities jsonb,
  fees jsonb,
  reservation_url text,
  directions_url text,
  images jsonb,
  contact jsonb
)
language sql
stable
as $$
  select
    c.id,
    c.park_code,
    c.name,
    c.description,
    st_y(c.location::geometry) as lat,
    st_x(c.location::geometry) as lng,
    c.amenities,
    c.fees,
    c.reservation_url,
    c.directions_url,
    c.images,
    c.contact
  from campgrounds c
  where c.id = any(campground_ids);
$$;

grant execute on function get_campgrounds_by_ids(text[]) to anon, authenticated;
```

- [ ] **Step 2: Create the Supabase project (if one doesn't already exist for this app)**

Using the `mcp__claude_ai_Supabase__create_project` tool (or the Supabase dashboard), create a new project named `campsite-finder`. Record its project URL and anon key — they're needed in Task 5.

- [ ] **Step 3: Apply the migration**

Using the `mcp__claude_ai_Supabase__apply_migration` tool, apply the SQL from Step 1 to the `campsite-finder` project as migration `0001_init`.

- [ ] **Step 4: Verify the schema**

Using `mcp__claude_ai_Supabase__execute_sql`, run:

```sql
select nearest_campgrounds(38.9, -77.0, 5);
```

Expected: an empty result set (no error) — the table is empty until Task 3 runs the sync.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "Add Supabase schema: campgrounds, profiles, favorites, nearest-campground RPCs"
```

---

## Task 3: NPS Sync Edge Function

**Files:**
- Create: `supabase/functions/nps-sync/transform.ts`
- Create: `supabase/functions/nps-sync/index.ts`
- Test: `supabase/functions/nps-sync/transform.test.ts`

**Interfaces:**
- Consumes: table `campgrounds` from Task 2.
- Produces: `toCampgroundRow(record: NpsCampgroundRecord): CampgroundRow | null` (pure, used by `index.ts` and tested directly).

- [ ] **Step 1: Write the failing test for the transform function**

Create `supabase/functions/nps-sync/transform.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { toCampgroundRow } from "./transform.ts";

Deno.test("toCampgroundRow converts an NPS record into a PostGIS-ready row", () => {
  const record = {
    id: "abc123",
    parkCode: "acad",
    name: "Blackwoods Campground",
    description: "A campground in Acadia.",
    latitude: "44.3106",
    longitude: "-68.2044",
    amenities: { showers: "Yes" },
    fees: [{ cost: "30.00", description: "Per night" }],
    reservationUrl: "https://www.recreation.gov/camping/campgrounds/232473",
    directionsUrl: "https://www.nps.gov/acad/planyourvisit/camping.htm",
    images: [],
    contacts: {},
  };

  const row = toCampgroundRow(record);

  assertEquals(row?.id, "abc123");
  assertEquals(row?.location, "POINT(-68.2044 44.3106)");
  assertEquals(row?.park_code, "acad");
});

Deno.test("toCampgroundRow returns null when coordinates are missing", () => {
  const record = {
    id: "bad1",
    parkCode: "acad",
    name: "No Coords",
    description: "",
    latitude: "",
    longitude: "",
    amenities: {},
    fees: [],
    reservationUrl: "",
    directionsUrl: "",
    images: [],
    contacts: {},
  };

  assertEquals(toCampgroundRow(record), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/nps-sync/transform.test.ts`
Expected: FAIL — `transform.ts` does not exist yet.

- [ ] **Step 3: Implement the transform function**

Create `supabase/functions/nps-sync/transform.ts`:

```ts
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
}

export interface CampgroundRow {
  id: string;
  park_code: string;
  name: string;
  description: string;
  location: string; // WKT, e.g. 'POINT(lng lat)'
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservation_url: string;
  directions_url: string;
  images: unknown[];
  contact: unknown;
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
    amenities: record.amenities ?? {},
    fees: record.fees ?? [],
    reservation_url: record.reservationUrl,
    directions_url: record.directionsUrl,
    images: record.images ?? [],
    contact: record.contacts ?? {},
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/nps-sync/transform.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the sync handler**

Create `supabase/functions/nps-sync/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toCampgroundRow } from "./transform.ts";

const NPS_API_BASE = "https://developer.nps.gov/api/v1";

Deno.serve(async (_req) => {
  const npsApiKey = Deno.env.get("NPS_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!npsApiKey || !supabaseUrl || !serviceRoleKey) {
    return new Response("Missing required environment variables", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let start = 0;
  const limit = 50;
  let total = Infinity;
  let upserted = 0;
  let skipped = 0;

  try {
    while (start < total) {
      const url = `${NPS_API_BASE}/campgrounds?start=${start}&limit=${limit}&api_key=${npsApiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`NPS API request failed: ${response.status}`);
      }
      const body = await response.json();
      total = parseInt(body.total, 10);

      const rows = body.data
        .map(toCampgroundRow)
        .filter((row: unknown) => row !== null);
      skipped += body.data.length - rows.length;

      if (rows.length > 0) {
        const { error } = await supabase.from("campgrounds").upsert(rows);
        if (error) throw error;
        upserted += rows.length;
      }

      start += limit;
    }

    return new Response(
      JSON.stringify({ upserted, skipped }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("nps-sync failed, existing data retained:", err);
    return new Response(`Sync failed: ${(err as Error).message}`, { status: 500 });
  }
});
```

- [ ] **Step 6: Deploy the function and set its secret**

Using `mcp__claude_ai_Supabase__deploy_edge_function`, deploy `nps-sync`.

The NPS API key secret must be set by a human, not this implementer: no Supabase CLI is installed in this environment, and a real secret value shouldn't pass through subagent-run shell commands anyway. **Stop here and ask the human partner to set it** via the Supabase dashboard: Project Settings → Edge Functions → Secrets → add `NPS_API_KEY` with their key from developer.nps.gov. (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase and don't need to be set manually.) Report status NEEDS_CONTEXT with this ask if the secret isn't confirmed set yet; do not attempt to work around it.

- [ ] **Step 7: Trigger the sync once manually and verify data landed**

```bash
curl -X POST "<your-project-url>/functions/v1/nps-sync" \
  -H "Authorization: Bearer <your-anon-or-service-role-key>"
```

Then using `mcp__claude_ai_Supabase__execute_sql`:

```sql
select count(*) from campgrounds;
```

Expected: a count greater than 0.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/nps-sync
git commit -m "Add NPS-to-Supabase campground sync Edge Function"
```

---

## Task 4: Schedule the Sync

**Files:**
- Create: `supabase/migrations/0002_schedule_nps_sync.sql`

- [ ] **Step 1: Write the scheduling migration**

Create `supabase/migrations/0002_schedule_nps_sync.sql` (fill in your project's function URL and service role key from the Supabase dashboard before applying):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nps-campground-sync-weekly',
  '0 6 * * 1',
  $$
  select net.http_post(
    url := '<your-project-url>/functions/v1/nps-sync',
    headers := jsonb_build_object('Authorization', 'Bearer <your-service-role-key>')
  );
  $$
);
```

- [ ] **Step 2: Apply it**

Using `mcp__claude_ai_Supabase__apply_migration`, apply the SQL above (with real values substituted) as migration `0002_schedule_nps_sync`.

- [ ] **Step 3: Verify the job is scheduled**

Using `mcp__claude_ai_Supabase__execute_sql`:

```sql
select jobname, schedule from cron.job where jobname = 'nps-campground-sync-weekly';
```

Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_schedule_nps_sync.sql
git commit -m "Schedule weekly NPS campground sync via pg_cron"
```

---

## Task 5: Supabase Client Service (Angular)

**Files:**
- Create: `src/environments/environment.ts`
- Create: `src/environments/environment.prod.ts`
- Create: `src/app/core/services/supabase.service.ts`
- Test: `src/app/core/services/supabase.service.spec.ts`

**Interfaces:**
- Produces: `SupabaseService` with `client: SupabaseClient`, `session: Signal<Session | null>`, `isAuthenticated: boolean` — consumed by every service/component in later tasks.

- [ ] **Step 1: Install the Supabase client**

Run: `npm install @supabase/supabase-js`

- [ ] **Step 2: Add environment files**

Create `src/environments/environment.ts` (the anon key and URL are public-safe by design — access control is enforced by RLS, not by hiding these values):

```ts
export const environment = {
  production: false,
  supabaseUrl: 'YOUR_SUPABASE_PROJECT_URL',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
};
```

Create `src/environments/environment.prod.ts` with the same shape and `production: true`.

- [ ] **Step 3: Write the failing test**

Create `src/app/core/services/supabase.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { SupabaseService } from './supabase.service';

describe('SupabaseService', () => {
  let service: SupabaseService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SupabaseService);
  });

  it('starts unauthenticated before a session resolves', () => {
    expect(service.isAuthenticated).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `SupabaseService` does not exist yet.

- [ ] **Step 5: Implement the service**

Create `src/app/core/services/supabase.service.ts`:

```ts
import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
  readonly session = signal<Session | null>(null);

  constructor() {
    this.client.auth.getSession().then(({ data }) => this.session.set(data.session));
    this.client.auth.onAuthStateChange((_event, session) => this.session.set(session));
  }

  get isAuthenticated(): boolean {
    return this.session() !== null;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/environments src/app/core/services/supabase.service.ts src/app/core/services/supabase.service.spec.ts
git commit -m "Add SupabaseService (client + auth session signal)"
```

---

## Task 6: Geolocation Service

**Files:**
- Create: `src/app/core/services/geolocation.service.ts`
- Test: `src/app/core/services/geolocation.service.spec.ts`

**Interfaces:**
- Produces: `GeolocationService.getCurrentPosition(): Promise<Coordinates>` and `interface Coordinates { lat: number; lng: number }` — consumed by `CampgroundsService` callers (Task 10).

- [ ] **Step 1: Write the failing tests**

Create `src/app/core/services/geolocation.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { GeolocationService } from './geolocation.service';

describe('GeolocationService', () => {
  let service: GeolocationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GeolocationService);
  });

  it('resolves coordinates from navigator.geolocation', async () => {
    const mockGeolocation = {
      getCurrentPosition: (success: PositionCallback) => {
        success({ coords: { latitude: 44.31, longitude: -68.2 } } as GeolocationPosition);
      },
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      value: mockGeolocation,
      configurable: true,
    });

    const coords = await service.getCurrentPosition();
    expect(coords).toEqual({ lat: 44.31, lng: -68.2 });
  });

  it('rejects when geolocation is unsupported', async () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    });

    await expectAsync(service.getCurrentPosition()).toBeRejectedWithError(
      'Geolocation is not supported by this browser',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `GeolocationService` does not exist yet.

- [ ] **Step 3: Implement the service**

Create `src/app/core/services/geolocation.service.ts`:

```ts
import { Injectable } from '@angular/core';

export interface Coordinates {
  lat: number;
  lng: number;
}

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  getCurrentPosition(): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        (error) => reject(error),
        { timeout: 10000 },
      );
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/geolocation.service.ts src/app/core/services/geolocation.service.spec.ts
git commit -m "Add GeolocationService with unsupported-browser fallback"
```

---

## Task 7: Campgrounds Query Service

**Files:**
- Create: `src/app/core/models/campground.model.ts`
- Create: `src/app/core/services/campgrounds.service.ts`
- Test: `src/app/core/services/campgrounds.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService.client` (Task 5), `Coordinates` (Task 6).
- Produces: `interface Campground { id, parkCode, name, description, lat, lng, amenities, fees, reservationUrl, directionsUrl, images, contact, distanceMeters }` and `CampgroundsService.getNearest(coords: Coordinates, limit = 50): Promise<Campground[]>` — consumed by `FinderComponent` (Task 10).

- [ ] **Step 1: Add the model**

Create `src/app/core/models/campground.model.ts`:

```ts
export interface Campground {
  id: string;
  parkCode: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservationUrl: string;
  directionsUrl: string;
  images: unknown[];
  contact: unknown;
  distanceMeters: number;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/app/core/services/campgrounds.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { CampgroundsService } from './campgrounds.service';
import { SupabaseService } from './supabase.service';

describe('CampgroundsService', () => {
  let service: CampgroundsService;
  let rpcSpy: jasmine.Spy;

  beforeEach(() => {
    rpcSpy = jasmine.createSpy('rpc');
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { client: { rpc: rpcSpy } } }],
    });
    service = TestBed.inject(CampgroundsService);
  });

  it('maps RPC rows to Campground objects', async () => {
    rpcSpy.and.returnValue(Promise.resolve({
      data: [{
        id: 'abc', park_code: 'acad', name: 'Blackwoods', description: 'desc',
        lat: 44.31, lng: -68.2, amenities: {}, fees: [], reservation_url: 'https://x',
        directions_url: 'https://y', images: [], contact: {}, distance_m: 1200,
      }],
      error: null,
    }));

    const result = await service.getNearest({ lat: 44.3, lng: -68.1 });

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50,
    });
    expect(result[0].name).toBe('Blackwoods');
    expect(result[0].distanceMeters).toBe(1200);
  });

  it('throws when the RPC call errors', async () => {
    rpcSpy.and.returnValue(Promise.resolve({ data: null, error: new Error('boom') }));

    await expectAsync(service.getNearest({ lat: 0, lng: 0 })).toBeRejected();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `CampgroundsService` does not exist yet.

- [ ] **Step 4: Implement the service**

Create `src/app/core/services/campgrounds.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Campground } from '../models/campground.model';
import { Coordinates } from './geolocation.service';

@Injectable({ providedIn: 'root' })
export class CampgroundsService {
  private readonly supabase = inject(SupabaseService);

  async getNearest(coords: Coordinates, limit = 50): Promise<Campground[]> {
    const { data, error } = await this.supabase.client.rpc('nearest_campgrounds', {
      user_lat: coords.lat,
      user_lng: coords.lng,
      result_limit: limit,
    });

    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      id: row.id,
      parkCode: row.park_code,
      name: row.name,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      amenities: row.amenities ?? {},
      fees: row.fees ?? [],
      reservationUrl: row.reservation_url,
      directionsUrl: row.directions_url,
      images: row.images ?? [],
      contact: row.contact,
      distanceMeters: row.distance_m,
    }));
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/models/campground.model.ts src/app/core/services/campgrounds.service.ts src/app/core/services/campgrounds.service.spec.ts
git commit -m "Add CampgroundsService wrapping the nearest_campgrounds RPC"
```

---

## Task 8: Leaflet Map Component

**Files:**
- Create: `src/app/features/finder/campground-map/campground-map.component.ts`
- Create: `src/app/features/finder/campground-map/campground-map.component.scss`
- Test: `src/app/features/finder/campground-map/campground-map.component.spec.ts`

**Interfaces:**
- Consumes: `Campground[]` (Task 7).
- Produces: `<app-campground-map [campgrounds] [selectedId]>` — consumed by `FinderComponent` (Task 10) and `FavoritesComponent` (Task 13).

- [ ] **Step 1: Install Leaflet**

Run: `npm install leaflet @bluehalo/ngx-leaflet && npm install --save-dev @types/leaflet`

- [ ] **Step 2: Write the failing test**

Create `src/app/features/finder/campground-map/campground-map.component.spec.ts`:

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
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `CampgroundMapComponent` does not exist yet.

- [ ] **Step 4: Implement the component**

Create `src/app/features/finder/campground-map/campground-map.component.scss`:

```scss
:host {
  display: block;
}

.campground-map {
  height: 400px;
  width: 100%;
}
```

Create `src/app/features/finder/campground-map/campground-map.component.ts`:

```ts
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { LeafletModule } from '@bluehalo/ngx-leaflet';
import * as L from 'leaflet';
import { Campground } from '../../../core/models/campground.model';

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
    if (changes['campgrounds']) {
      this.markerLayers = this.campgrounds.map((c) => L.marker([c.lat, c.lng]).bindPopup(c.name));
    }
    if (changes['selectedId'] && this.selectedId && this.map) {
      const selected = this.campgrounds.find((c) => c.id === this.selectedId);
      if (selected) {
        this.map.setView([selected.lat, selected.lng], 12);
      }
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/finder/campground-map
git commit -m "Add Leaflet-based CampgroundMapComponent"
```

---

## Task 9: PrimeNG DataTable List Component

**Files:**
- Create: `src/app/features/finder/campground-table/campground-table.component.ts`
- Test: `src/app/features/finder/campground-table/campground-table.component.spec.ts`

**Interfaces:**
- Consumes: `Campground[]` (Task 7).
- Produces: `<app-campground-table [campgrounds] [selected] (selectedChange)>` — consumed by `FinderComponent` (Task 10) and `FavoritesComponent` (Task 13).

- [ ] **Step 1: Write the failing test**

Create `src/app/features/finder/campground-table/campground-table.component.spec.ts`:

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `CampgroundTableComponent` does not exist yet.

- [ ] **Step 3: Implement the component**

Create `src/app/features/finder/campground-table/campground-table.component.ts`:

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TableModule } from 'primeng/table';
import { Campground } from '../../../core/models/campground.model';

@Component({
  selector: 'app-campground-table',
  standalone: true,
  imports: [TableModule, DecimalPipe],
  template: `
    <p-table
      [value]="campgrounds"
      [paginator]="true"
      [rows]="10"
      selectionMode="single"
      [(selection)]="selected"
      (selectionChange)="onSelectionChange($event)"
    >
      <ng-template pTemplate="header">
        <tr>
          <th pSortableColumn="name">Name <p-sortIcon field="name" /></th>
          <th pSortableColumn="parkCode">Park <p-sortIcon field="parkCode" /></th>
          <th pSortableColumn="distanceMeters">Distance <p-sortIcon field="distanceMeters" /></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-campground>
        <tr [pSelectableRow]="campground">
          <td>{{ campground.name }}</td>
          <td>{{ campground.parkCode }}</td>
          <td>{{ campground.distanceMeters / 1609.34 | number: '1.1-1' }} mi</td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class CampgroundTableComponent {
  @Input({ required: true }) campgrounds: Campground[] = [];
  @Input() selected: Campground | null = null;
  @Output() selectedChange = new EventEmitter<Campground | null>();

  onSelectionChange(campground: Campground): void {
    this.selectedChange.emit(campground);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/finder/campground-table
git commit -m "Add PrimeNG DataTable CampgroundTableComponent"
```

---

## Task 10: Finder View (Map + Table + Geolocation)

**Files:**
- Create: `src/app/features/finder/finder.component.ts`
- Create: `src/app/features/finder/finder.component.html`
- Create: `src/app/features/finder/finder.component.scss`
- Modify: `src/app/app.routes.ts`
- Test: `src/app/features/finder/finder.component.spec.ts`

**Interfaces:**
- Consumes: `GeolocationService` (Task 6), `CampgroundsService` (Task 7), `CampgroundMapComponent` (Task 8), `CampgroundTableComponent` (Task 9).
- Produces: route `''` → `FinderComponent`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/features/finder/finder.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FinderComponent } from './finder.component';
import { GeolocationService } from '../../core/services/geolocation.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';

describe('FinderComponent', () => {
  let fixture: ComponentFixture<FinderComponent>;
  let component: FinderComponent;
  let geolocationSpy: jasmine.SpyObj<GeolocationService>;
  let campgroundsSpy: jasmine.SpyObj<CampgroundsService>;

  beforeEach(() => {
    geolocationSpy = jasmine.createSpyObj('GeolocationService', ['getCurrentPosition']);
    campgroundsSpy = jasmine.createSpyObj('CampgroundsService', ['getNearest']);

    TestBed.configureTestingModule({
      imports: [FinderComponent],
      providers: [
        { provide: GeolocationService, useValue: geolocationSpy },
        { provide: CampgroundsService, useValue: campgroundsSpy },
      ],
    });

    fixture = TestBed.createComponent(FinderComponent);
    component = fixture.componentInstance;
  });

  it('loads nearest campgrounds using the browser location on init', async () => {
    geolocationSpy.getCurrentPosition.and.returnValue(Promise.resolve({ lat: 44.3, lng: -68.2 }));
    campgroundsSpy.getNearest.and.returnValue(Promise.resolve([{ id: '1', name: 'A' } as any]));

    await component.ngOnInit();

    expect(component.campgrounds().length).toBe(1);
    expect(component.error()).toBeNull();
  });

  it('shows an error and stops loading when geolocation fails', async () => {
    geolocationSpy.getCurrentPosition.and.returnValue(Promise.reject(new Error('denied')));

    await component.ngOnInit();

    expect(component.error()).toBe('denied');
    expect(component.loading()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `FinderComponent` does not exist yet.

- [ ] **Step 3: Implement the component**

Create `src/app/features/finder/finder.component.scss`:

```scss
.finder-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  @media (min-width: 768px) {
    flex-direction: row;

    app-campground-map {
      flex: 1 1 60%;
    }

    app-campground-table {
      flex: 1 1 40%;
    }
  }
}

.manual-location {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
```

Create `src/app/features/finder/finder.component.html`:

```html
<div class="finder">
  @if (loading()) {
    <p-message severity="info" text="Finding campgrounds near you..." />
  }

  @if (error()) {
    <p-message severity="warn" [text]="error()!" />
    <form class="manual-location" (ngSubmit)="onManualSubmit()">
      <input pInputText type="number" step="any" placeholder="Latitude" [(ngModel)]="manualLat" name="manualLat" required />
      <input pInputText type="number" step="any" placeholder="Longitude" [(ngModel)]="manualLng" name="manualLng" required />
      <button pButton type="submit" label="Search this location"></button>
    </form>
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

Create `src/app/features/finder/finder.component.ts`:

```ts
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { CampgroundMapComponent } from './campground-map/campground-map.component';
import { CampgroundTableComponent } from './campground-table/campground-table.component';
import { GeolocationService, Coordinates } from '../../core/services/geolocation.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-finder',
  standalone: true,
  imports: [CampgroundMapComponent, CampgroundTableComponent, MessageModule, FormsModule, ButtonModule, InputTextModule],
  templateUrl: './finder.component.html',
  styleUrl: './finder.component.scss',
})
export class FinderComponent implements OnInit {
  readonly campgrounds = signal<Campground[]>([]);
  readonly selected = signal<Campground | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  manualLat: number | null = null;
  manualLng: number | null = null;

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
      const results = await this.campgroundsService.getNearest(location);
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

  onSelectionChange(campground: Campground | null): void {
    this.selected.set(campground);
  }
}
```

Update `src/app/app.routes.ts`:

```ts
import { Routes } from '@angular/router';
import { FinderComponent } from './features/finder/finder.component';

export const routes: Routes = [
  { path: '', component: FinderComponent },
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/finder/finder.component.ts src/app/features/finder/finder.component.html src/app/features/finder/finder.component.scss src/app/features/finder/finder.component.spec.ts src/app/app.routes.ts
git commit -m "Add FinderComponent: geolocation-driven nearest-campground view"
```

---

## Task 11: Auth — Login and Signup

**Files:**
- Create: `src/app/features/auth/login.component.ts`
- Create: `src/app/features/auth/login.component.html`
- Create: `src/app/features/auth/signup.component.ts`
- Create: `src/app/features/auth/signup.component.html`
- Modify: `src/app/app.routes.ts`
- Test: `src/app/features/auth/login.component.spec.ts`
- Test: `src/app/features/auth/signup.component.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService` (Task 5).
- Produces: routes `'login'` → `LoginComponent`, `'signup'` → `SignupComponent`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/features/auth/login.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { LoginComponent } from './login.component';
import { SupabaseService } from '../../core/services/supabase.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let signInSpy: jasmine.Spy;
  let navigateSpy: jasmine.Spy;

  beforeEach(() => {
    signInSpy = jasmine.createSpy('signInWithPassword');
    navigateSpy = jasmine.createSpy('navigateByUrl');

    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: SupabaseService, useValue: { client: { auth: { signInWithPassword: signInSpy } } } },
        { provide: Router, useValue: { navigateByUrl: navigateSpy } },
      ],
    });

    component = TestBed.createComponent(LoginComponent).componentInstance;
  });

  it('navigates home on successful sign-in', async () => {
    signInSpy.and.returnValue(Promise.resolve({ error: null }));
    component.email = 'a@b.com';
    component.password = 'secret';

    await component.onSubmit();

    expect(navigateSpy).toHaveBeenCalledWith('/');
    expect(component.error()).toBeNull();
  });

  it('sets an error message on failed sign-in', async () => {
    signInSpy.and.returnValue(Promise.resolve({ error: { message: 'Invalid credentials' } }));

    await component.onSubmit();

    expect(component.error()).toBe('Invalid credentials');
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
```

Create `src/app/features/auth/signup.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { SignupComponent } from './signup.component';
import { SupabaseService } from '../../core/services/supabase.service';

describe('SignupComponent', () => {
  let component: SignupComponent;
  let signUpSpy: jasmine.Spy;

  beforeEach(() => {
    signUpSpy = jasmine.createSpy('signUp');

    TestBed.configureTestingModule({
      imports: [SignupComponent],
      providers: [{ provide: SupabaseService, useValue: { client: { auth: { signUp: signUpSpy } } } }],
    });

    component = TestBed.createComponent(SignupComponent).componentInstance;
  });

  it('marks the form submitted on success', async () => {
    signUpSpy.and.returnValue(Promise.resolve({ error: null }));
    component.email = 'a@b.com';
    component.password = 'secret';
    component.displayName = 'Shawn';

    await component.onSubmit();

    expect(signUpSpy).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'secret',
      options: { data: { display_name: 'Shawn' } },
    });
    expect(component.submitted()).toBe(true);
  });

  it('sets an error message on failed sign-up', async () => {
    signUpSpy.and.returnValue(Promise.resolve({ error: { message: 'Email already registered' } }));

    await component.onSubmit();

    expect(component.error()).toBe('Email already registered');
    expect(component.submitted()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `LoginComponent`/`SignupComponent` do not exist yet.

- [ ] **Step 3: Implement Login**

Create `src/app/features/auth/login.component.html`:

```html
<form class="auth-form" (ngSubmit)="onSubmit()">
  <h1>Sign In</h1>
  @if (error()) {
    <p-message severity="error" [text]="error()!" />
  }
  <input pInputText type="email" placeholder="Email" [(ngModel)]="email" name="email" required />
  <input pInputText type="password" placeholder="Password" [(ngModel)]="password" name="password" required />
  <button pButton type="submit" label="Sign In" [disabled]="submitting()"></button>
  <a routerLink="/signup">Need an account? Sign up</a>
</form>
```

Create `src/app/features/auth/login.component.ts`:

```ts
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, MessageModule, RouterLink],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  email = '';
  password = '';
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly router: Router,
  ) {}

  async onSubmit(): Promise<void> {
    this.submitting.set(true);
    this.error.set(null);
    const { error } = await this.supabase.client.auth.signInWithPassword({
      email: this.email,
      password: this.password,
    });
    this.submitting.set(false);
    if (error) {
      this.error.set(error.message);
      return;
    }
    this.router.navigateByUrl('/');
  }
}
```

- [ ] **Step 4: Implement Signup**

Create `src/app/features/auth/signup.component.html`:

```html
<form class="auth-form" (ngSubmit)="onSubmit()">
  <h1>Sign Up</h1>
  @if (error()) {
    <p-message severity="error" [text]="error()!" />
  }
  @if (submitted()) {
    <p-message severity="success" text="Check your email to verify your account." />
  } @else {
    <input pInputText type="text" placeholder="Display name" [(ngModel)]="displayName" name="displayName" required />
    <input pInputText type="email" placeholder="Email" [(ngModel)]="email" name="email" required />
    <input pInputText type="password" placeholder="Password" [(ngModel)]="password" name="password" required />
    <button pButton type="submit" label="Sign Up"></button>
  }
  <a routerLink="/login">Already have an account? Sign in</a>
</form>
```

Create `src/app/features/auth/signup.component.ts`:

```ts
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, MessageModule, RouterLink],
  templateUrl: './signup.component.html',
})
export class SignupComponent {
  email = '';
  password = '';
  displayName = '';
  readonly error = signal<string | null>(null);
  readonly submitted = signal(false);

  constructor(private readonly supabase: SupabaseService) {}

  async onSubmit(): Promise<void> {
    this.error.set(null);
    const { error } = await this.supabase.client.auth.signUp({
      email: this.email,
      password: this.password,
      options: { data: { display_name: this.displayName } },
    });
    if (error) {
      this.error.set(error.message);
      return;
    }
    this.submitted.set(true);
  }
}
```

Update `src/app/app.routes.ts`:

```ts
import { Routes } from '@angular/router';
import { FinderComponent } from './features/finder/finder.component';
import { LoginComponent } from './features/auth/login.component';
import { SignupComponent } from './features/auth/signup.component';

export const routes: Routes = [
  { path: '', component: FinderComponent },
  { path: 'login', component: LoginComponent },
  { path: 'signup', component: SignupComponent },
];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/auth src/app/app.routes.ts
git commit -m "Add Supabase email/password login and signup"
```

---

## Task 12: Favorites Service + Toggle Button

**Files:**
- Create: `src/app/core/services/favorites.service.ts`
- Create: `src/app/shared/favorite-toggle/favorite-toggle.component.ts`
- Modify: `src/app/features/finder/campground-table/campground-table.component.ts`
- Test: `src/app/core/services/favorites.service.spec.ts`
- Test: `src/app/shared/favorite-toggle/favorite-toggle.component.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService` (Task 5).
- Produces: `FavoritesService` with `favoriteIds: Signal<Set<string>>`, `loadFavoriteIds(): Promise<void>`, `toggleFavorite(campgroundId: string): Promise<void>` — consumed by `FavoriteToggleComponent` here and `FavoritesComponent` (Task 13).

- [ ] **Step 1: Write the failing service tests**

Create `src/app/core/services/favorites.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { FavoritesService } from './favorites.service';
import { SupabaseService } from './supabase.service';

function createSupabaseTableMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  builder.select = jasmine.createSpy().and.returnValue(builder);
  builder.delete = jasmine.createSpy().and.returnValue(builder);
  builder.insert = jasmine.createSpy().and.returnValue(builder);
  builder.eq = jasmine.createSpy().and.returnValue(builder);
  builder.then = (resolve: any) => resolve(result);
  return builder;
}

describe('FavoritesService', () => {
  let service: FavoritesService;
  let fromSpy: jasmine.Spy;

  beforeEach(() => {
    fromSpy = jasmine.createSpy('from');
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
    fromSpy.and.returnValue(createSupabaseTableMock({ data: [{ campground_id: 'cg-1' }], error: null }));

    await service.loadFavoriteIds();

    expect(service.favoriteIds().has('cg-1')).toBe(true);
  });

  it('adds a campground to favorites when not already favorited', async () => {
    fromSpy.and.returnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.toggleFavorite('cg-2');

    expect(service.favoriteIds().has('cg-2')).toBe(true);
  });

  it('removes a campground from favorites when already favorited', async () => {
    service.favoriteIds.set(new Set(['cg-3']));
    fromSpy.and.returnValue(createSupabaseTableMock({ data: null, error: null }));

    await service.toggleFavorite('cg-3');

    expect(service.favoriteIds().has('cg-3')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `FavoritesService` does not exist yet.

- [ ] **Step 3: Implement the service**

Create `src/app/core/services/favorites.service.ts`:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly supabase = inject(SupabaseService);
  readonly favoriteIds = signal<Set<string>>(new Set());

  async loadFavoriteIds(): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) {
      this.favoriteIds.set(new Set());
      return;
    }
    const { data, error } = await this.supabase.client
      .from('favorites')
      .select('campground_id')
      .eq('user_id', userId);
    if (error) throw error;
    this.favoriteIds.set(new Set((data ?? []).map((row: any) => row.campground_id)));
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
}
```

- [ ] **Step 4: Run the service tests to verify they pass**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 5: Write the failing toggle-button test**

Create `src/app/shared/favorite-toggle/favorite-toggle.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { FavoriteToggleComponent } from './favorite-toggle.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { SupabaseService } from '../../core/services/supabase.service';

describe('FavoriteToggleComponent', () => {
  let component: FavoriteToggleComponent;
  let toggleSpy: jasmine.Spy;

  beforeEach(() => {
    toggleSpy = jasmine.createSpy('toggleFavorite').and.returnValue(Promise.resolve());

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
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `FavoriteToggleComponent` does not exist yet.

- [ ] **Step 7: Implement the toggle button**

Create `src/app/shared/favorite-toggle/favorite-toggle.component.ts`:

```ts
import { Component, Input, OnInit, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { FavoritesService } from '../../core/services/favorites.service';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-favorite-toggle',
  standalone: true,
  imports: [ButtonModule],
  template: `
    @if (supabase.isAuthenticated) {
      <button
        pButton
        [icon]="favorites.favoriteIds().has(campgroundId) ? 'pi pi-heart-fill' : 'pi pi-heart'"
        [text]="true"
        (click)="onToggle()"
      ></button>
    }
  `,
})
export class FavoriteToggleComponent implements OnInit {
  @Input({ required: true }) campgroundId!: string;

  readonly favorites = inject(FavoritesService);
  readonly supabase = inject(SupabaseService);

  ngOnInit(): void {
    if (this.favorites.favoriteIds().size === 0) {
      this.favorites.loadFavoriteIds();
    }
  }

  onToggle(): void {
    this.favorites.toggleFavorite(this.campgroundId);
  }
}
```

- [ ] **Step 8: Wire the toggle into the campgrounds table**

Modify `src/app/features/finder/campground-table/campground-table.component.ts`: add `FavoriteToggleComponent` to `imports`, and add a column to both the header and body templates:

```html
<th></th>
```

```html
<td><app-favorite-toggle [campgroundId]="campground.id" /></td>
```

- [ ] **Step 9: Run the full suite to verify everything still passes**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app/core/services/favorites.service.ts src/app/core/services/favorites.service.spec.ts src/app/shared/favorite-toggle src/app/features/finder/campground-table/campground-table.component.ts
git commit -m "Add FavoritesService and favorite-toggle button"
```

---

## Task 13: Favorites View + App Navigation

**Files:**
- Create: `src/app/features/favorites/favorites.component.ts`
- Create: `src/app/features/favorites/favorites.component.html`
- Create: `src/app/core/guards/auth.guard.ts`
- Modify: `src/app/app.routes.ts`
- Modify: root app component (created by the Task 1 scaffold as `src/app/app.ts`/`app.html`, or `app.component.ts`/`app.component.html` on older CLI versions — edit whichever exists)
- Test: `src/app/features/favorites/favorites.component.spec.ts`
- Test: `src/app/core/guards/auth.guard.spec.ts`

**Interfaces:**
- Consumes: `FavoritesService` (Task 12), `SupabaseService` (Task 5), `CampgroundMapComponent` (Task 8), `CampgroundTableComponent` (Task 9), RPC `get_campgrounds_by_ids` (Task 2).
- Produces: route `'favorites'` → `FavoritesComponent` (guarded), `authGuard: CanActivateFn`.

- [ ] **Step 1: Write the failing guard test**

Create `src/app/core/guards/auth.guard.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { authGuard } from './auth.guard';
import { SupabaseService } from '../services/supabase.service';

describe('authGuard', () => {
  it('allows navigation when authenticated', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { isAuthenticated: true } }],
    });
    const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
    expect(result).toBe(true);
  });

  it('redirects to /login when not authenticated', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { isAuthenticated: false } }],
    });
    const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
    expect(result).not.toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `authGuard` does not exist yet.

- [ ] **Step 3: Implement the guard**

Create `src/app/core/guards/auth.guard.ts`:

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

export const authGuard: CanActivateFn = () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  if (supabase.isAuthenticated) {
    return true;
  }
  return router.parseUrl('/login');
};
```

- [ ] **Step 4: Write the failing FavoritesComponent tests**

Create `src/app/features/favorites/favorites.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { FavoritesComponent } from './favorites.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { SupabaseService } from '../../core/services/supabase.service';

describe('FavoritesComponent', () => {
  it('loads full campground details for each favorited id', async () => {
    const rpcSpy = jasmine.createSpy('rpc').and.returnValue(Promise.resolve({
      data: [{
        id: 'cg-1', park_code: 'acad', name: 'Blackwoods', description: '',
        lat: 44.3, lng: -68.2, amenities: {}, fees: [], reservation_url: '',
        directions_url: '', images: [], contact: {},
      }],
      error: null,
    }));

    TestBed.configureTestingModule({
      imports: [FavoritesComponent],
      providers: [
        {
          provide: FavoritesService,
          useValue: { loadFavoriteIds: () => Promise.resolve(), favoriteIds: () => new Set(['cg-1']) },
        },
        { provide: SupabaseService, useValue: { client: { rpc: rpcSpy } } },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;
    await component.ngOnInit();

    expect(rpcSpy).toHaveBeenCalledWith('get_campgrounds_by_ids', { campground_ids: ['cg-1'] });
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
        { provide: SupabaseService, useValue: { client: { rpc: jasmine.createSpy() } } },
      ],
    });

    const component = TestBed.createComponent(FavoritesComponent).componentInstance;
    await component.ngOnInit();

    expect(component.campgrounds()).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `FavoritesComponent` does not exist yet.

- [ ] **Step 6: Implement FavoritesComponent**

Create `src/app/features/favorites/favorites.component.html`:

```html
<div class="finder-layout">
  <app-campground-map [campgrounds]="campgrounds()" [selectedId]="selected()?.id ?? null" />
  <app-campground-table
    [campgrounds]="campgrounds()"
    [selected]="selected()"
    (selectedChange)="onSelectionChange($event)"
  />
</div>
@if (campgrounds().length === 0) {
  <p>No favorites yet. Star a campground from the Finder to save it here.</p>
}
```

Create `src/app/features/favorites/favorites.component.ts`:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { CampgroundMapComponent } from '../finder/campground-map/campground-map.component';
import { CampgroundTableComponent } from '../finder/campground-table/campground-table.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [CampgroundMapComponent, CampgroundTableComponent],
  templateUrl: './favorites.component.html',
})
export class FavoritesComponent implements OnInit {
  private readonly favorites = inject(FavoritesService);
  private readonly supabase = inject(SupabaseService);

  readonly campgrounds = signal<Campground[]>([]);
  readonly selected = signal<Campground | null>(null);

  async ngOnInit(): Promise<void> {
    await this.favorites.loadFavoriteIds();
    const ids = Array.from(this.favorites.favoriteIds());
    if (ids.length === 0) {
      this.campgrounds.set([]);
      return;
    }
    const { data, error } = await this.supabase.client.rpc('get_campgrounds_by_ids', {
      campground_ids: ids,
    });
    if (error) throw error;
    this.campgrounds.set((data ?? []).map((row: any) => ({
      id: row.id,
      parkCode: row.park_code,
      name: row.name,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      amenities: row.amenities ?? {},
      fees: row.fees ?? [],
      reservationUrl: row.reservation_url,
      directionsUrl: row.directions_url,
      images: row.images ?? [],
      contact: row.contact,
      distanceMeters: 0,
    })));
  }

  onSelectionChange(campground: Campground | null): void {
    this.selected.set(campground);
  }
}
```

- [ ] **Step 7: Wire routing and navigation**

Update `src/app/app.routes.ts`:

```ts
import { Routes } from '@angular/router';
import { FinderComponent } from './features/finder/finder.component';
import { FavoritesComponent } from './features/favorites/favorites.component';
import { LoginComponent } from './features/auth/login.component';
import { SignupComponent } from './features/auth/signup.component';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', component: FinderComponent },
  { path: 'favorites', component: FavoritesComponent, canActivate: [authGuard] },
  { path: 'login', component: LoginComponent },
  { path: 'signup', component: SignupComponent },
];
```

Edit the root app component's template (`src/app/app.html` or `src/app/app.component.html`) to add navigation, replacing its existing content with:

```html
<nav class="app-nav">
  <a routerLink="/">Finder</a>
  <a routerLink="/favorites">Favorites</a>
  @if (supabase.isAuthenticated) {
    <button pButton [text]="true" label="Sign out" (click)="onSignOut()"></button>
  } @else {
    <a routerLink="/login">Sign in</a>
  }
</nav>
<router-outlet />
```

Edit the root app component's class (`src/app/app.ts` or `src/app/app.component.ts`) to add:

```ts
import { RouterLink, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { inject } from '@angular/core';
import { SupabaseService } from './core/services/supabase.service';

// add RouterLink, ButtonModule to the component's `imports` array (RouterOutlet is likely already there)

readonly supabase = inject(SupabaseService);

onSignOut(): void {
  this.supabase.client.auth.signOut();
}
```

- [ ] **Step 8: Run the full suite to verify everything passes**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/features/favorites src/app/core/guards src/app/app.routes.ts src/app/app.html src/app/app.ts src/app/app.component.html src/app/app.component.ts
git commit -m "Add Favorites view, auth guard, and app navigation"
```

(Only the root-component files that actually exist in your scaffold will be staged — `git add` silently ignores nonexistent paths.)

---

## Task 14: Campground Detail View

**Files:**
- Create: `src/app/features/campground-detail/campground-detail.component.ts`
- Create: `src/app/features/campground-detail/campground-detail.component.html`
- Modify: `src/app/app.routes.ts`
- Modify: `src/app/features/finder/campground-table/campground-table.component.ts`
- Test: `src/app/features/campground-detail/campground-detail.component.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService` (Task 5), RPC `get_campgrounds_by_ids` (Task 2), `FavoriteToggleComponent` (Task 12).
- Produces: route `'campground/:id'` → `CampgroundDetailComponent`.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/campground-detail/campground-detail.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { CampgroundDetailComponent } from './campground-detail.component';
import { SupabaseService } from '../../core/services/supabase.service';

describe('CampgroundDetailComponent', () => {
  it('loads the campground matching the route id', async () => {
    const rpcSpy = jasmine.createSpy('rpc').and.returnValue(Promise.resolve({
      data: [{
        id: 'cg-1', park_code: 'acad', name: 'Blackwoods', description: 'desc',
        lat: 44.3, lng: -68.2, amenities: {}, fees: [], reservation_url: 'https://x',
        directions_url: 'https://y', images: [], contact: {},
      }],
      error: null,
    }));

    TestBed.configureTestingModule({
      imports: [CampgroundDetailComponent],
      providers: [
        { provide: SupabaseService, useValue: { client: { rpc: rpcSpy } } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'cg-1' }) } },
        },
      ],
    });

    const component = TestBed.createComponent(CampgroundDetailComponent).componentInstance;
    await component.ngOnInit();

    expect(rpcSpy).toHaveBeenCalledWith('get_campgrounds_by_ids', { campground_ids: ['cg-1'] });
    expect(component.campground()?.name).toBe('Blackwoods');
    expect(component.notFound()).toBe(false);
  });

  it('sets notFound when the RPC returns no rows', async () => {
    const rpcSpy = jasmine.createSpy('rpc').and.returnValue(Promise.resolve({ data: [], error: null }));

    TestBed.configureTestingModule({
      imports: [CampgroundDetailComponent],
      providers: [
        { provide: SupabaseService, useValue: { client: { rpc: rpcSpy } } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'missing' }) } },
        },
      ],
    });

    const component = TestBed.createComponent(CampgroundDetailComponent).componentInstance;
    await component.ngOnInit();

    expect(component.notFound()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `CampgroundDetailComponent` does not exist yet.

- [ ] **Step 3: Implement the component**

Create `src/app/features/campground-detail/campground-detail.component.html`:

```html
@if (campground(); as c) {
  <article class="campground-detail">
    <h1>{{ c.name }}</h1>
    <app-favorite-toggle [campgroundId]="c.id" />
    <p>{{ c.description }}</p>
    <a [href]="c.reservationUrl" target="_blank" rel="noopener">Reserve on recreation.gov</a>
    <a [href]="c.directionsUrl" target="_blank" rel="noopener">Directions</a>
  </article>
} @else if (notFound()) {
  <p>Campground not found.</p>
}
```

Create `src/app/features/campground-detail/campground-detail.component.ts`:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { FavoriteToggleComponent } from '../../shared/favorite-toggle/favorite-toggle.component';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-campground-detail',
  standalone: true,
  imports: [FavoriteToggleComponent],
  templateUrl: './campground-detail.component.html',
})
export class CampgroundDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SupabaseService);

  readonly campground = signal<Campground | null>(null);
  readonly notFound = signal(false);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.notFound.set(true);
      return;
    }
    const { data, error } = await this.supabase.client.rpc('get_campgrounds_by_ids', {
      campground_ids: [id],
    });
    if (error || !data || data.length === 0) {
      this.notFound.set(true);
      return;
    }
    const row = data[0];
    this.campground.set({
      id: row.id,
      parkCode: row.park_code,
      name: row.name,
      description: row.description,
      lat: row.lat,
      lng: row.lng,
      amenities: row.amenities ?? {},
      fees: row.fees ?? [],
      reservationUrl: row.reservation_url,
      directionsUrl: row.directions_url,
      images: row.images ?? [],
      contact: row.contact,
      distanceMeters: 0,
    });
  }
}
```

- [ ] **Step 4: Wire routing and a link from the table**

Update `src/app/app.routes.ts` to add:

```ts
import { CampgroundDetailComponent } from './features/campground-detail/campground-detail.component';

// add to the routes array:
{ path: 'campground/:id', component: CampgroundDetailComponent },
```

Modify `src/app/features/finder/campground-table/campground-table.component.ts`: add `RouterLink` to `imports`, and wrap the name cell:

```html
<td><a [routerLink]="['/campground', campground.id]">{{ campground.name }}</a></td>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/campground-detail src/app/app.routes.ts src/app/features/finder/campground-table/campground-table.component.ts
git commit -m "Add campground detail view with route link from the table"
```

---

## Task 15: PWA

**Files:**
- Create: `public/manifest.webmanifest`, `ngsw-config.json`, icon assets (all generated by `ng add @angular/pwa`)
- Modify: `src/app/app.config.ts` (service worker provider, added automatically by the schematic)
- Modify: `src/index.html` (manifest link, added automatically)

- [ ] **Step 1: Add the PWA schematic**

Run: `npx ng add @angular/pwa`

If prompted for a project name, choose `campsite-finder`.

- [ ] **Step 2: Verify the manifest and service worker config were generated**

Confirm `public/manifest.webmanifest` and `ngsw-config.json` now exist, and that `src/app/app.config.ts` has a `provideServiceWorker(...)` entry added to `providers`.

- [ ] **Step 3: Verify a production build succeeds with the service worker enabled**

Run: `npx ng build`
Expected: build succeeds; output includes `ngsw.json` and `ngsw-worker.js` in `dist/`.

- [ ] **Step 4: Run the full test suite one final time**

Run: `npm test -- --watch=false --browsers=ChromeHeadless`
Expected: all specs across every task pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add PWA support (manifest, service worker)"
```

---

## Self-Review Notes

- **Spec coverage:** architecture (Tasks 1, 5), data model + PostGIS (Task 2), NPS sync (Tasks 3–4), geolocation with manual fallback (Tasks 6, 10), map+table synced view (Tasks 8–10), auth (Task 11), favorites (Tasks 12–13), campground detail (Task 14), PWA (Task 15). All spec sections are covered.
- **Type consistency:** `Campground`, `Coordinates`, and RPC row shapes (`id, park_code, name, description, lat, lng, amenities, fees, reservation_url, directions_url, images, contact[, distance_m]`) are used identically across Tasks 2, 7, 12, 13, and 14.
- **Deferred/out of scope, per the spec:** native app, live site-availability, push notifications, social features. Not scheduled in any task above.
