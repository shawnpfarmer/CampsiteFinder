# Multi-Agency Federal Campground Data (RIDB) — Design

## Context

CampsiteFinder currently has exactly one data source: the NPS Data API,
synced weekly into the `campgrounds` table by the `nps-sync` Edge Function
(see [2026-08-15-campsite-finder-design.md](2026-08-15-campsite-finder-design.md)).
NPS only covers National Park Service units (national parks, monuments,
seashores, etc.), which are sparse in the Midwest. This is why the map shows
far fewer campsites than users in that region expect. See also the
[companion analysis](2026-08-28-ridb-midwest-analysis.md) that traced this
root cause against the running app.

The prompting question was "how do I get BLM land in here", but BLM's
surface land holdings are heavily concentrated in ~12 western states. In the
Midwest, BLM (via its Eastern States district) manages only a handful of
scattered parcels with developed campgrounds — e.g. Lake Vermilion and some
Wisconsin River islands in Minnesota/Wisconsin. Adding BLM alone will not
meaningfully change the Midwest map.

What will actually close the gap: US Forest Service (national forests —
Chequamegon-Nicolet, Chippewa, Superior, Hiawatha, Ottawa, Huron-Manistee,
Shawnee, Hoosier, Mark Twain, Black Hills, etc.) and US Army Corps of
Engineers reservoir campgrounds, both of which are common across the
Midwest. All three agencies (BLM, USFS, USACE), plus NPS itself and USFWS
and Bureau of Reclamation, are aggregated in one place: Recreation.gov's
RIDB (Recreation Information Database) API.

Reference: RIDB API (free API key, sign up at ridb.recreation.gov). NPS's
own API (https://www.nps.gov/subjects/developer/api-documentation.htm)
remains in use for the richer NPS-specific fields (images, detailed
amenities) already being synced — RIDB fills in the other agencies rather
than replacing NPS.

## Goals

- Add campgrounds managed by USFS, BLM, USACE, and USFWS to the existing
  `campgrounds` table via a new RIDB-backed sync, so the Finder map/table
  shows the full picture of nearby federal camping, not just NPS units.
- Let users see/filter which agency manages a given campground (NPS, USFS,
  BLM, USACE, FWS), since amenities, fees, and reservation systems differ by
  agency.
- Keep the existing NPS sync and its data untouched — this is additive.

## Out of Scope (this phase)

- State-managed campgrounds (state parks/forests/DNR land) — a different,
  non-federal, per-state data landscape; worth a separate design later if
  wanted.
- Deduplicating facilities that might appear in both the NPS feed and
  RIDB's NPS-sourced records (RIDB does include NPS facilities too).
  Initial phase: keep RIDB import scoped to `agency IN (USFS, BLM, USACE,
  FWS)`, explicitly excluding RIDB's own NPS-organization records, so
  there's no overlap with the existing nps-sync data.
- Live individual-site booking availability (same out-of-scope reasoning as
  the original design — this only affects facility-level data).

## Data Model Changes

```sql
-- Migration: add agency/source columns, relax NPS-specific NOT NULL, and
-- namespace ids so RIDB and NPS records can never collide.
alter table campgrounds
  add column agency text not null default 'NPS',
  add column source text not null default 'nps',
  alter column park_code drop not null;

-- Existing NPS rows keep their current `id` values (already unique).
-- New RIDB rows use id = 'ridb:' || FacilityID, e.g. 'ridb:233118'.
-- park_code is NPS-specific; for RIDB rows leave it null and rely on
-- agency + source instead.

create index campgrounds_agency_idx on campgrounds (agency);
```

`agency` is a short display code (NPS, USFS, BLM, USACE, FWS); `source`
records which sync pipeline wrote the row (`nps`, `ridb`) for
debugging/backfill purposes.

Update `nearest_campgrounds` and `get_campgrounds_by_ids` (in a new
migration) to also select and return `agency`, and accept an optional
`agency_filter text[] default null` param so the frontend can filter by
agency without pulling every row:

```sql
where (agency_filter is null or c.agency = any(agency_filter))
```

**Correction from review (verified against `supabase/migrations/0001_init.sql`):**
both functions are declared `returns table (...)`, and adding `agency` to
that column list changes their return type. Postgres refuses a
`create or replace function` that changes an existing function's return
type ("cannot change return type of existing function") — this is true
even before accounting for the new `agency_filter` parameter, which on its
own would additionally register as a *distinct overload* (same name,
different argument list) rather than replacing the old one, leaving a stale
3-arg / 1-arg version callable alongside the new one. Both functions must
be dropped by their exact current signature and recreated, and the
`grant execute` reissued afterward since it does not carry over a
drop/recreate:

```sql
drop function nearest_campgrounds(double precision, double precision, int);
drop function get_campgrounds_by_ids(text[]);

create function nearest_campgrounds(
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
  from campgrounds c
  where agency_filter is null or c.agency = any(agency_filter)
  order by c.location <-> st_setsrid(st_point(user_lng, user_lat), 4326)::geography
  limit result_limit;
$$;

grant execute on function nearest_campgrounds(double precision, double precision, int, text[]) to anon, authenticated;

create function get_campgrounds_by_ids(campground_ids text[], agency_filter text[] default null)
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
  from campgrounds c
  where c.id = any(campground_ids)
    and (agency_filter is null or c.agency = any(agency_filter));
$$;

grant execute on function get_campgrounds_by_ids(text[], text[]) to anon, authenticated;
```

## RIDB Sync (`ridb-sync` Edge Function)

Mirrors the structure of `nps-sync` (`supabase/functions/nps-sync/index.ts`):

- New secret: `RIDB_API_KEY` (Supabase Edge Function secret — get a free key
  at ridb.recreation.gov; the frontend never calls RIDB directly, same
  pattern as the NPS key).
- Base URL: `https://ridb.recreation.gov/api/v1`.
- Query `/facilities` paginated (limit/offset), filtered to the states
  CampsiteFinder cares about and to campground-type facilities. RIDB
  supports filtering by state (`state=`) and activity (camping's activity
  ID); confirm the exact parameter names and the shape of the
  agency/org linkage against RIDB's live docs/response once the API key is
  in hand — this file was written without live API access, so treat field
  names below as a first draft, not gospel.
- Each facility record needs its managing agency resolved. RIDB's
  `/organizations` endpoint (or the `full=true` query param, which embeds
  linked entities) maps a facility to its parent organization/agency name
  (e.g. "USDA Forest Service" → USFS, "Bureau of Land Management" → BLM,
  "US Army Corps of Engineers" → USACE). Build a small org-name →
  agency-code lookup table and skip/log (don't fail) any facility whose
  agency doesn't map cleanly, same "log and retain existing data"
  philosophy as `nps-sync`'s error handling.
- Explicitly skip facilities whose resolved agency is NPS (already covered
  by `nps-sync` — see Out of Scope above).
- Transform to `CampgroundRow` (extend `transform.ts`'s pattern): validate
  lat/lng present and parseable (same null-guard as `toCampgroundRow`),
  prefix id with `ridb:`, set `agency`/`source`, leave `park_code` null.
- Same idempotent upsert-by-id approach; same "sync failure logs and
  retains existing data" error handling.
- Schedule alongside the existing weekly `nps-sync` cron (RIDB facility
  data changes about as rarely). **Note from review:** the `nps-sync`
  schedule itself isn't defined anywhere in this repo (no `config.toml`
  cron entry, no scheduled GitHub Actions workflow, no `pg_cron` migration)
  — it's presumably wired up out-of-band in the Supabase dashboard. Confirm
  where that schedule actually lives before assuming there's an in-repo
  artifact to copy; document it here once found.

## Frontend Changes

- Campground model (`campground.model.ts`): add `agency: string`. **Note
  from review:** `parkCode` is currently typed as non-optional `string`,
  but RIDB rows will carry `park_code = null`. Either widen `parkCode` to
  `string | null` and audit call sites that assume it's a string (detail
  views, any NPS-specific park-code links), or map a `''`/sentinel value in
  the service layer — decide which and note it here before implementing.
- `CampgroundsService.getNearest` / `getByIds`: pass through `agency`, add
  an optional `agencies?: string[]` param forwarded to the
  `nearest_campgrounds` RPC's new `agency_filter`.
- Finder view: an agency filter (checkboxes/multi-select — NPS, USFS, BLM,
  USACE, FWS) above/beside the existing table, defaulting to all agencies
  selected. Map markers and table rows get an agency badge/icon so users
  can tell at a glance who manages a given site (reservation systems and
  fee structures differ by agency, which matters for the linked
  `reservation_url`).

## Error Handling

Same posture as the existing design: RIDB sync failures are logged and
existing cached data is retained (no partial wipes); a facility with
unparseable coordinates or an unresolvable agency is skipped and counted,
not fatal to the run.

## Testing

- Extend the transform-function unit tests (pattern from
  `nps-sync/transform.test.ts`) to cover the RIDB → `CampgroundRow`
  mapping, including the agency-code lookup and the "skip
  unresolvable/NPS agency" paths.
- Add a sample fixture RIDB `/facilities` response (a few facilities across
  USFS/BLM/USACE, one with a bad org, one already-NPS to confirm it's
  skipped) for the sync's upsert/paging logic, matching how `nps-sync` is
  tested today.

## Open Questions / Follow-ups

- Confirm RIDB's exact facility → organization linkage fields once a key
  is available (this doc's Sync section flags this explicitly) — do this
  before writing the real Edge Function, not after.
- Decide the state list to sync (all 50, or just the Midwest states the
  user actually cares about, to keep sync time/row count down initially).
- Consider whether state-park data (non-federal) is worth a future phase,
  given it would likely add even more Midwest density than USFS/USACE.
- Locate and document where the `nps-sync` cron schedule actually lives
  (flagged above), so `ridb-sync` can be wired up the same way.
- Decide how the frontend should represent a null `park_code` for RIDB rows
  (flagged above).
