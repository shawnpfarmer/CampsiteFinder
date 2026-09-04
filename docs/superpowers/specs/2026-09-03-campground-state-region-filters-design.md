# Campground State & Region Filters — Design

## Context

The Finder page already lets users filter nearby campgrounds by agency
(NPS/USFS/BLM/USACE/FWS) — see
[2026-08-28-ridb-multi-agency-campground-design.md](2026-08-28-ridb-multi-agency-campground-design.md).
That works because `agency` is a real column on `campgrounds`, populated by
both sync Edge Functions.

State and region filters were requested next, but neither concept exists
anywhere in the current pipeline: the `campgrounds` table has no address or
state column, and neither `ridb-sync/transform.ts` nor `nps-sync/transform.ts`
reads anything address-related out of the source APIs — they only map
lat/lng, name, description, and (for RIDB) agency.

This is also the same codebase where `ridb-sync` briefly scoped ingestion to
a hardcoded Census Bureau Midwest state list
(`MIDWEST_STATES = ["IL","IN","IA","KS","MI","MN","MO","NE","ND","OH","SD","WI"]`,
removed in commit `319d14f` to widen coverage nationwide). This design reuses
that same Census Bureau region grouping for the "region" concept below,
rather than inventing a new one.

## Goals

- Add a `state` column to `campgrounds`, populated at ingest time by both
  `ridb-sync` and `nps-sync` from data those APIs already return.
- Let users filter the Finder page by one or more states, the same way they
  already filter by agency.
- Let users filter by region (Northeast/Midwest/South/West) as a convenience
  on top of the state filter — not a separate stored concept.
- Existing campground rows get a `state` value the next time each sync runs
  (both syncs upsert by id already; no separate backfill mechanism needed).

## Out of Scope (this phase)

- The NARA Catalog integration (NDOD-10154) — unrelated, separate initiative.
- Server-side pagination of the "Show all" result set — the table already
  paginates client-side via PrimeNG's paginator; this design doesn't touch
  fetch volume.
- Non-US territories/addresses that don't resolve to one of the 50
  states + DC (e.g. a malformed or missing address). These rows keep
  `state = null` and simply won't match a state filter, exactly like a
  campground with no distance match today.
- Any change to the map marker clustering work already shipped.

## Data Model Changes

```sql
alter table public.campgrounds add column state text;
create index campgrounds_state_idx on public.campgrounds (state);
```

Nullable, no default — a row with an unresolvable address keeps `state =
null` rather than a placeholder value, so a state filter never accidentally
matches it.

## Ingestion Changes

**`ridb-sync/transform.ts`**: RIDB's `full=true` facility payload includes a
`FacilityAddress` array (each entry has `FacilityAddressType`, "Physical" or
"Mailing", plus `StateCode`). Add:

```ts
interface RidbAddressRecord {
  FacilityAddressType?: string;
  StateCode?: string;
}
// on RidbFacilityRecord:
FacilityAddress?: RidbAddressRecord[];
```

`toCampgroundRow` resolves state by preferring the "Physical" entry, falling
back to the first entry if none is typed "Physical", and to `null` if the
array is empty/absent or has no `StateCode`.

**`nps-sync/transform.ts`**: the NPS `/campgrounds` response includes an
`addresses` array with `type` ("Physical"/"Mailing") and `stateCode`, using
the same resolution rule (prefer Physical, fall back to first, else null).

Both transforms add `state: string | null` to their `CampgroundRow` output.
No new API parameters or requests are needed on either side — this data is
already being fetched and discarded.

**Backfill**: both syncs upsert by `id`, so re-running each (their existing
scheduled/triggered invocation) backfills `state` on every existing row.
No one-off backfill script.

## RPC Changes

`nearest_campgrounds` and `get_campgrounds_by_ids` each gain a
`state_filter text[] default null` parameter and return `state`, mirroring
the existing `agency_filter` pattern exactly (null means unfiltered):

```sql
where (agency_filter is null or c.agency = any(agency_filter))
  and (state_filter is null or c.state = any(state_filter))
  and (...)
```

Per the existing migration convention in this repo, this means `drop
function` + `create function` with the new signature, then re-`grant
execute` to `anon, authenticated`.

## Frontend Changes

- `Campground` model: add `state: string | null`.
- `CampgroundsService.getNearest` / `getByIds`: add a `states?: string[]`
  parameter, pass through as `state_filter`, map `row.state` back.
- `FinderComponent`:
  - `selectedStates: string[]` wired exactly like `selectedAgencies` today
    (a PrimeNG MultiSelect, `onFilterChange()` on change).
  - A `REGIONS` constant (`Northeast`/`Midwest`/`South`/`West` → member
    state list), reusing the same state grouping as the removed
    `MIDWEST_STATES`. Region is a **client-side-only convenience**: picking
    a region toggles its member states into `selectedStates`. No
    `region_filter` is ever sent to the backend — the query is always just
    "state IN (...)".

## Testing

- `ridb-sync/transform.test.ts` / `nps-sync/transform.test.ts`: state parsed
  from a Physical address, falls back when only Mailing is present, `null`
  when the address array is missing/empty — matching the existing
  table-driven style in those files.
- `CampgroundsService` unit tests: `states` is passed through to the RPC
  call and `state` is mapped back onto the returned `Campground`.
- `FinderComponent` unit tests: selecting a state and selecting a region
  both trigger `onFilterChange()` with the expected `selectedStates`.

## Error Handling

No new failure modes: an unresolvable address yields `state = null`, which
behaves like any other campground that simply doesn't match an active
filter. No sync failure is introduced by missing address data.
