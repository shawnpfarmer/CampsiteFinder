# Finder Amenities & Fees Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users filter the Finder by four amenities (showers, potable water, dump station, toilets) and a fee ceiling (Free / Under $20 / Under $40 / Any), sourced from NPS's already-synced raw data. RIDB rows are unaffected — RIDB has no structured amenity/fee data (confirmed live), so those rows simply carry `null` on all five new columns and are excluded when a filter is active, same as every other "unknown" row.

**Architecture:** Five nullable columns on `campgrounds` (`has_showers`, `has_potable_water`, `has_dump_station`, `has_toilets`, `min_fee_cents`), populated only by `nps-sync/transform.ts` parsing NPS's existing raw `amenities`/`fees` JSONB (real value vocabulary confirmed against live data during planning — see Decisions below). `nearest_campgrounds` and `get_campgrounds_by_ids` both gain filter params for all five. The frontend gains four checkboxes and a price dropdown in the Finder's existing filter row, composing with the agency and radius filters already there.

**Tech Stack:** Same as the rest of this app — Angular 22 standalone components + signals, PrimeNG 22 (`p-checkbox`, `p-select`), `@supabase/supabase-js`, Deno (Edge Functions), Vitest for Angular tests, `deno test` for Edge Function tests.

**Spec:** `docs/superpowers/specs/2026-08-30-campground-filters-design.md` (Amenities Filter and Fees Filter sections; this plan implements those two sections only, not the Distance Radius Filter section, which is a separate plan).

## Prerequisite

This plan assumes `docs/superpowers/plans/2026-08-30-finder-distance-radius-filter.md` has already been implemented and merged — its migration (`0011_nearest_campgrounds_radius.sql`) changes `nearest_campgrounds`'s signature, and this plan's Task 2 migration drops/recreates that already-changed signature. If the radius plan has not been implemented yet, stop and implement it first, or adjust Task 2's `drop function` statement to match whatever `nearest_campgrounds` signature actually exists (check with `mcp__claude_ai_Supabase__execute_sql`: `select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'nearest_campgrounds';`).

## Decisions Made While Planning

- **RIDB has no amenity/fee data (confirmed live, see spec).** No `ridb-sync` changes anywhere in this plan — only `nps-sync/transform.ts` populates the five new columns. RIDB rows keep `null` on all five forever under this plan.
- **Real NPS amenity value vocabulary** (queried directly from the live `campgrounds` table, not guessed — the exact mistake already made once with RIDB's org abbreviations):
  - `amenities.showers` and `amenities.toilets` are **arrays of strings**. Empty array `[]` means unspecified (→ `null`). `showers` uses the literal sentinel `"None"` for "no showers" (e.g. `["None"]`); any non-`"None"`-only array means showers exist (e.g. `["Hot - Year Round", "Free - Year Round"]`). `toilets` uses the literal sentinel `"No Toilets"` the same way — and real data has arrays mixing a genuine toilet type with `"No Toilets"` in the same array (e.g. `["Vault Toilets - year round", "No Toilets"]`), so the rule is "false only if *every* entry is the no-sentinel," not "false if the no-sentinel appears at all."
  - `amenities.potableWater` is also an array of strings, but has **no clean single sentinel** — real values include `["No water"]`, `["Yes - year round"]`, `["Yes - seasonal"]`, and a data quirk where `"Water, but not potable"` is split into two array elements (`"Water"`, `" but not potable"`) by a comma in the source data. Detecting "true" by a `startsWith("yes")` (case-insensitive) check on any array element is robust to this; detecting "false" by enumerating every no-shaped string is not (it would misclassify the split "Water"/" but not potable" case as true if only checking for exact "No water").
  - `amenities.dumpStation` is a **plain string**, not an array (`"Yes - year round"`, `"Yes - seasonal"`, `"No"`, or `""`). Empty string → `null`; otherwise `startsWith("yes")` (case-insensitive).
  - `fees[].cost` is a clean decimal string (`"16.00"`, `"0.00"`, `"1000.00"`) in every sampled value — safe to `parseFloat`, no currency symbols or non-numeric text mixed in.
  - An empty `fees` array occurs for 42 of 663 synced NPS campgrounds (~6%). Treated as `null` (unknown), not `0`/free — consistent with this plan's "we don't know" semantics for every other unpopulated field, and safer than asserting a campground is free when the data simply wasn't captured. A genuine `$0.00` fee entry (which does occur) still correctly produces `min_fee_cents = 0`.
- **Filter-only, no display surface this phase** (per the spec's explicit lean): the five new columns are not added to the `Campground` TypeScript model or the RPCs' returned columns — they're used only in the RPCs' `where` clauses. A future phase could surface them (e.g. amenity icons on the table) as a separate, small follow-up.
- **Both RPCs get all five params** (unlike `max_distance_m`, which is `nearest_campgrounds`-only): amenities and fees are plain conditions, not "nearest" semantics, so `get_campgrounds_by_ids` gets them too, matching how `agency_filter` already applies to both.
- **`false` vs. `null` for the four `require_*` RPC params, caught during this plan's self-review, not left for an implementer to discover:** `FinderComponent`'s checkboxes are plain booleans defaulting to `false`, but the RPC's `require_showers is null or c.has_showers = true` clause only treats `null` as "no constraint" — a naive `filters?.requireShowers ?? null` in `CampgroundsService` would leak the checkbox's `false` straight through, and every unchecked amenity would then wrongly require `has_showers = true` (etc.) on every default page load, since `false is null` is false in SQL. Task 4 fixes this with a small `requiredOrNull(value) => value ? true : null` helper in the service layer, not by changing `FinderComponent`'s state shape — the component's own defaults (plain `false`) are more natural for template checkbox bindings, so the normalization belongs at the RPC boundary, where the "true means required" contract actually lives.

## Global Constraints

- Additive only — do not modify `ridb-sync/*` anywhere in this plan; RIDB rows are untouched and stay `null` on all five new columns.
- Supabase project id for all MCP tool calls: `jpiicvvnipsckkhgjinn`.
- No RLS policy changes needed — `campgrounds`' existing "anyone can read" policy already covers the new columns.
- `null` means "unknown," never "no"/"false"/"free" — every parsing function in this plan must return `null` when the source data doesn't clearly say, not a guessed default.

## File Structure

- `supabase/migrations/0012_campground_amenity_fee_columns.sql` — new: five nullable columns.
- `supabase/migrations/0013_campground_amenity_fee_filter_rpcs.sql` — new: drop/recreate both RPCs with the new filter params.
- `supabase/functions/nps-sync/transform.ts` — modify: parse amenities/fees into the five columns.
- `supabase/functions/nps-sync/transform.test.ts` — modify.
- `src/app/core/services/campgrounds.service.ts` — modify: `getNearest`/`getByIds` gain the five filter params.
- `src/app/core/services/campgrounds.service.spec.ts` — modify.
- `src/app/features/finder/finder.component.ts` — modify: amenity/fee filter state.
- `src/app/features/finder/finder.component.html` — modify: checkboxes + price dropdown.
- `src/app/features/finder/finder.component.spec.ts` — modify.

---

## Task 1: Migration — five amenity/fee columns

**Files:**
- Create: `supabase/migrations/0012_campground_amenity_fee_columns.sql`

**Interfaces:**
- Produces: `public.campgrounds.has_showers boolean`, `has_potable_water boolean`, `has_dump_station boolean`, `has_toilets boolean`, `min_fee_cents integer` — all nullable, no default. Consumed by Task 2 (RPCs) and Task 3 (`nps-sync` writes them).

- [ ] **Step 1: Confirm the next migration number is still free**

Run: `ls supabase/migrations/`
Expected: highest existing file is `0011_nearest_campgrounds_radius.sql` (from the prerequisite radius plan) — `0012` is free. If not, renumber this task's file (and Task 2's) to the next two free numbers.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0012_campground_amenity_fee_columns.sql`:

```sql
alter table public.campgrounds
  add column has_showers boolean,
  add column has_potable_water boolean,
  add column has_dump_station boolean,
  add column has_toilets boolean,
  add column min_fee_cents integer;
```

- [ ] **Step 3: Apply the migration**

Using `mcp__claude_ai_Supabase__apply_migration`, apply the SQL above to project `jpiicvvnipsckkhgjinn` as migration `0012_campground_amenity_fee_columns` (adjust the number if Step 1 found a later one already taken).

- [ ] **Step 4: Verify the schema change**

Using `mcp__claude_ai_Supabase__execute_sql` against project `jpiicvvnipsckkhgjinn`, run:

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'campgrounds'
  and column_name in ('has_showers', 'has_potable_water', 'has_dump_station', 'has_toilets', 'min_fee_cents')
order by column_name;
```

Expected: all five columns present, `is_nullable = 'YES'`, and every existing row has `null` in each (no default was set, so this is automatic — no need for a separate check, but you can confirm with `select count(*) from public.campgrounds where has_showers is not null;` → expect `0`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_campground_amenity_fee_columns.sql
git commit -m "Add amenity/fee columns to campgrounds"
```

---

## Task 2: Migration — amenity/fee-aware RPCs

**Files:**
- Create: `supabase/migrations/0013_campground_amenity_fee_filter_rpcs.sql`

**Interfaces:**
- Consumes: the five columns from Task 1; `nearest_campgrounds`'s post-radius-plan signature (`double precision, double precision, int, text[], double precision`) and `get_campgrounds_by_ids`'s current signature (`text[], text[]`) — see this plan's Prerequisite section if these don't match what's actually deployed.
- Produces: `nearest_campgrounds(user_lat, user_lng, result_limit default 50, agency_filter default null, max_distance_m default null, require_showers boolean default null, require_potable_water boolean default null, require_dump_station boolean default null, require_toilets boolean default null, max_fee_cents integer default null)` and `get_campgrounds_by_ids(campground_ids text[], agency_filter text[] default null, require_showers boolean default null, require_potable_water boolean default null, require_dump_station boolean default null, require_toilets boolean default null, max_fee_cents integer default null)`. Returned columns are unchanged from each function's current shape (per this plan's filter-only decision — the five new columns are not added to the `returns table` list). Consumed by Task 4 (`CampgroundsService`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0013_campground_amenity_fee_filter_rpcs.sql`:

```sql
drop function nearest_campgrounds(double precision, double precision, int, text[], double precision);
drop function get_campgrounds_by_ids(text[], text[]);

create function public.nearest_campgrounds(
  user_lat double precision,
  user_lng double precision,
  result_limit int default 50,
  agency_filter text[] default null,
  max_distance_m double precision default null,
  require_showers boolean default null,
  require_potable_water boolean default null,
  require_dump_station boolean default null,
  require_toilets boolean default null,
  max_fee_cents integer default null
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
    and (require_showers is null or c.has_showers = true)
    and (require_potable_water is null or c.has_potable_water = true)
    and (require_dump_station is null or c.has_dump_station = true)
    and (require_toilets is null or c.has_toilets = true)
    and (max_fee_cents is null or (c.min_fee_cents is not null and c.min_fee_cents <= max_fee_cents))
  order by c.location <-> st_setsrid(st_point(user_lng, user_lat), 4326)::geography
  limit (case when max_distance_m is not null then null else result_limit end);
$$;

grant execute on function public.nearest_campgrounds(
  double precision, double precision, int, text[], double precision, boolean, boolean, boolean, boolean, integer
) to anon, authenticated;

create function public.get_campgrounds_by_ids(
  campground_ids text[],
  agency_filter text[] default null,
  require_showers boolean default null,
  require_potable_water boolean default null,
  require_dump_station boolean default null,
  require_toilets boolean default null,
  max_fee_cents integer default null
)
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
    and (agency_filter is null or c.agency = any(agency_filter))
    and (require_showers is null or c.has_showers = true)
    and (require_potable_water is null or c.has_potable_water = true)
    and (require_dump_station is null or c.has_dump_station = true)
    and (require_toilets is null or c.has_toilets = true)
    and (max_fee_cents is null or (c.min_fee_cents is not null and c.min_fee_cents <= max_fee_cents));
$$;

grant execute on function public.get_campgrounds_by_ids(
  text[], text[], boolean, boolean, boolean, boolean, integer
) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration**

Using `mcp__claude_ai_Supabase__apply_migration`, apply the SQL above to project `jpiicvvnipsckkhgjinn` as migration `0013_campground_amenity_fee_filter_rpcs`.

- [ ] **Step 3: Verify the RPC changes**

Using `mcp__claude_ai_Supabase__execute_sql` against project `jpiicvvnipsckkhgjinn`, run:

```sql
select count(*) from nearest_campgrounds(44.3, -68.2, 50, null, null, null, null, null, null, null);
select count(*) from nearest_campgrounds(44.3, -68.2, 50, null, null, true, null, null, null, null);
```

Expected: the first call returns the same count as before this migration (no columns populated yet, since Task 3 hasn't run — this just confirms the new params don't error and default to unfiltered behavior). The second call (`require_showers => true`) returns `0`, since no row has `has_showers = true` yet — that's expected until Task 3's sync runs; the goal here is confirming the query executes without error, not that it returns real results yet.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_campground_amenity_fee_filter_rpcs.sql
git commit -m "Add amenity/fee filter params to campground RPCs"
```

---

## Task 3: `nps-sync` — populate the five columns

**Files:**
- Modify: `supabase/functions/nps-sync/transform.ts`
- Modify: `supabase/functions/nps-sync/transform.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CampgroundRow` gains `has_showers: boolean | null`, `has_potable_water: boolean | null`, `has_dump_station: boolean | null`, `has_toilets: boolean | null`, `min_fee_cents: number | null`. Consumed by Task 2's columns (already exist) — this task just makes `nps-sync` populate them going forward.

- [ ] **Step 1: Write the failing tests**

Add to `supabase/functions/nps-sync/transform.test.ts` (append after the existing two tests, imports unchanged):

```typescript
Deno.test("toCampgroundRow detects showers from a real showers array", () => {
  const record = {
    id: "showers-yes", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { showers: ["Hot - Year Round", "Free - Year Round"] },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_showers, true);
});

Deno.test("toCampgroundRow treats a showers array of only 'None' as no showers", () => {
  const record = {
    id: "showers-none", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { showers: ["None"] },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_showers, false);
});

Deno.test("toCampgroundRow treats an empty showers array as unknown", () => {
  const record = {
    id: "showers-empty", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { showers: [] },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_showers, null);
});

Deno.test("toCampgroundRow detects toilets even when 'No Toilets' appears alongside a real toilet type", () => {
  const record = {
    id: "toilets-mixed", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { toilets: ["Vault Toilets - year round", "No Toilets"] },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_toilets, true);
});

Deno.test("toCampgroundRow treats a toilets array of only 'No Toilets' as no toilets", () => {
  const record = {
    id: "toilets-none", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { toilets: ["No Toilets"] },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_toilets, false);
});

Deno.test("toCampgroundRow detects potable water from a 'Yes' array entry", () => {
  const record = {
    id: "water-yes", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { potableWater: ["Yes - year round"] },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_potable_water, true);
});

Deno.test("toCampgroundRow treats a comma-split 'not potable' array as no potable water", () => {
  // Real NPS data quirk: "Water, but not potable" arrives split into two
  // array elements by the comma. Neither starts with "Yes", so this must
  // resolve to false, not true.
  const record = {
    id: "water-split", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { potableWater: ["Water", " but not potable"] },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_potable_water, false);
});

Deno.test("toCampgroundRow treats an empty potableWater array as unknown", () => {
  const record = {
    id: "water-empty", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { potableWater: [] },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_potable_water, null);
});

Deno.test("toCampgroundRow detects a dump station from a 'Yes' string", () => {
  const record = {
    id: "dump-yes", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { dumpStation: "Yes - year round" },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_dump_station, true);
});

Deno.test("toCampgroundRow treats a 'No' dump station string as false", () => {
  const record = {
    id: "dump-no", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { dumpStation: "No" },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_dump_station, false);
});

Deno.test("toCampgroundRow treats an empty dump station string as unknown", () => {
  const record = {
    id: "dump-empty", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: { dumpStation: "" },
    fees: [], reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.has_dump_station, null);
});

Deno.test("toCampgroundRow computes min_fee_cents as the minimum across multiple fee entries", () => {
  const record = {
    id: "fees-multi", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: {},
    fees: [
      { cost: "16.00", title: "Standard", description: "" },
      { cost: "8.00", title: "Senior/Access", description: "" },
    ],
    reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.min_fee_cents, 800);
});

Deno.test("toCampgroundRow computes min_fee_cents of 0 for a genuine free fee entry", () => {
  const record = {
    id: "fees-free", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: {},
    fees: [{ cost: "0.00", title: "Free", description: "" }],
    reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.min_fee_cents, 0);
});

Deno.test("toCampgroundRow treats an empty fees array as unknown, not free", () => {
  const record = {
    id: "fees-empty", parkCode: "test", name: "Test", description: "",
    latitude: "44.0", longitude: "-90.0",
    amenities: {},
    fees: [],
    reservationUrl: "", directionsUrl: "", images: [], contacts: {},
  };
  assertEquals(toCampgroundRow(record)?.min_fee_cents, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/nps-sync/transform.test.ts`
Expected: FAIL — `has_showers`/`has_potable_water`/`has_dump_station`/`has_toilets`/`min_fee_cents` are all `undefined` on the returned row (not yet produced by `toCampgroundRow`), so every new assertion fails.

- [ ] **Step 3: Write the implementation**

Edit `supabase/functions/nps-sync/transform.ts`:

```typescript
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
  has_showers: boolean | null;
  has_potable_water: boolean | null;
  has_dump_station: boolean | null;
  has_toilets: boolean | null;
  min_fee_cents: number | null;
}

// NPS's raw `amenities.showers`/`amenities.toilets` are arrays of strings
// using a literal "no" sentinel — real data has arrays that mix a genuine
// value with the sentinel (e.g. ["Vault Toilets - year round", "No
// Toilets"]), so "false" only when EVERY entry is the sentinel, not when
// the sentinel merely appears.
function parseYesNoArray(value: unknown, noSentinel: string): boolean | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return !value.every((entry) => entry === noSentinel);
}

// NPS's raw `amenities.potableWater` array has no single clean "no"
// sentinel (values include "No water" and a data quirk where "Water, but
// not potable" arrives split into two array elements by the comma), so
// detect "yes" positively instead of enumerating every "no" shape.
function parseWaterAvailability(value: unknown): boolean | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.some((entry) => typeof entry === "string" && entry.trim().toLowerCase().startsWith("yes"));
}

function parseYesNoString(value: unknown): boolean | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim().toLowerCase().startsWith("yes");
}

// The minimum cost across all fee entries (e.g. a standard + a discounted
// senior/access rate) in cents. An empty `fees` array means "not
// captured," not "free" — returns null, not 0, to match this schema's
// "null means unknown" convention. A genuine $0.00 fee entry still
// correctly produces 0.
function parseMinFeeCents(fees: unknown): number | null {
  if (!Array.isArray(fees) || fees.length === 0) return null;
  const costs = fees
    .map((fee) => {
      const cost = fee && typeof fee === "object" && "cost" in fee ? (fee as { cost: unknown }).cost : undefined;
      return typeof cost === "string" ? parseFloat(cost) : NaN;
    })
    .filter((cost) => !Number.isNaN(cost));
  if (costs.length === 0) return null;
  return Math.round(Math.min(...costs) * 100);
}

export function toCampgroundRow(record: NpsCampgroundRecord): CampgroundRow | null {
  const lat = parseFloat(record.latitude);
  const lng = parseFloat(record.longitude);
  if (!record.id || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  const amenities = record.amenities ?? {};
  return {
    id: record.id,
    park_code: record.parkCode,
    name: record.name,
    description: record.description,
    location: `POINT(${lng} ${lat})`,
    amenities,
    fees: record.fees ?? [],
    reservation_url: record.reservationUrl,
    directions_url: record.directionsUrl,
    images: record.images ?? [],
    contact: record.contacts ?? {},
    has_showers: parseYesNoArray(amenities.showers, "None"),
    has_potable_water: parseWaterAvailability(amenities.potableWater),
    has_dump_station: parseYesNoString(amenities.dumpStation),
    has_toilets: parseYesNoArray(amenities.toilets, "No Toilets"),
    min_fee_cents: parseMinFeeCents(record.fees),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/nps-sync/transform.test.ts`
Expected: PASS — 15 tests passed (2 pre-existing + 13 new), 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/nps-sync/transform.ts supabase/functions/nps-sync/transform.test.ts
git commit -m "Populate amenity/fee columns from NPS's raw amenities and fees data"
```

---

## Task 4: `CampgroundsService` — forward the new filters

**Files:**
- Modify: `src/app/core/services/campgrounds.service.ts`
- Test: `src/app/core/services/campgrounds.service.spec.ts`

**Interfaces:**
- Consumes: `nearest_campgrounds`/`get_campgrounds_by_ids`'s new params (Task 2).
- Produces: an `AmenityFeeFilters` interface (`{ requireShowers?: boolean; requirePotableWater?: boolean; requireDumpStation?: boolean; requireToilets?: boolean; maxFeeCents?: number }`) and updated signatures `CampgroundsService.getNearest(coords, limit?, agencies?, maxDistanceMeters?, filters?: AmenityFeeFilters)` and `CampgroundsService.getByIds(ids, agencies?, filters?: AmenityFeeFilters)`. Consumed by Task 5 (`FinderComponent`).

- [ ] **Step 1: Write the failing tests first**

Edit `src/app/core/services/campgrounds.service.spec.ts` — update the base `'maps RPC rows to Campground objects'` test's expected RPC call args to include the five new keys as `null` (append after `max_distance_m: null,` — if the radius plan's task already added that key, this task adds five more alongside it; if it's not there yet, add it too matching the radius plan's Task 2):

```typescript
    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: null, max_distance_m: null,
      require_showers: null, require_potable_water: null, require_dump_station: null,
      require_toilets: null, max_fee_cents: null,
    });
```

Add a new test after the existing `getNearest` tests:

```typescript
  it('forwards amenity and fee filters to the RPC', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });

    await service.getNearest({ lat: 44.3, lng: -68.1 }, 50, undefined, undefined, {
      requireShowers: true,
      requireDumpStation: true,
      maxFeeCents: 2000,
    });

    expect(rpcSpy).toHaveBeenCalledWith('nearest_campgrounds', {
      user_lat: 44.3, user_lng: -68.1, result_limit: 50, agency_filter: null, max_distance_m: null,
      require_showers: true, require_potable_water: null, require_dump_station: true,
      require_toilets: null, max_fee_cents: 2000,
    });
  });
```

Update the `getByIds` mapping test's expected call args the same way:

```typescript
    expect(rpcSpy).toHaveBeenCalledWith('get_campgrounds_by_ids', {
      campground_ids: ['cg-1'], agency_filter: null,
      require_showers: null, require_potable_water: null, require_dump_station: null,
      require_toilets: null, max_fee_cents: null,
    });
```

Add a new test after the `getByIds` tests:

```typescript
  it('forwards amenity and fee filters to the getByIds RPC', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });

    await service.getByIds(['cg-1'], undefined, { requirePotableWater: true, requireToilets: true });

    expect(rpcSpy).toHaveBeenCalledWith('get_campgrounds_by_ids', {
      campground_ids: ['cg-1'], agency_filter: null,
      require_showers: null, require_potable_water: true, require_dump_station: null,
      require_toilets: true, max_fee_cents: null,
    });
  });
```

Leave the error-path tests and `searchByName` tests unchanged.

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `npx ng test --watch=false`
Expected: FAIL on the tests just edited — the service doesn't send the five new RPC keys yet.

- [ ] **Step 3: Update the implementation**

Edit `src/app/core/services/campgrounds.service.ts` — add the `AmenityFeeFilters` interface and update both `getNearest` and `getByIds` (leave `searchByName` and the row-mapping logic inside each method unchanged; only the RPC-call parameter object changes):

```typescript
import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Campground } from '../models/campground.model';
import { Coordinates } from './geolocation.service';

export interface AmenityFeeFilters {
  requireShowers?: boolean;
  requirePotableWater?: boolean;
  requireDumpStation?: boolean;
  requireToilets?: boolean;
  maxFeeCents?: number;
}

// The RPCs' `require_*` params mean "true = must have it, anything else =
// no constraint" (there's no "must NOT have it" case). FinderComponent's
// checkboxes are plain booleans defaulting to `false`, not `undefined` —
// so `?? null` alone would leak `false` through to the RPC, and
// `require_showers is null or ...` would then wrongly require every
// unchecked amenity too. Collapse anything that isn't `true` to `null`.
function requiredOrNull(value: boolean | undefined): boolean | null {
  return value ? true : null;
}

@Injectable({ providedIn: 'root' })
export class CampgroundsService {
  private readonly supabase = inject(SupabaseService);

  async getNearest(
    coords: Coordinates,
    limit = 50,
    agencies?: string[],
    maxDistanceMeters?: number,
    filters?: AmenityFeeFilters,
  ): Promise<Campground[]> {
    const { data, error } = await this.supabase.client.rpc('nearest_campgrounds', {
      user_lat: coords.lat,
      user_lng: coords.lng,
      result_limit: limit,
      agency_filter: agencies ?? null,
      max_distance_m: maxDistanceMeters ?? null,
      require_showers: requiredOrNull(filters?.requireShowers),
      require_potable_water: requiredOrNull(filters?.requirePotableWater),
      require_dump_station: requiredOrNull(filters?.requireDumpStation),
      require_toilets: requiredOrNull(filters?.requireToilets),
      max_fee_cents: filters?.maxFeeCents ?? null,
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

  async getByIds(ids: string[], agencies?: string[], filters?: AmenityFeeFilters): Promise<Campground[]> {
    const { data, error } = await this.supabase.client.rpc('get_campgrounds_by_ids', {
      campground_ids: ids,
      agency_filter: agencies ?? null,
      require_showers: requiredOrNull(filters?.requireShowers),
      require_potable_water: requiredOrNull(filters?.requirePotableWater),
      require_dump_station: requiredOrNull(filters?.requireDumpStation),
      require_toilets: requiredOrNull(filters?.requireToilets),
      max_fee_cents: filters?.maxFeeCents ?? null,
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS — all `CampgroundsService` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/campgrounds.service.ts src/app/core/services/campgrounds.service.spec.ts
git commit -m "Forward amenity/fee filters from CampgroundsService"
```

---

## Task 5: Amenity checkboxes and price dropdown in the Finder view

**Files:**
- Modify: `src/app/features/finder/finder.component.ts`
- Modify: `src/app/features/finder/finder.component.html`
- Test: `src/app/features/finder/finder.component.spec.ts`

**Interfaces:**
- Consumes: `CampgroundsService.getNearest(coords, limit?, agencies?, maxDistanceMeters?, filters?)` (Task 4).
- Produces: `FinderComponent.requireShowers/requirePotableWater/requireDumpStation/requireToilets: boolean`, `FinderComponent.PRICE_OPTIONS: { label: string; value: number | null }[]`, `FinderComponent.selectedMaxFeeCents: number | null`.

- [ ] **Step 1: Write the failing tests first**

Edit `src/app/features/finder/finder.component.spec.ts` — add tests after the existing ones (assumes the radius plan's `onFilterChange()` rename has already landed; if not, use `onAgencyFilterChange()` instead and adjust):

```typescript
  it('defaults to no amenity requirements and no price ceiling', () => {
    expect(component.requireShowers).toBe(false);
    expect(component.requirePotableWater).toBe(false);
    expect(component.requireDumpStation).toBe(false);
    expect(component.requireToilets).toBe(false);
    expect(component.selectedMaxFeeCents).toBeNull();
  });

  it('forwards checked amenity requirements and the selected price ceiling on filter change', async () => {
    geolocationSpy.getCurrentPosition.mockResolvedValue({ lat: 44.3, lng: -68.2 });
    campgroundsSpy.getNearest.mockResolvedValue([]);
    await component.ngOnInit();

    component.requireShowers = true;
    component.requireToilets = true;
    component.selectedMaxFeeCents = 2000;
    await component.onFilterChange();

    expect(campgroundsSpy.getNearest).toHaveBeenLastCalledWith(
      { lat: 44.3, lng: -68.2 },
      50,
      component.ALL_AGENCIES,
      undefined,
      {
        requireShowers: true,
        requirePotableWater: false,
        requireDumpStation: false,
        requireToilets: true,
        maxFeeCents: 2000,
      },
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `requireShowers`/`requirePotableWater`/`requireDumpStation`/`requireToilets`/`selectedMaxFeeCents`/`PRICE_OPTIONS` don't exist yet, and `getNearest` isn't called with a filters object.

- [ ] **Step 3: Update the component**

Edit `src/app/features/finder/finder.component.ts` — add the new state fields, the `PRICE_OPTIONS` array, and update `loadNearest` to build and pass the `AmenityFeeFilters` object. Add `CheckboxModule` to imports and the `AmenityFeeFilters` import:

```typescript
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { CampgroundMapComponent } from './campground-map/campground-map.component';
import { CampgroundTableComponent } from './campground-table/campground-table.component';
import { GeolocationService, Coordinates } from '../../core/services/geolocation.service';
import { CampgroundsService, AmenityFeeFilters } from '../../core/services/campgrounds.service';
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
    CheckboxModule,
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

  requireShowers = false;
  requirePotableWater = false;
  requireDumpStation = false;
  requireToilets = false;

  readonly PRICE_OPTIONS: { label: string; value: number | null }[] = [
    { label: 'Free', value: 0 },
    { label: 'Under $20', value: 2000 },
    { label: 'Under $40', value: 4000 },
    { label: 'Any price', value: null },
  ];
  selectedMaxFeeCents: number | null = null;

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
      const filters: AmenityFeeFilters = {
        requireShowers: this.requireShowers,
        requirePotableWater: this.requirePotableWater,
        requireDumpStation: this.requireDumpStation,
        requireToilets: this.requireToilets,
        maxFeeCents: this.selectedMaxFeeCents ?? undefined,
      };
      const results = await this.campgroundsService.getNearest(
        location,
        50,
        this.selectedAgencies,
        maxDistanceMeters,
        filters,
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

- [ ] **Step 4: Add the amenity checkboxes and price dropdown to the template**

Edit `src/app/features/finder/finder.component.html` — add inside the existing `.agency-filter` div, after the radius `p-select`:

```html
      <p-select
        [options]="RADIUS_OPTIONS"
        [(ngModel)]="selectedRadiusMiles"
        optionLabel="label"
        optionValue="value"
        (onChange)="onFilterChange()"
        placeholder="Distance"
        name="radiusFilter"
      />
      <label>
        <p-checkbox [(ngModel)]="requireShowers" [binary]="true" (onChange)="onFilterChange()" name="requireShowers" /> Showers
      </label>
      <label>
        <p-checkbox [(ngModel)]="requirePotableWater" [binary]="true" (onChange)="onFilterChange()" name="requirePotableWater" /> Potable water
      </label>
      <label>
        <p-checkbox [(ngModel)]="requireDumpStation" [binary]="true" (onChange)="onFilterChange()" name="requireDumpStation" /> Dump station
      </label>
      <label>
        <p-checkbox [(ngModel)]="requireToilets" [binary]="true" (onChange)="onFilterChange()" name="requireToilets" /> Toilets
      </label>
      <p-select
        [options]="PRICE_OPTIONS"
        [(ngModel)]="selectedMaxFeeCents"
        optionLabel="label"
        optionValue="value"
        (onChange)="onFilterChange()"
        placeholder="Price"
        name="priceFilter"
      />
```

(This inserts after the radius `p-select` from the prerequisite radius plan, inside the same `.agency-filter` div that already contains the agency multiselect and radius dropdown.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS — all `FinderComponent` tests green, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/finder/finder.component.ts src/app/features/finder/finder.component.html src/app/features/finder/finder.component.spec.ts
git commit -m "Add amenity and price filters to the Finder view"
```

---

## Task 6: Final Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite and build**

```bash
npx ng test --watch=false
npx ng build
deno test supabase/functions/nps-sync/transform.test.ts
deno test supabase/functions/ridb-sync/
```

Expected: all PASS, build succeeds with no new errors. The `ridb-sync` test run is a regression check confirming this plan didn't touch it.

- [ ] **Step 2: Manually invoke `nps-sync` to backfill the new columns on existing rows**

The 663 already-synced NPS rows have `null` on all five new columns until `nps-sync` runs again (upserts are idempotent, so this is safe to run anytime). Invoke the deployed `nps-sync` function (Supabase Dashboard's "Invoke" button, or the same `curl`-with-bearer-token pattern used to invoke `ridb-sync` during the original RIDB plan's verification). Then confirm:

```sql
select
  count(*) filter (where has_showers is not null) as showers_known,
  count(*) filter (where has_showers = true) as has_showers,
  count(*) filter (where min_fee_cents is not null) as fee_known,
  count(*) filter (where min_fee_cents = 0) as free
from public.campgrounds where source = 'nps';
```

Expected: `showers_known` and `fee_known` are both greater than 0 (most of the 663 rows have at least the array-based fields populated one way or another — an all-zero result means the parsing functions aren't matching real data and needs debugging, not that this step passed).

- [ ] **Step 3: Manual end-to-end pass in the browser**

Run `npx ng serve`, open the Finder view.

1. Confirm four amenity checkboxes and a "Price" dropdown appear in the filter row alongside agency and radius.
2. Check "Showers" alone — confirm the map/table update to a smaller set, and that unchecking it returns to the fuller set.
3. Select "Under $20" — confirm results narrow to campgrounds with at least one fee entry `<= $20` (spot-check a couple against known fee data if the table/detail view shows fees).
4. Combine "Showers" + "Under $20" + an agency filter — confirm all three compose (AND, not OR).
5. Select "Free" — confirm results are limited to genuinely `$0.00`-fee campgrounds, not RIDB rows (which should never appear under any amenity/fee filter, since they're always `null`/unknown).
6. Check the browser console for errors at every step above.

- [ ] **Step 4: Report results**

Confirm all steps above pass with no console errors before considering this plan complete. If any step fails, treat it as a bug against the specific task that introduced it, not a new task.
