# Multi-Agency Federal Campground Data (RIDB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add USFS/BLM/USACE/FWS campgrounds to CampsiteFinder via a new `ridb-sync` Edge Function, and let users filter/see which agency manages each campground.

**Architecture:** A new `ridb-sync` Edge Function mirrors `nps-sync`'s structure exactly (paginated fetch, transform, idempotent upsert, log-and-retain error handling), writing into the same `campgrounds` table under a `ridb:`-prefixed id namespace. Two migrations add `agency`/`source` columns and extend the two existing RPCs with an `agency_filter` param. The frontend gains an `agency` field end-to-end and a PrimeNG multi-select filter above the Finder table.

**Tech Stack:** Same as the rest of this app — Angular 22 standalone components + signals, PrimeNG 22, `@supabase/supabase-js`, Deno (Edge Functions), Vitest for Angular tests, `deno test` for Edge Function tests.

**Spec:** `docs/superpowers/specs/2026-08-28-ridb-multi-agency-campground-design.md` (see also the companion `2026-08-28-ridb-midwest-analysis.md`).

## Decisions Made While Planning (spec's Open Questions, resolved)

- **State list:** scope this phase's RIDB sync to the US Census Bureau Midwest region — `IL, IN, IA, KS, MI, MN, MO, NE, ND, OH, SD, WI` — matching the root-cause analysis this whole feature exists to address. Encoded as a `MIDWEST_STATES` constant in `ridb-sync/index.ts`; widening later is a one-line change, not a new design.
- **Null `park_code`:** widen `Campground.parkCode` to `string | null`. Grep confirms only two display sites (`campground-table.component.ts`, `trip-detail.component.html`), both plain `{{ campground.parkCode }}` interpolation — Angular renders `null` as empty string, no template guard needed, no NPS-specific park-code link exists anywhere to break.
- **Agency resolution field:** RIDB's `/facilities?full=true` response nests a `ORGANIZATION` array per facility with an `OrgAbbrevName` field (e.g. `"USFS"`, `"BLM"`) — cleaner than parsing `OrgName` strings like "USDA Forest Service" as the spec's draft suggested. Confirmed via RIDB's published OpenAPI model (`Organization.org_abbrev_name`); exact JSON casing (`FacilityID`, `LastUpdatedDate`, `ORGANIZATION`, `RECDATA`/`METADATA` envelope) cross-confirmed against a real RIDB response example. Camping activity ID is `9`. Auth is an `apikey` request header, not a query param (unlike NPS's `api_key=`).
- **`nps-sync` cron schedule:** confirmed (again) there is no `config.toml`, no scheduled workflow, no `pg_cron` migration anywhere in this repo — it's out-of-band in the Supabase dashboard. `ridb-sync`'s schedule is therefore a manual dashboard step, documented in Task 9, not an in-repo artifact.
- **nps-sync is untouched:** migration 0009 gives `agency`/`source` `not null default` values, so existing `nps-sync` upserts (which never include those columns in their payload) are unaffected — no task in this plan modifies `nps-sync/*`.
- **Testing shape:** the spec asks for "a sample fixture RIDB `/facilities` response... for the sync's upsert/paging logic, matching how `nps-sync` is tested today." Checked: `nps-sync` has no test for its paging/upsert loop (`index.ts`) at all — only `transform.ts` is unit-tested. This plan follows the *actual* precedent rather than the spec's slightly-idealized description of it: Task 4's `transform.test.ts` embeds the USFS/BLM/USACE/bad-org/already-NPS coverage the spec wants directly as facility-object fixtures, and no `index.ts`-level integration test is added.

## Global Constraints

- Additive only — do not modify `supabase/functions/nps-sync/*` or existing NPS rows (spec Goals).
- RIDB rows use id = `'ridb:' || FacilityID`; `park_code` is left `null` for RIDB rows (spec Data Model Changes).
- Only agencies `USFS`, `BLM`, `USACE`, `FWS` are imported; any RIDB facility whose resolved agency is `NPS` (or unresolvable) is skipped, not fatal to the run (spec Out of Scope / Error Handling).
- Sync failures are logged and existing data is retained — no partial wipes (spec Error Handling), matching `nps-sync`'s existing `catch` behavior exactly.
- Out of scope this phase: state-park/DNR data, NPS/RIDB dedup, live per-site booking availability (spec Out of Scope) — do not build any of this.
- Supabase project id for all MCP tool calls: `jpiicvvnipsckkhgjinn`.
- No RLS policy changes needed anywhere in this plan — `campgrounds`' existing "anyone can read" policy already covers the new columns, and only the service-role key (used by `ridb-sync`, same as `nps-sync`) ever writes to the table.

## File Structure

- `supabase/migrations/0009_ridb_agency_columns.sql` — new: `agency`/`source` columns, nullable `park_code`.
- `supabase/migrations/0010_ridb_agency_filter_rpcs.sql` — new: drop/recreate `nearest_campgrounds` and `get_campgrounds_by_ids` with `agency` in the result and an `agency_filter` param.
- `supabase/functions/ridb-sync/agency.ts` — new: RIDB org → agency-code resolution.
- `supabase/functions/ridb-sync/agency.test.ts` — new.
- `supabase/functions/ridb-sync/transform.ts` — new: RIDB facility → `CampgroundRow`.
- `supabase/functions/ridb-sync/transform.test.ts` — new.
- `supabase/functions/ridb-sync/index.ts` — new: the sync loop (mirrors `nps-sync/index.ts`).
- `src/app/core/models/campground.model.ts` — modify: add `agency`, widen `parkCode`.
- `src/app/core/services/campgrounds.service.ts` — modify: pass through `agency`, add `agencies?` param.
- `src/app/core/services/campgrounds.service.spec.ts` — modify.
- `src/app/features/finder/campground-table/campground-table.component.ts` — modify: add Agency column.
- `src/app/features/finder/campground-table/campground-table.component.spec.ts` — modify.
- `src/app/features/finder/finder.component.ts` — modify: agency filter state + reload.
- `src/app/features/finder/finder.component.html` — modify: `p-multiselect` filter control.
- `src/app/features/finder/finder.component.spec.ts` — modify.

---

## Task 1: Migration — `agency`/`source` columns

**Files:**
- Create: `supabase/migrations/0009_ridb_agency_columns.sql`

**Interfaces:**
- Produces: `public.campgrounds.agency text not null default 'NPS'`, `public.campgrounds.source text not null default 'nps'`, `public.campgrounds.park_code` now nullable, index `campgrounds_agency_idx`. Consumed by Task 2 (RPCs), Task 5 (`ridb-sync` writes `agency`/`source` on every row it upserts).

- [ ] **Step 1: Confirm the next migration number is still free**

Run: `ls supabase/migrations/`
Expected: highest existing file is `0008_campground_admin.sql` — `0009` is free. If not, renumber this task's file to the next free number and adjust Task 2 to follow it.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0009_ridb_agency_columns.sql`:

```sql
alter table public.campgrounds
  add column agency text not null default 'NPS',
  add column source text not null default 'nps',
  alter column park_code drop not null;

create index campgrounds_agency_idx on public.campgrounds (agency);
```

- [ ] **Step 3: Apply the migration**

Using `mcp__claude_ai_Supabase__apply_migration`, apply the SQL above to project `jpiicvvnipsckkhgjinn` as migration `0009_ridb_agency_columns` (adjust the number if Step 1 found a later one already taken).

- [ ] **Step 4: Verify the schema change**

Using `mcp__claude_ai_Supabase__execute_sql` against project `jpiicvvnipsckkhgjinn`, run:

```sql
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'campgrounds'
  and column_name in ('agency', 'source', 'park_code')
order by column_name;
```

Expected: `agency` — `is_nullable = 'NO'`, default `'NPS'::text`; `park_code` — `is_nullable = 'YES'`; `source` — `is_nullable = 'NO'`, default `'nps'::text`. Also confirm existing rows were backfilled: `select distinct agency, source from public.campgrounds;` should return exactly one row, `('NPS', 'nps')`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_ridb_agency_columns.sql
git commit -m "Add agency/source columns to campgrounds for RIDB sync"
```

---

## Task 2: Migration — agency-aware RPCs

**Files:**
- Create: `supabase/migrations/0010_ridb_agency_filter_rpcs.sql`

**Interfaces:**
- Consumes: `public.campgrounds.agency` (Task 1).
- Produces: `nearest_campgrounds(user_lat double precision, user_lng double precision, result_limit int default 50, agency_filter text[] default null)` and `get_campgrounds_by_ids(campground_ids text[], agency_filter text[] default null)`, both now returning an `agency text` column. Consumed by Task 6 (`CampgroundsService`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_ridb_agency_filter_rpcs.sql`:

```sql
drop function nearest_campgrounds(double precision, double precision, int);
drop function get_campgrounds_by_ids(text[]);

create function public.nearest_campgrounds(
  user_lat double precision,
  user_lng double precision,
  result_limit int default 50,
  agency_filter text[] default null
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
  where agency_filter is null or c.agency = any(agency_filter)
  order by c.location <-> st_setsrid(st_point(user_lng, user_lat), 4326)::geography
  limit result_limit;
$$;

grant execute on function public.nearest_campgrounds(double precision, double precision, int, text[]) to anon, authenticated;

create function public.get_campgrounds_by_ids(campground_ids text[], agency_filter text[] default null)
returns table (
  id text, park_code text, name text, description text,
  lat double precision, lng double precision, agency text,
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
    c.agency, c.amenities, c.fees, c.reservation_url, c.directions_url,
    c.images, c.contact
  from public.campgrounds c
  where c.id = any(campground_ids)
    and (agency_filter is null or c.agency = any(agency_filter));
$$;

grant execute on function public.get_campgrounds_by_ids(text[], text[]) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration**

Using `mcp__claude_ai_Supabase__apply_migration`, apply the SQL above to project `jpiicvvnipsckkhgjinn` as migration `0010_ridb_agency_filter_rpcs`.

- [ ] **Step 3: Verify the RPC changes**

Using `mcp__claude_ai_Supabase__execute_sql` against project `jpiicvvnipsckkhgjinn`, run:

```sql
select id, name, agency from nearest_campgrounds(44.3, -68.2, 3, null);
select id, name, agency from nearest_campgrounds(44.3, -68.2, 3, array['USFS']);
```

Expected: the first call returns up to 3 existing NPS rows with `agency = 'NPS'`; the second call returns zero rows without erroring (no RIDB data exists yet — this just confirms the filter predicate and the `text[]` param work).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0010_ridb_agency_filter_rpcs.sql
git commit -m "Add agency_filter param and agency column to campground RPCs"
```

---

## Task 3: RIDB agency resolution (`agency.ts`)

**Files:**
- Create: `supabase/functions/ridb-sync/agency.ts`
- Test: `supabase/functions/ridb-sync/agency.test.ts`

**Interfaces:**
- Produces: `RidbOrganization` interface (`OrgAbbrevName?: string`) and `resolveAgency(organizations: RidbOrganization[] | undefined): string | null`. Consumed by Task 4 (`transform.ts`).

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/ridb-sync/agency.test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert";
import { resolveAgency } from "./agency.ts";

Deno.test("resolveAgency maps a known USFS org abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "USFS" }]), "USFS");
});

Deno.test("resolveAgency maps a known BLM org abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "BLM" }]), "BLM");
});

Deno.test("resolveAgency maps a known USACE org abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "USACE" }]), "USACE");
});

Deno.test("resolveAgency maps a known FWS org abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "FWS" }]), "FWS");
});

Deno.test("resolveAgency maps NPS so callers can explicitly skip it", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "NPS" }]), "NPS");
});

Deno.test("resolveAgency is case-insensitive and trims whitespace", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: " usfs \n" }]), "USFS");
});

Deno.test("resolveAgency returns null for an unmapped abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "BOR" }]), null);
});

Deno.test("resolveAgency returns null when ORGANIZATION is missing", () => {
  assertEquals(resolveAgency(undefined), null);
});

Deno.test("resolveAgency returns null when ORGANIZATION is empty", () => {
  assertEquals(resolveAgency([]), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ridb-sync/agency.test.ts`
Expected: FAIL — `agency.ts` does not exist yet (module not found).

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/ridb-sync/agency.ts`:

```typescript
export interface RidbOrganization {
  OrgID?: string;
  OrgName?: string;
  OrgAbbrevName?: string;
}

// RIDB's own abbreviations, keyed uppercase. If a live sync logs an
// unmapped abbreviation for one of the four target agencies, add it here
// rather than guessing — see ridb-sync/index.ts's skipped-count logging.
const ORG_ABBREV_TO_AGENCY: Record<string, string> = {
  USFS: "USFS",
  BLM: "BLM",
  USACE: "USACE",
  FWS: "FWS",
  NPS: "NPS",
};

export function resolveAgency(organizations: RidbOrganization[] | undefined): string | null {
  const abbrev = organizations?.[0]?.OrgAbbrevName?.trim().toUpperCase();
  if (!abbrev) return null;
  return ORG_ABBREV_TO_AGENCY[abbrev] ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ridb-sync/agency.test.ts`
Expected: PASS — 9 tests passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ridb-sync/agency.ts supabase/functions/ridb-sync/agency.test.ts
git commit -m "Add RIDB organization-to-agency resolution"
```

---

## Task 4: RIDB facility → `CampgroundRow` transform

**Files:**
- Create: `supabase/functions/ridb-sync/transform.ts`
- Test: `supabase/functions/ridb-sync/transform.test.ts`

**Interfaces:**
- Consumes: `resolveAgency`, `RidbOrganization` from `./agency.ts` (Task 3).
- Produces: `RidbFacilityRecord` interface, `CampgroundRow` interface (`{ id, park_code: null, name, description, location, agency, source: 'ridb', amenities, fees, reservation_url, directions_url, images, contact }`), and `toCampgroundRow(facility: RidbFacilityRecord): CampgroundRow | null`. Consumed by Task 5 (`index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/ridb-sync/transform.test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert";
import { toCampgroundRow } from "./transform.ts";

Deno.test("toCampgroundRow converts a USFS facility into a namespaced, PostGIS-ready row", () => {
  const facility = {
    FacilityID: "233118",
    FacilityName: "Birch Creek Campground",
    FacilityDescription: "A national forest campground.",
    FacilityLatitude: 46.1234,
    FacilityLongitude: -89.5678,
    FacilityReservationURL: "https://www.recreation.gov/camping/campgrounds/233118",
    FacilityDirections: "Take Forest Road 13 north.",
    FacilityPhone: "715-555-0100",
    FacilityEmail: "info@fs.fed.us",
    ORGANIZATION: [{ OrgID: "131", OrgName: "USDA Forest Service", OrgAbbrevName: "USFS" }],
  };

  const row = toCampgroundRow(facility);

  assertEquals(row?.id, "ridb:233118");
  assertEquals(row?.park_code, null);
  assertEquals(row?.name, "Birch Creek Campground");
  assertEquals(row?.location, "POINT(-89.5678 46.1234)");
  assertEquals(row?.agency, "USFS");
  assertEquals(row?.source, "ridb");
  assertEquals(row?.reservation_url, "https://www.recreation.gov/camping/campgrounds/233118");
});

Deno.test("toCampgroundRow converts a BLM facility", () => {
  const facility = {
    FacilityID: "500200",
    FacilityName: "Lake Vermilion Recreation Area",
    FacilityDescription: "",
    FacilityLatitude: 47.891,
    FacilityLongitude: -92.345,
    ORGANIZATION: [{ OrgID: "121", OrgName: "Bureau of Land Management", OrgAbbrevName: "BLM" }],
  };

  const row = toCampgroundRow(facility);

  assertEquals(row?.id, "ridb:500200");
  assertEquals(row?.agency, "BLM");
});

Deno.test("toCampgroundRow returns null when coordinates are missing", () => {
  const facility = {
    FacilityID: "999",
    FacilityName: "No Coords",
    FacilityDescription: "",
    FacilityLatitude: null,
    FacilityLongitude: null,
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
  };

  assertEquals(toCampgroundRow(facility as any), null);
});

Deno.test("toCampgroundRow returns null when FacilityID is missing", () => {
  const facility = {
    FacilityID: "",
    FacilityName: "No Id",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
  };

  assertEquals(toCampgroundRow(facility), null);
});

Deno.test("toCampgroundRow skips a facility whose resolved agency is NPS (already covered by nps-sync)", () => {
  const facility = {
    FacilityID: "1",
    FacilityName: "Some NPS Facility Also In RIDB",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "NPS" }],
  };

  assertEquals(toCampgroundRow(facility), null);
});

Deno.test("toCampgroundRow skips a facility with an unresolvable/bad organization", () => {
  const facility = {
    FacilityID: "2",
    FacilityName: "Some Facility With A Bad Org",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "BOR" }],
  };

  assertEquals(toCampgroundRow(facility), null);
});

Deno.test("toCampgroundRow defaults optional text fields to empty strings and contact to phone/email", () => {
  const facility = {
    FacilityID: "3",
    FacilityName: "Minimal Facility",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "USACE" }],
  };

  const row = toCampgroundRow(facility as any);

  assertEquals(row?.description, "");
  assertEquals(row?.reservation_url, "");
  assertEquals(row?.directions_url, "");
  assertEquals(row?.contact, { phone: "", email: "" });
  assertEquals(row?.amenities, {});
  assertEquals(row?.fees, []);
  assertEquals(row?.images, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/ridb-sync/transform.test.ts`
Expected: FAIL — `transform.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/ridb-sync/transform.ts`:

```typescript
import { resolveAgency, RidbOrganization } from "./agency.ts";

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
  ORGANIZATION?: RidbOrganization[];
}

export interface CampgroundRow {
  id: string;
  park_code: null;
  name: string;
  description: string;
  location: string; // WKT, e.g. 'POINT(lng lat)'
  agency: string;
  source: "ridb";
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservation_url: string;
  directions_url: string;
  images: unknown[];
  contact: unknown;
}

export function toCampgroundRow(facility: RidbFacilityRecord): CampgroundRow | null {
  if (!facility.FacilityID) return null;

  const lat = facility.FacilityLatitude;
  const lng = facility.FacilityLongitude;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }

  const agency = resolveAgency(facility.ORGANIZATION);
  if (!agency || agency === "NPS") {
    return null;
  }

  return {
    id: `ridb:${facility.FacilityID}`,
    park_code: null,
    name: facility.FacilityName,
    description: facility.FacilityDescription ?? "",
    location: `POINT(${lng} ${lat})`,
    agency,
    source: "ridb",
    amenities: {},
    fees: [],
    reservation_url: facility.FacilityReservationURL ?? "",
    directions_url: facility.FacilityDirections ?? "",
    images: [],
    contact: { phone: facility.FacilityPhone ?? "", email: facility.FacilityEmail ?? "" },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/ridb-sync/transform.test.ts`
Expected: PASS — 7 tests passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ridb-sync/transform.ts supabase/functions/ridb-sync/transform.test.ts
git commit -m "Add RIDB facility to CampgroundRow transform"
```

---

## Task 5: `ridb-sync` Edge Function

**Files:**
- Create: `supabase/functions/ridb-sync/index.ts`

**Interfaces:**
- Consumes: `toCampgroundRow` from `./transform.ts` (Task 4).
- Produces: a deployed `ridb-sync` Edge Function, invoked the same way `nps-sync` is (HTTP trigger / dashboard schedule).

- [ ] **Step 1: Write `index.ts`**

Create `supabase/functions/ridb-sync/index.ts`:

```typescript
import { createClient } from "jsr:@supabase/supabase-js@2";
import { toCampgroundRow } from "./transform.ts";

const RIDB_API_BASE = "https://ridb.recreation.gov/api/v1";
const CAMPING_ACTIVITY_ID = "9";

// US Census Bureau Midwest region — the region this sync exists to cover
// (see docs/superpowers/specs/2026-08-28-ridb-midwest-analysis.md). RIDB's
// `state` param accepts a comma-delimited list; widen this array to expand
// coverage later without any other code change.
const MIDWEST_STATES = ["IL", "IN", "IA", "KS", "MI", "MN", "MO", "NE", "ND", "OH", "SD", "WI"];

Deno.serve(async (_req) => {
  const ridbApiKey = Deno.env.get("RIDB_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!ridbApiKey || !supabaseUrl || !serviceRoleKey) {
    return new Response("Missing required environment variables", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let offset = 0;
  const limit = 50;
  let total = Infinity;
  let upserted = 0;
  let skipped = 0;

  try {
    while (offset < total) {
      const url =
        `${RIDB_API_BASE}/facilities?state=${MIDWEST_STATES.join(",")}` +
        `&activity=${CAMPING_ACTIVITY_ID}&full=true&limit=${limit}&offset=${offset}`;
      const response = await fetch(url, {
        headers: { apikey: ridbApiKey, Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`RIDB API request failed: ${response.status}`);
      }
      const body = await response.json();
      total = body.METADATA.RESULTS.TOTAL_COUNT;

      const rows = body.RECDATA
        .map(toCampgroundRow)
        .filter((row: unknown) => row !== null);
      skipped += body.RECDATA.length - rows.length;

      if (rows.length > 0) {
        const { error } = await supabase.from("campgrounds").upsert(rows);
        if (error) throw error;
        upserted += rows.length;
      }

      offset += limit;
    }

    return new Response(
      JSON.stringify({ upserted, skipped }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("ridb-sync failed, existing data retained:", err);
    return new Response(`Sync failed: ${(err as Error).message}`, { status: 500 });
  }
});
```

- [ ] **Step 2: Type-check it**

Run: `deno check supabase/functions/ridb-sync/index.ts`
Expected: no errors (this mirrors `nps-sync/index.ts` structurally; `deno check` follows the `toCampgroundRow` import and the `jsr:@supabase/supabase-js@2` types).

- [ ] **Step 3: Manual prerequisite — get an RIDB API key and set the secret**

This step needs you (Shawn), not the agent: sign up for a free API key at `ridb.recreation.gov`, then set it as a Supabase Edge Function secret named `RIDB_API_KEY` for project `jpiicvvnipsckkhgjinn` (Supabase Dashboard → Edge Functions → Secrets — same place `NPS_API_KEY` already lives). `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected and need no setup, matching `nps-sync`.

- [ ] **Step 4: Deploy**

Using `mcp__claude_ai_Supabase__deploy_edge_function`, deploy `ridb-sync` to project `jpiicvvnipsckkhgjinn`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ridb-sync/index.ts
git commit -m "Add ridb-sync Edge Function"
```

---

## Task 6: `Campground` model + `CampgroundsService` — agency field and filter

**Files:**
- Modify: `src/app/core/models/campground.model.ts`
- Modify: `src/app/core/services/campgrounds.service.ts`
- Test: `src/app/core/services/campgrounds.service.spec.ts`

**Interfaces:**
- Consumes: `nearest_campgrounds`/`get_campgrounds_by_ids` RPCs now returning `agency` and accepting `agency_filter` (Task 2).
- Produces: `Campground.agency: string`, `Campground.parkCode: string | null`; `CampgroundsService.getNearest(coords, limit?, agencies?: string[]): Promise<Campground[]>`; `CampgroundsService.getByIds(ids, agencies?: string[]): Promise<Campground[]>`. Consumed by Task 7 (table), Task 8 (Finder filter).

- [ ] **Step 1: Update the model**

Edit `src/app/core/models/campground.model.ts`:

```typescript
export interface Campground {
  id: string;
  parkCode: string | null;
  name: string;
  description: string;
  lat: number;
  lng: number;
  agency: string;
  amenities: Record<string, unknown>;
  fees: unknown[];
  reservationUrl: string;
  directionsUrl: string;
  images: unknown[];
  contact: unknown;
  distanceMeters: number;
}
```

- [ ] **Step 2: Update the failing tests first**

Edit `src/app/core/services/campgrounds.service.spec.ts` — update the two RPC-mapping tests:

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
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: null,
    });
    expect(result[0].name).toBe('Blackwoods');
    expect(result[0].agency).toBe('NPS');
    expect(result[0].distanceMeters).toBe(1200);
  });
```

Add a new test for the agency filter being forwarded:

```typescript
  it('forwards an agency filter to the RPC', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });

    await service.getNearest({ lat: 44.3, lng: -68.1 }, 50, ['USFS', 'BLM']);

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: ['USFS', 'BLM'],
    });
  });
```

Update the `getByIds` mapping test:

```typescript
  it('maps RPC rows to Campground objects for getByIds', async () => {
    rpcSpy.mockResolvedValue({
      data: [{
        id: 'cg-1', park_code: 'acad', name: 'Blackwoods', description: 'desc',
        lat: 44.31, lng: -68.2, agency: 'NPS', amenities: {}, fees: [], reservation_url: 'https://x',
        directions_url: 'https://y', images: [], contact: {},
      }],
      error: null,
    });

    const result = await service.getByIds(['cg-1']);

    expect(rpcSpy).toHaveBeenCalledWith('get_campgrounds_by_ids', {
      campground_ids: ['cg-1'], agency_filter: null,
    });
    expect(result[0].name).toBe('Blackwoods');
    expect(result[0].agency).toBe('NPS');
    expect(result[0].distanceMeters).toBe(0);
  });
```

Leave the two error-path tests (`throws when the RPC call errors`, `throws when the getByIds RPC call errors`) and the `searchByName` tests unchanged — they don't assert call args.

- [ ] **Step 3: Run tests to verify the new/changed ones fail**

Run: `npx ng test --watch=false`
Expected: FAIL on the tests just edited — `CampgroundsService` doesn't send `agency_filter` yet, and `result[0].agency` is `undefined`.

- [ ] **Step 4: Update the implementation**

Edit `src/app/core/services/campgrounds.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Campground } from '../models/campground.model';
import { Coordinates } from './geolocation.service';

@Injectable({ providedIn: 'root' })
export class CampgroundsService {
  private readonly supabase = inject(SupabaseService);

  async getNearest(coords: Coordinates, limit = 50, agencies?: string[]): Promise<Campground[]> {
    const { data, error } = await this.supabase.client.rpc('nearest_campgrounds', {
      user_lat: coords.lat,
      user_lng: coords.lng,
      result_limit: limit,
      agency_filter: agencies ?? null,
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

  async getByIds(ids: string[], agencies?: string[]): Promise<Campground[]> {
    const { data, error } = await this.supabase.client.rpc('get_campgrounds_by_ids', {
      campground_ids: ids,
      agency_filter: agencies ?? null,
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
      distanceMeters: 0,
    }));
  }

  async searchByName(query: string): Promise<{ id: string; name: string }[]> {
    const { data, error } = await this.supabase.client
      .from('campgrounds')
      .select('id, name')
      .ilike('name', `%${query}%`)
      .limit(20);
    if (error) throw error;
    return data ?? [];
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS — all `CampgroundsService` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/models/campground.model.ts src/app/core/services/campgrounds.service.ts src/app/core/services/campgrounds.service.spec.ts
git commit -m "Add agency field and agency filter param to Campground model/service"
```

---

## Task 7: Agency column in the campground table

**Files:**
- Modify: `src/app/features/finder/campground-table/campground-table.component.ts`
- Test: `src/app/features/finder/campground-table/campground-table.component.spec.ts`

**Interfaces:**
- Consumes: `Campground.agency` (Task 6).

- [ ] **Step 1: Write the failing test**

Add to `src/app/features/finder/campground-table/campground-table.component.spec.ts`:

```typescript
  it('shows the Agency column with each campground\'s agency', () => {
    component.campgrounds = [{ id: '1', name: 'A', parkCode: null, agency: 'USFS' } as any];
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Agency');
    expect(text).toContain('USFS');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — no "Agency" column exists yet.

- [ ] **Step 3: Add the column**

Edit `src/app/features/finder/campground-table/campground-table.component.ts` — in the `#header` template, add after the Park column:

```html
          <th pSortableColumn="parkCode">Park <p-sort-icon field="parkCode" /></th>
          <th pSortableColumn="agency">Agency <p-sort-icon field="agency" /></th>
```

And in the `#body` template, add after the Park cell:

```html
          <td>{{ campground.parkCode }}</td>
          <td>{{ campground.agency }}</td>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/finder/campground-table/campground-table.component.ts src/app/features/finder/campground-table/campground-table.component.spec.ts
git commit -m "Show managing agency in the campground table"
```

---

## Task 8: Agency filter in the Finder view

**Files:**
- Modify: `src/app/features/finder/finder.component.ts`
- Modify: `src/app/features/finder/finder.component.html`
- Test: `src/app/features/finder/finder.component.spec.ts`

**Interfaces:**
- Consumes: `CampgroundsService.getNearest(coords, limit?, agencies?)` (Task 6).
- Produces: `FinderComponent.ALL_AGENCIES: string[]`, `FinderComponent.selectedAgencies: string[]`, `FinderComponent.onAgencyFilterChange(): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/features/finder/finder.component.spec.ts`:

```typescript
  it('defaults to all agencies selected', () => {
    expect(component.selectedAgencies).toEqual(component.ALL_AGENCIES);
  });

  it('reloads with the selected agencies and the last-used coordinates when the filter changes', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.selectedAgencies = ['USFS'];
    await component.onAgencyFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 }, 50, ['USFS'],
    );
  });

  it('does not reload on filter change before any coordinates have been resolved', async () => {
    await component.onAgencyFilterChange();

    expect(campgroundsSpy.getNearest).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `selectedAgencies`/`ALL_AGENCIES`/`onAgencyFilterChange` don't exist yet.

- [ ] **Step 3: Update the component**

Edit `src/app/features/finder/finder.component.ts`:

```typescript
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { MultiSelectModule } from 'primeng/multiselect';
import { CampgroundMapComponent } from './campground-map/campground-map.component';
import { CampgroundTableComponent } from './campground-table/campground-table.component';
import { GeolocationService, Coordinates } from '../../core/services/geolocation.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { Campground } from '../../core/models/campground.model';

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
      const results = await this.campgroundsService.getNearest(location, 50, this.selectedAgencies);
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

  onAgencyFilterChange(): Promise<void> {
    return this.lastCoords ? this.loadNearest(this.lastCoords) : Promise.resolve();
  }

  onSelectionChange(campground: Campground | null): void {
    this.selected.set(campground);
  }
}
```

- [ ] **Step 4: Add the filter control to the template**

Edit `src/app/features/finder/finder.component.html`:

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

  @if (!loading() && !error()) {
    <div class="agency-filter">
      <p-multiselect
        [options]="ALL_AGENCIES"
        [(ngModel)]="selectedAgencies"
        (onChange)="onAgencyFilterChange()"
        placeholder="Filter by agency"
        name="agencyFilter"
      />
    </div>
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
Expected: PASS — all `FinderComponent` tests green, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/finder/finder.component.ts src/app/features/finder/finder.component.html src/app/features/finder/finder.component.spec.ts
git commit -m "Add agency multi-select filter to the Finder view"
```

---

## Task 9: Final Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite and build**

```bash
npx ng test --watch=false
npx ng build
deno test supabase/functions/ridb-sync/agency.test.ts
deno test supabase/functions/ridb-sync/transform.test.ts
deno test supabase/functions/nps-sync/transform.test.ts
```

Expected: all PASS, build succeeds with no errors. The `nps-sync` test run is a regression check confirming Task 1's migration didn't require any `nps-sync` code change.

- [ ] **Step 2: Confirm the RIDB field-name assumptions against the live API**

This plan's transform (Task 4) was built from RIDB's published OpenAPI model plus a cross-confirmed real response example, not a live call with a real key (no key was available while planning). Once the `RIDB_API_KEY` secret from Task 5 Step 3 is set, run one manual request to sanity-check before trusting a full sync:

```bash
curl -s -H "apikey: $RIDB_API_KEY" -H "Accept: application/json" \
  "https://ridb.recreation.gov/api/v1/facilities?state=WI&activity=9&full=true&limit=1" | head -c 2000
```

Confirm the response has the `METADATA.RESULTS.TOTAL_COUNT` / `RECDATA` envelope, and that a `RECDATA[0]` entry has `FacilityID`, `FacilityLatitude`, `FacilityLongitude`, and an `ORGANIZATION` array with `OrgAbbrevName`. If any field name differs, fix `transform.ts`/`agency.ts` (Tasks 3–4) and their tests before relying on a real sync run — do not silently patch `index.ts` around a mismatch.

- [ ] **Step 3: Manually invoke `ridb-sync` once and inspect the result**

Invoke the deployed `ridb-sync` function (e.g. via the Supabase Dashboard's "Invoke" button, or `curl` with the anon/service key as a bearer token). Expected JSON body: `{"upserted": N, "skipped": M}` with `N > 0` for at least Wisconsin/Michigan/Minnesota (dense with national-forest and Corps-of-Engineers campgrounds per the root-cause analysis). Then verify in the database:

```sql
select agency, count(*) from public.campgrounds group by agency order by agency;
```

Expected: `NPS` count unchanged from before this plan, plus new nonzero counts for `USFS`/`BLM`/`USACE`/`FWS` (BLM will likely be the smallest, per the midwest-analysis doc).

- [ ] **Step 4: Manual end-to-end pass in the browser**

Run `npx ng serve`, open the Finder view.

1. Confirm the table now has an "Agency" column and it's populated for every row (not blank).
2. Confirm campgrounds outside NPS units now appear on the map/table in Midwest states (the whole point of this feature) — compare against the sparse pre-change view if you can recall it.
3. Use the agency multi-select to deselect everything except "USFS" — confirm both the map and table update to show only USFS campgrounds, and that deselecting all agencies shows zero results (not "no filter").
4. Re-select all agencies — confirm the full set returns.
5. Click into a RIDB-sourced campground's detail view (if one is linked from the table) — confirm nothing crashes on a `null` `parkCode`.
6. Check the browser console for errors at every step above.

- [ ] **Step 5: Schedule `ridb-sync` (manual, dashboard)**

There is no in-repo cron artifact for `nps-sync` to copy (confirmed during planning — no `config.toml`, no scheduled workflow, no `pg_cron` migration exists anywhere in this repo). In the Supabase Dashboard, add a scheduled invocation for `ridb-sync` the same way `nps-sync`'s existing schedule is configured (check Edge Functions → `nps-sync` → its trigger/schedule settings, or Database → Cron Jobs, to see which mechanism is actually in use, then mirror it). A weekly cadence matches `nps-sync`'s (RIDB facility data changes about as rarely, per the design doc). Once found, consider a short follow-up note or migration documenting it in-repo so this stops being tribal knowledge — out of scope for this plan, but worth flagging to Shawn.

- [ ] **Step 6: Report results**

Confirm all steps above pass with no console errors before considering this plan complete. If any step fails, treat it as a bug against the specific task that introduced it, not a new task.
