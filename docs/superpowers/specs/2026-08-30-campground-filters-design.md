# Campground Finder Filters (Radius, Amenities, Fees) — Design

## Context

The Finder view recently gained an agency filter (NPS/USFS/BLM/USACE/FWS —
see [2026-08-28-ridb-multi-agency-campground-design.md](2026-08-28-ridb-multi-agency-campground-design.md)).
While verifying it live, USACE/BLM/FWS results appeared empty from outside
the Midwest — not a bug, but a direct consequence of `ridb-sync` being
scoped to the 12 Midwest states. Worth naming plainly: that Midwest scoping
was never an explicit requirement from Shawn. The original RIDB design
spec's Open Questions section left "the state list to sync" genuinely
undecided; the implementation plan resolved it to Midwest-only on its own
during planning, without a round-trip check. No harm done here, but it's
the reason this now reads as a hard constraint when it was a planning-time
assumption — worth remembering for future specs: an Open Question that
gets silently resolved during implementation planning is a decision made
without the person who should be making it.

That confusion surfaced a real, generally useful idea: the Finder has no
way to bound results geographically beyond a fixed "nearest 50," and no way
to filter on amenities or cost at all, despite real structured data already
existing for NPS campgrounds. This spec covers three filters — distance
radius, amenities, and fees — designed together since two of them (amenities,
fees) share the same underlying problem: real data exists for NPS rows,
none exists for RIDB rows.

## Goals

- Let users bound Finder results by distance ("within 100 mi") instead of
  always taking the fixed nearest-50, so filtering isn't implicitly limited
  by whatever the nearest 50 campgrounds of any agency happen to be.
- Let users filter by four amenities that matter for trip planning: showers,
  potable water, dump station, toilets/restrooms.
- Let users filter by a price ceiling (Free / Under $20 / Under $40 / Any).

## Out of Scope (this phase)

- Cell reception and camp store amenity filters — deferred; the four chosen
  cover the most commonly cited trip-planning needs.
- A two-sided custom price range (explicit min AND max) — only a preset
  "under $X" ceiling, matching the radius filter's preset-dropdown pattern.
- A state/region multiselect as a complement to radius — radius solves the
  motivating problem more generally; state-based browsing could be a later
  addition if wanted.
- Map-viewport-based filtering ("show only what's visible on the map").
- Extracting amenity or fee data from RIDB at all — confirmed against a
  live response that RIDB doesn't carry it at the facility level (see
  below). RIDB rows simply stay `null` on all five new columns.

## Data Model Changes

### New columns

```sql
alter table campgrounds
  add column has_showers boolean,
  add column has_potable_water boolean,
  add column has_dump_station boolean,
  add column has_toilets boolean,
  add column min_fee_cents integer;
```

All five are nullable, deliberately. `null` means "we don't know" — distinct
from `false` (confirmed absent) or `0` (confirmed free). This is the
mechanism that keeps a RIDB campground with real showers from looking like
it doesn't have any just because we haven't captured that field for it yet:
an active amenity/fee filter excludes `null` rows (unknown), not just
`false` ones (confirmed absent).

`min_fee_cents` stores the *minimum* listed rate across all of a
campground's fee entries (e.g. a $16 standard + $8 senior/access rate
stores `800`), per the "under $X means there's *some* way to camp here for
under $X" semantics decided for this filter. Cents avoid float rounding on
currency.

### RPC changes

Both `nearest_campgrounds` and `get_campgrounds_by_ids` need another
drop-and-recreate (per the lesson already learned migrating in the agency
filter — `create or replace` can't change a return type, and an added
parameter registers as a distinct overload rather than replacing the old
signature). New parameters:

- `max_distance_m double precision default null` — **`nearest_campgrounds`
  only.** `null` preserves today's behavior exactly (nearest `result_limit`,
  capped at 50). When set, the `result_limit` cap is dropped and the
  function returns every row within `max_distance_m`, ordered by distance.
  `get_campgrounds_by_ids` doesn't need this — it's an ID lookup, not a
  "nearest" query.
- `require_showers boolean default null`, `require_potable_water boolean
  default null`, `require_dump_station boolean default null`,
  `require_toilets boolean default null` — `null` (default) applies no
  constraint on that amenity. `true` requires the corresponding column to
  be `true` (excludes both `false` and `null` rows). There's no "must be
  false" case — the UI only offers "require this amenity," never "exclude
  campgrounds that have it."
- `max_fee_cents integer default null` — `null` applies no constraint. When
  set, only rows where `min_fee_cents is not null and min_fee_cents <=
  max_fee_cents` match (so unknown-fee rows are excluded, same posture as
  the amenity filters).

## RIDB Has No Structured Amenity/Fee Data (confirmed against a live response)

Before writing this plan, a real `/facilities?full=true` response was
inspected directly (temporary read-only debug deploy of `ridb-sync`, three
Wisconsin facilities, no DB writes — reverted immediately after). Finding:
RIDB's facility-level response has **no amenity fields at all** — no
showers/toilets/potable-water/dump-station equivalents anywhere. For fees,
the only relevant field is `FacilityUseFeeDescription`, free-text HTML
prose (e.g. a pet-fee alert paragraph), not a structured cost like NPS's
`fees: [{cost, title, description}]`. A `CAMPSITE` array is present but
empty in all three sampled facilities — it may carry per-site detail via a
separate `/facilities/{id}/campsites` call, but that's unconfirmed and
would mean an extra API call per facility, and is not pursued in this
phase.

**Decision:** ship amenities and fees NPS-only. RIDB rows simply never get
`has_showers`/`has_potable_water`/`has_dump_station`/`has_toilets`/
`min_fee_cents` populated (they stay `null` forever, under the sync's
normal insert defaults) — the "unknown excluded when filter active" logic
already designed above handles this correctly without any special-casing.
No `ridb-sync` changes are needed for this plan at all; only
`nps-sync/transform.ts` populates the five new columns:

- Normalize NPS's already-present raw `amenities`/`fees` JSONB into the
  five new columns. NPS's raw shapes are inconsistent field-by-field
  (`"No"` strings, `["None"]` arrays, populated arrays meaning "yes"), so
  this needs real per-field parsing, not a generic transform. Fee cost
  strings (e.g. `"16.00"`) parse to cents; the minimum across all fee
  entries becomes `min_fee_cents`.

## Distance Radius Filter

A dropdown next to the existing agency multiselect: **25 mi / 50 mi / 100
mi / 250 mi / No limit** (default: **No limit**, so nothing changes for
today's users until they touch the control). Selecting a radius converts
miles to meters and passes `max_distance_m` on the next reload. Composes
with every other filter (agency, amenities, fees) as an independent
condition in the same query — "USACE only, within 100 mi, with showers."

## Amenities Filter

Four checkboxes: **Showers, Potable water, Dump station, Toilets/restrooms**.
Unchecked (default) applies no constraint; checked requires that column to
be `true`. Cell reception and camp store are explicitly deferred (Out of
Scope), not forgotten — worth a follow-up round once these four are live
and the RIDB extraction pattern is proven out.

## Fees Filter

A dropdown: **Free / Under $20 / Under $40 / Any price** (default: **Any
price**), mapping to `max_fee_cents` thresholds (`0`, `2000`, `4000`,
`null`). Uses the minimum-listed-rate semantics decided above.

## Frontend Changes

- `campground.model.ts`: whether to surface the five new columns on the
  `Campground` interface for display (e.g. an amenity icon row on the
  table/detail view) or keep them filter-only for this phase is an
  implementation-plan decision, not fixed here — leaning filter-only to
  keep this phase's scope tight, but flag it explicitly when the plan is
  written.
- `CampgroundsService.getNearest`/`getByIds`: add params for
  `maxDistanceMeters`, the four `require*` amenity flags, and
  `maxFeeCents`, forwarded to the corresponding RPC params.
- `FinderComponent`: the reload method (`onAgencyFilterChange` today) stops
  being agency-specific — rename to something like `onFilterChange`, since
  it now needs to fire on radius/amenity/fee changes too, not just agency.
  The filter row grows: agency multiselect (existing) + radius dropdown +
  four amenity checkboxes + price dropdown. All compose as independent
  conditions, matching the agency filter's existing null-means-unfiltered
  pattern.

## Error Handling

Same posture as the rest of this app's syncs: a sync failure is logged and
existing data is retained (no partial wipes); a facility whose
amenity/fee fields don't parse cleanly gets a `null` for that specific
column, not a skipped row and not a failed sync run.

## Testing

- Extend `nps-sync/transform.test.ts` with cases for each of the five new
  columns: present-and-true, present-and-false, and absent/unparseable
  (→ `null`). No `ridb-sync/transform.test.ts` changes — RIDB rows never
  populate these columns in this plan.
- Extend `CampgroundsService`'s and `FinderComponent`'s spec files with the
  same call-args-forwarding pattern already used for the agency filter
  (e.g. "forwards `maxDistanceMeters`/`requireShowers`/`maxFeeCents` to the
  RPC," "defaults to no constraint when nothing's selected").
- No new RPC-level integration tests needed, matching this codebase's
  existing precedent (RPC logic is verified by direct `execute_sql` checks
  during implementation, not an automated suite — same as the agency
  filter's migrations).

## Open Questions / Follow-ups

- Whether `/facilities/{id}/campsites` carries real per-site amenity data
  worth a future phase — not pursued here (see above), genuinely unknown
  rather than ruled out.
- Whether the five new columns get surfaced on the `Campground` model for
  display, or stay filter-only this phase (flagged above under Frontend
  Changes) — decide explicitly in the implementation plan, don't let it
  default silently the way the Midwest state-list question did.
- Cell reception, camp store, and any other amenities beyond the four
  chosen here — deferred, worth a follow-up round.
- A state/region multiselect as a complement to radius — deferred; radius
  was chosen as the more general first cut.
