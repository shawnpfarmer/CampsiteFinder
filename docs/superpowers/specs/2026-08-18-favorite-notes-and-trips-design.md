# Favorite Notes & Trip Planning — Design

## Context

CampsiteFinder (Tasks 1–14) already lets a signed-in user favorite a
campground (heart toggle) and view their favorites on a dedicated page
(map + table, synced selection, same pattern as the Finder view). This
spec extends that: a favorite can carry a free-text note, and a user
can select a batch of favorited campgrounds and save them, in order,
as a named "trip" — then keep editing that trip (reorder stops,
add/remove stops, rename, delete) as a standalone plan.

## Goals

- A favorited campground can have a short personal note attached to it
  ("great tent sites, book early"), editable inline on the Favorites page.
- A user can select a subset of their favorited campgrounds and save
  them as an ordered, named trip.
- A trip is independent of favorites once created — un-favoriting a
  campground does not remove it from any trip it's already part of.
- A trip can be freely edited afterward: reorder stops (drag-and-drop),
  add more stops, remove a stop, rename the trip, delete the trip.
- Viewing a trip shows its stops as an ordered route on the map
  (numbered markers, connecting line), not just a cluster of pins.

## Out of Scope (this feature, v1)

- ~~A cross-page "trip tray" for adding to a trip from anywhere
  (Finder, detail page) — trips are built from the Favorites page only.
  Considered as an approach, rejected for v1: bigger UI surface, and
  not what was asked for. Could be a later phase if the dedicated
  Favorites-page flow feels limiting in practice.~~ — shipped
  2026-08-23, see [Add to Trip Everywhere Addendum](#add-to-trip-everywhere-addendum-2026-08-23)
  below.
- Shared/collaborative trips — a trip has exactly one owner, same
  single-user model as favorites. No viewing or editing another user's
  trip.
- Trip export, printing, PDF itinerary, or calendar integration.
- Rich text or markdown in notes — plain text only.
- Note history/versioning — editing a note overwrites it, last write wins.
- Turn-by-turn routing or drive-time estimates between stops — the map
  shows visual order (numbered pins + a connecting line), not driving
  directions.
- Duplicate-stop prevention — a campground may appear more than once in
  the same trip (e.g., a loop route that returns to an earlier stop).
  Not constrained at the database level.

## Data Model

Extend the existing `favorites` table:

```sql
alter table favorites add column note text;
```

No new RLS policy needed — the existing "users manage own favorites"
policy (`for all using (auth.uid() = user_id) with check (auth.uid() =
user_id)`) already covers reading and writing the new column.

Two new tables:

```sql
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
```

`position` is a plain `0, 1, 2, ...` integer. A reorder rewrites every
stop's `position` for that trip in one round trip — trips are small
(a handful of stops), so this is cheap and avoids fractional-position
bookkeeping. `trip_stops.id` is its own primary key (not
`(trip_id, campground_id)`) specifically because duplicate stops in
one trip are allowed (see Out of Scope).

No new database functions are needed. `CampgroundsService.getByIds`
(already built for Task 13/14) hydrates a trip's stops from their
campground IDs; the client re-sorts the hydrated results into
`position` order, since `getByIds`/its RPC does not guarantee
input-order-preserving output.

## Service Layer

**`FavoritesService`** (`src/app/core/services/favorites.service.ts`) gains:

- `favoriteNotes: Signal<Map<string, string | null>>` — populated
  alongside the existing `favoriteIds` signal by extending
  `loadFavoriteIds()`'s query from `select('campground_id')` to
  `select('campground_id, note')`. `favoriteIds` itself is untouched
  (`FavoriteToggleComponent` keeps working exactly as it does today).
- `updateNote(campgroundId: string, note: string): Promise<void>` —
  updates the existing favorites row's `note` column for the current
  user and updates the local `favoriteNotes` map. (The row must already
  exist — you can only note something you've favorited.)

**New `TripsService`** (`src/app/core/services/trips.service.ts`):

```ts
export interface Trip {
  id: string;
  name: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class TripsService {
  readonly trips = signal<Trip[]>([]);

  async loadTrips(): Promise<void>;
  async createTrip(name: string, campgroundIds: string[]): Promise<string>; // returns new trip id
  async getTrip(tripId: string): Promise<Trip | null>;
  async getTripStops(tripId: string): Promise<Campground[]>; // hydrated, position-ordered
  async reorderStops(tripId: string, orderedCampgroundIds: string[]): Promise<void>;
  async addStop(tripId: string, campgroundId: string): Promise<void>;
  async removeStop(tripId: string, stopId: string): Promise<void>;
  async renameTrip(tripId: string, name: string): Promise<void>;
  async deleteTrip(tripId: string): Promise<void>; // cascades to trip_stops
}
```

All methods scope to `auth.uid()` implicitly via RLS — no explicit
`user_id` filtering needed in application code beyond what RLS already
enforces (same pattern as `FavoritesService`).

## Favorites Page Changes

**Note column.** `CampgroundTableComponent` gains a `showNotes: boolean
= false` input — same additive, opt-in pattern as the existing
`showDistance` input from Task 13 (default `false`, so Finder's usage
is unaffected). When `true`, an extra column renders a plain text
input bound to the row's note, saving via `FavoritesService.updateNote`
on blur. `FavoritesComponent` passes `[showNotes]="true"` and supplies
the notes map.

**"Plan a trip" panel (Approach A).** A toggle button on the Favorites
page reveals a separate, dedicated panel — not a mode of the shared
table — listing the user's favorited campgrounds as a plain checklist
(name + checkbox), a trip-name text input, and a "Save Trip" button
(disabled until a name is entered and at least one campground is
checked). This keeps `CampgroundTableComponent`'s existing single-row
map-sync selection completely untouched; the checklist is its own
small piece of UI with its own local selection state. On save: calls
`TripsService.createTrip(name, selectedIds)` (stop order = the order
items were checked) and navigates to the new trip's detail page.

## Trips Views

**Nav.** A fourth nav item, "Trips," alongside Finder/Favorites/Sign
in-out — same `authGuard`-protected pattern as Favorites.

**`TripsListComponent`** at route `trips` (guarded): a simple PrimeNG
table of the user's trips (name, stop count, created date). Clicking a
row navigates to `trips/:id`. A delete action per row (confirmed via the browser's native
`window.confirm()` — not a new PrimeNG `ConfirmDialog`/
`ConfirmationService` module, to avoid introducing another untested
PrimeNG API surface into a project that has repeatedly hit version
mismatches in this exact library). No "create" affordance here — trips are born on the
Favorites page (Approach A); an empty-state message points there when
the user has none yet.

**`TripDetailComponent`** at route `trips/:id` (guarded): trip name
(inline-editable via an edit icon, calling `renameTrip`), an ordered
map (see below), and a reorderable table of stops using PrimeNG's
built-in row reorder (`[reorderableRows]="true"` / `pReorderableRow` /
`(onRowReorder)` — a drag handle per row), which calls `reorderStops`
with the new order on drop. Each stop row has a "Remove" action
(`removeStop`). An "Add a stop" control lists the user's favorited
campgrounds not already in this trip (reusing `FavoritesService`'s
loaded data) and calls `addStop`. A "Delete trip" button (confirmed via
`window.confirm()`, same reasoning as above) navigates back to `trips`
on success.

**Ordered map.** `CampgroundMapComponent` gains an `ordered: boolean =
false` input — default `false` preserves Finder/Favorites' current
unordered-pin behavior untouched. When `true` (used only by
`TripDetailComponent`), markers render as numbered icons (1, 2, 3, ...
in array order) via a small custom Leaflet `DivIcon`, and an
`L.polyline` connects them in that same order. This is plain Leaflet
API — no PrimeNG involved, so none of this project's PrimeNG
version-mismatch risk applies here.

## Error Handling

Follows the app's existing pattern throughout: service methods
propagate Supabase errors (`if (error) throw error`); components catch
and surface a message via the same `p-message` pattern already used on
Finder/Login/Signup, rather than failing silently. `TripDetailComponent`
treats a trip id that doesn't resolve (deleted, or not owned by this
user — RLS returns nothing) the same way `CampgroundDetailComponent`
treats an unknown campground id: a "not found" state, not a crash.

## Testing

Unit tests, mirroring this project's established patterns
(TestBed + Vitest-native `vi.fn()`/`.mockResolvedValue()`, not
Jasmine):

- Migration: applied and verified via `execute_sql` (schema + RLS
  present), same as every prior schema task.
- `FavoritesService`: `favoriteNotes` populated by `loadFavoriteIds()`,
  `updateNote` updates both the row and the local map.
- `TripsService`: one test per method against a mocked Supabase client
  (create, get, reorder, add, remove, rename, delete), matching
  `CampgroundsService.spec.ts`'s existing mocking style.
- `CampgroundTableComponent`: `showNotes` column presence/absence,
  mirroring the existing `showDistance` test pair.
- `CampgroundMapComponent`: `ordered` produces numbered markers + a
  polyline layer, mirroring the existing `markerLayers` test.
- `TripsListComponent`, `TripDetailComponent`: load, reorder, add,
  remove, rename, delete interactions against mocked services.

Per this project's standing rule (established after Task 10 surfaced
seven real bugs that no unit test caught), no task in the resulting
implementation plan is considered verified until driven in a real
browser: create a trip from Favorites, reorder it, add/remove a stop,
rename it, delete it, and add/edit a note — end to end, with console
errors checked.

## Open Questions / Future Phases

- ~~The cross-page "trip tray" (Approach C, rejected for v1) if the
  Favorites-only creation flow proves limiting.~~ — shipped
  2026-08-23, see addendum below.
- Drive-time/distance-between-stops on a trip — would need a routing
  API beyond what NPS/PostGIS provide today; explicitly deferred above.
- Collaborative/shared trips — would need a new sharing/permissions
  model beyond the current single-owner RLS pattern; explicitly
  deferred above.
- **Paywall/entitlement gating on "Add to Trip."** Requested as the
  motivation for shipping this everywhere now (see addendum), but
  explicitly deferred — `addStop`/`createTrip` stay open to any
  signed-in user until an entitlements model exists.

## Add to Trip Everywhere Addendum (2026-08-23)

Extends the "Plan a trip" flow (Favorites-only, batch creation) with a
per-campground "Add to Trip" action available everywhere a campground
is shown, so a stop can be added to an existing trip (or a
newly-named one) without visiting the Favorites page first. Requested
as groundwork for a future paid tier — no entitlement/paywall logic
shipped with this; every signed-in user can use it for now.

- **`TripsService.getTripIdsForCampground(campgroundId)`** — new
  method; queries `trip_stops` for a campground, relying on RLS
  (already scoped via `trips.user_id`) instead of an explicit join, to
  tell the UI which of the user's trips already contain a campground.
- **New shared `AddToTripComponent`** (`src/app/shared/add-to-trip/`,
  mirrors `FavoriteToggleComponent`'s auth-gated pattern) — a button
  that opens a `p-popover` listing the user's trips (already-containing
  ones shown disabled) plus a new-trip-name input. One implementation,
  reused everywhere it's wired in, so behavior is identical across
  surfaces.
- **Wired into `CampgroundTableComponent`** (covers Finder and
  Favorites, since both reuse this component) **and
  `CampgroundDetailComponent`** — both plain Angular templates, so the
  shared component drops in directly.
- **`CampgroundMapComponent`'s Leaflet popups get a deliberately
  simpler treatment**, not `AddToTripComponent`: Leaflet popups sit
  outside Angular's view tree, so hosting the full popover there would
  mean manually managing an Angular component's lifecycle
  (`ViewContainerRef.createComponent`/destroy) on every marker rebuild.
  Instead, popups are built as plain DOM with a single "Add to Trip"
  button, wired via a direct `addEventListener` at creation time (no
  Angular involved), that adds the campground to the user's
  most-recently-created trip (`trips()[0]`, since `loadTrips` already
  orders newest-first) — no in-popup picker. The button is omitted
  entirely when signed out or when the user has no trips yet.
- **No favorite-required gate** — a campground can be added to a trip
  directly from Finder results without ever being favorited first,
  since `trip_stops.campground_id` has no dependency on `favorites`.
