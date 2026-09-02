# Finder Radius Toggle & Inline Campground Details — Design

## Context

Following up on the `ridb-sync` Midwest-filter fix (now shipped — the
`campgrounds` table holds ~4,900 nationwide rows and `nearest_campgrounds`
already supports an optional `max_distance_m` radius cap via migration
[0011_nearest_campgrounds_radius.sql](../../../supabase/migrations/0011_nearest_campgrounds_radius.sql)),
two usability problems surfaced:

1. The Finder always shows a fixed "nearest 50" with no way to see
   everything or to explicitly bound by distance.
2. Clicking a campground name navigates to a separate `/campground/:id`
   page, and that page renders `description` via `{{ }}` interpolation —
   so RIDB/NPS descriptions containing real HTML markup show up as raw
   escaped tags instead of rendering.

This spec covers both, plus removing the now-unused detail route.

## Goals

- Default the Finder to showing all synced campgrounds (agency-filtered,
  distance-sorted), not just the nearest 50.
- Add a "Near me" toggle that, when on, reveals a radius preset dropdown
  (25/50/100/250 mi) and bounds results to that radius.
- Replace navigating to a separate detail page with an inline expanding
  row directly below the clicked campground, in the shared
  `CampgroundTableComponent` (used by both Finder and Favorites).
- Fix embedded HTML in `description` not rendering, as part of building
  the new inline detail panel.

## Out of Scope (this phase)

- Marker clustering on the map. "Show all" will render ~4,900 unclustered
  markers nationwide by default — flagged as a likely follow-up if that
  proves sluggish or visually messy, but not built here.
- A custom/arbitrary radius input — only the four presets.
- Any changes to Trips' own inline `p-table` — it doesn't use the shared
  `CampgroundTableComponent` and isn't touched by this work.
- The amenities/fees filters from the earlier
  [2026-08-30 filters spec](2026-08-30-campground-filters-design.md) —
  unrelated to this pass.
- Keeping `/campground/:id` around unlinked "just in case" — removed
  outright since nothing will link to it and Favorites/Trips each already
  have their own map/table instances independent of it.

## Design

### 1. Show all / Near me toggle (Finder view)

- A `p-toggleswitch` (`ToggleSwitchModule`, matching the existing pattern
  in `account.component.ts`) labeled "Near me" sits next to the agency
  `p-multiselect`. Default **off** → Show all.
- When on, a `p-select` (`SelectModule`, matching `admin.component.html`)
  appears with radius options **25 / 50 / 100 / 250 mi**, default 50.
- No RPC or migration changes needed. `nearest_campgrounds` already
  ignores `result_limit` entirely whenever `max_distance_m` is non-null,
  returning every row within that radius
  ([0011_nearest_campgrounds_radius.sql:38-43](../../../supabase/migrations/0011_nearest_campgrounds_radius.sql#L38-L43)).
  So both modes just call the RPC with a distance:
  - **Show all**: pass a constant `SHOW_ALL_RADIUS_M = 20_038_000` (half
    Earth's circumference) as `max_distance_m`. This hits the same
    "no count cap" branch, so it always returns literally every
    agency-filtered row no matter how large the dataset grows later —
    no magic row-count guess to keep in sync with reality.
  - **Near me**: pass the selected preset, converted to meters.
- `FinderComponent.onAgencyFilterChange` is renamed `onFilterChange`,
  triggered by the agency multiselect, the near-me toggle, and the radius
  select alike.
- The existing location-required flow (geolocation, falling back to the
  manual lat/lng form on error) is unchanged — "Show all" only drops the
  radius/count cap, not the need for an origin point to sort distance
  from.

### 2. Inline expanding detail row (shared `CampgroundTableComponent`)

- Remove the `routerLink` on the Name column. Clicking a row's name
  toggles that row's id as "expanded" (one row open at a time); clicking
  again collapses it.
- When a row is expanded, render an extra full-width `<tr><td
  [colspan]>` immediately below it containing a new
  `CampgroundDetailPanelComponent`: name, description, reservation/
  directions links, `app-favorite-toggle`, `app-add-to-trip` — the same
  fields the old detail page showed.
- `CampgroundDetailPanelComponent` renders `description` via `[innerHTML]`
  (Angular's default sanitizer — not bypassed) instead of `{{ }}`
  interpolation. This is the actual fix for the embedded-HTML bug.
- Since Favorites reuses `CampgroundTableComponent` as-is, it gets inline
  expansion for free. Trips' own inline table is untouched (see Out of
  Scope).

### 3. Remove the detail route

- Delete `src/app/features/campground-detail/` (component, template,
  spec) entirely.
- Remove the `campground/:id` route from `app.routes.ts`.

## Files Touched

- `src/app/features/finder/finder.component.ts` / `.html` — near-me
  toggle, radius select, `onFilterChange` rename, `SHOW_ALL_RADIUS_M`.
- `src/app/features/finder/campground-table/campground-table.component.ts`
  — drop `routerLink`, add expand/collapse state and the expanded-row
  template.
- New: `src/app/features/finder/campground-table/campground-detail-panel/campground-detail-panel.component.ts`
  (+ `.html`) — the inline detail content, with the `[innerHTML]` fix.
- `src/app/app.routes.ts` — remove the `campground/:id` route.
- Delete: `src/app/features/campground-detail/*`.

## Testing

- Update `campground-table.component.spec.ts`: clicking a name expands
  it, clicking again collapses it, only one row expanded at a time.
- Add a spec for `CampgroundDetailPanelComponent` covering the
  `[innerHTML]` rendering of a description containing markup.
- Update `finder.component.spec.ts`: near-me toggle forwards the selected
  radius (converted to meters) as `max_distance_m`; toggle off forwards
  `SHOW_ALL_RADIUS_M`; agency changes still forward correctly through the
  renamed `onFilterChange`.
- Delete `campground-detail.component.spec.ts`.
- Manual verification in the browser: toggle near-me on/off and confirm
  the result set changes, change the radius preset, expand/collapse a
  row on both Finder and Favorites, confirm a description with embedded
  HTML now renders instead of showing raw tags.

## Implementation Plan

- [x] **Task 1** — Remove the detail route: delete
      `src/app/features/campground-detail/*`, remove the route from
      `app.routes.ts`, delete its spec.
- [x] **Task 2** — Build `CampgroundDetailPanelComponent` with the
      `[innerHTML]` description fix; add its spec.
- [x] **Task 3** — Wire inline row expansion into
      `CampgroundTableComponent` (drop `routerLink`, add expand state and
      template, mount the new panel); update its spec.
- [x] **Task 4** — Add the near-me toggle + radius `p-select` to
      `FinderComponent`, rename `onFilterChange`, add
      `SHOW_ALL_RADIUS_M` and the meters conversion; update its spec.
- [x] **Task 5** — Run the full test suite; manually verify in the
      browser (dev server) per the Testing section above.
- [x] **Task 6** (added during Task 5's manual verification) — Manual
      browser testing against live data found "Show all" only returned
      1000 rows, not all ~4,894: Supabase/PostgREST caps any single
      response at its default `max-rows` (1000), regardless of the RPC's
      own `LIMIT`. Fixed by paginating `CampgroundsService.getNearest`
      with `.range()` requests until a page comes back short of 1000.
      Verified live: 5 requests, 1000+1000+1000+1000+894 rows, totaling
      exactly the table's 4,894 rows.

## Verification

- Full suite: 179/179 tests passing.
- Production build: clean (pre-existing bundle-budget and leaflet-CJS
  warnings only, unrelated to this change).
- Live browser run (Playwright against the real Supabase project,
  geolocation set near Jefferson City, MO):
  - Show all (near-me off): RPC returns all 4,894 rows across 5 paginated
    requests.
  - Near me at 50 mi: 0 rows (nearest real campground is ~57 mi away —
    confirms the radius cap is exact, not a bug).
  - Near me at 100 mi: 30 rows, map and table update correctly.
  - Row expansion: clicking a name renders the inline detail panel with
    real rendered HTML (headings, paragraphs, working links), collapses
    on a second click.
  - No console or page errors in any of the above.
