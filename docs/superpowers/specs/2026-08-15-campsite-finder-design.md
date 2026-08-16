# CampsiteFinder — Design

## Context

CampsiteFinder is a new project in the `PrimeNG` folder, built primarily as
a learning vehicle for Angular + PrimeNG (paired with the "Ralph Wiggum"
agentic loop workflow already in use on the sibling `AlienHunter01`
project). The app itself: find the nearest federal campground using the
National Park Service's public API, view it on a map and in a sortable
list, and (for signed-in subscribers) save favorites.

It deliberately reuses patterns already proven in AlienHunter01 (Leaflet
map, Supabase auth/RLS, list+map combined view) so the comparison is
Angular/PrimeNG vs. React on a familiar problem shape, not a fight with
unfamiliar architecture at the same time.

Data source: [NPS Data API](https://www.nps.gov/subjects/developer/api-documentation.htm),
base URL `https://developer.nps.gov/api/v1/`, free API key required. The
API returns campground-level data (location, amenities, fees, reservation
links) but has **no radius/proximity search** and **no live individual-site
booking availability** — both addressed below.

## Goals

- Given the user's location (or a manually entered one), show the nearest
  federal campgrounds on a map and in a filterable/sortable table.
- Let signed-in subscribers save campgrounds to a favorites list and view
  it later.
- Ship as a responsive PWA — one Angular/PrimeNG codebase usable on desktop
  browser and installed on a phone.

## Out of Scope (v1)

- **Live individual-campsite booking availability.** recreation.gov owns
  actual site-level reservations and has no public API; this app links out
  to the official reservation page instead of showing real-time site status.
- **Native mobile app** (Ionic/Capacitor, app-store distribution). PWA only
  for now; a native wrapper is a possible later phase.
- **Push notifications / alerts** (e.g. NPS `/alerts` integration, availability
  alerts). Not built in v1.
- **Multi-user social features** (sharing lists, comments, ratings). Not
  built in v1.

## Architecture Overview

```
                     ┌─────────────────────┐
   weekly cron ────► │ Supabase Edge Func   │ ── calls NPS API (server-side
                     │ (nps-sync)           │    key, never exposed to client)
                     └──────────┬───────────┘
                                │ upsert
                                ▼
                     ┌─────────────────────┐
                     │ Supabase Postgres    │
                     │ - campgrounds (PostGIS)
                     │ - favorites          │
                     │ - profiles           │
                     └──────────┬───────────┘
                                │ direct queries (anon key, RLS-scoped)
                                ▼
                     ┌─────────────────────┐
                     │ Angular + PrimeNG    │
                     │ PWA (web + phone)    │
                     │ - Leaflet map        │
                     │ - PrimeNG DataTable  │
                     └─────────────────────┘
```

- **Frontend:** Angular (standalone components, latest stable) + PrimeNG
  (Aura theme preset), built as a PWA via `@angular/pwa`.
- **Map:** Leaflet via `ngx-leaflet`, OpenStreetMap tiles — same stack as
  AlienHunter01. No API key needed.
- **Backend:** Supabase — Postgres with the PostGIS extension enabled,
  Supabase Auth for subscribers, and a scheduled Edge Function that syncs
  NPS data server-side.
- The NPS API key lives only in the Edge Function's environment (Supabase
  secret). The Angular app never calls `developer.nps.gov` directly — it
  only ever talks to Supabase.

## Data Model

```sql
-- Cached/synced copy of NPS campground data
create table campgrounds (
  id text primary key,              -- NPS campground id
  park_code text not null,
  name text not null,
  description text,
  location geography(Point, 4326) not null,
  amenities jsonb,                  -- toilets, showers, internet, etc.
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
-- no insert/update/delete policies for anon/authenticated: only the
-- Edge Function (service role key) writes to this table.

-- Public-safe user profile, mirrors AlienHunter01's pattern
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
);

alter table profiles enable row level security;
create policy "anyone can read profiles" on profiles for select using (true);
create policy "users can insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "users can update own profile" on profiles for update using (auth.uid() = id);

-- Favorites join table
create table favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  campground_id text not null references campgrounds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, campground_id)
);

alter table favorites enable row level security;
create policy "users manage own favorites" on favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Nearest-campground queries use PostGIS distance ordering, e.g.:

```sql
select *, location <-> st_point(:lng, :lat)::geography as distance_m
from campgrounds
order by location <-> st_point(:lng, :lat)::geography
limit 50;
```

## NPS Data Sync

- A Supabase Edge Function (`nps-sync`), run on a `pg_cron` schedule
  (weekly — campground amenities/fees rarely change), fetches
  `/campgrounds` from the NPS API, paged across all parks/states, and
  upserts rows into `campgrounds` using the service role key.
- **Failure handling:** the sync is idempotent (upsert on `id`), so a
  partial run followed by a retry self-heals. If the NPS API call fails
  entirely, the function logs and exits without touching existing data —
  stale cached data is preferred over wiping the table.
- The function can also be invoked manually (via the Supabase dashboard or
  CLI) for the initial seed and for ad-hoc refreshes during development.

## Frontend Structure

- **Finder view (default route):** map + PrimeNG `DataTable` side by side
  (stacked on narrow/phone widths). Selecting a table row centers/highlights
  the corresponding map marker and vice versa — same interaction pattern as
  AlienHunter01's sighting-focus feature.
- **Location input:** browser Geolocation API on load (with permission
  prompt); if denied or unavailable (e.g. desktop without location
  services), fall back to a manual location search field.
- **Campground detail:** name, description, amenities, fees, images,
  contact info, and a link out to the official reservation page.
- **Auth pages:** sign up / sign in (email + password, matching
  AlienHunter01's Supabase Auth pattern), with email verification.
- **Favorites view:** signed-in only; list of saved campgrounds, same
  map+table pattern as the Finder view. A heart/star toggle on each
  campground (Finder or detail view) adds/removes it.
- Browsing and searching is open to everyone; only favoriting requires
  sign-in, enforced via RLS, not just hidden UI.

## PWA

- `@angular/pwa` service worker for the app shell (installable, works
  offline for the UI chrome). Campground data itself is not cached for
  full offline use in v1 — a network error while querying Supabase shows
  an inline error state, not stale data.
- Web app manifest with icons sized for phone home-screen installation.

## Error Handling

- **NPS sync failures:** logged in the Edge Function, existing cached data
  retained (see above).
- **Geolocation denied/unavailable:** fall back to manual location entry;
  never block the Finder view entirely.
- **Supabase query failures (client):** inline error state with a retry
  action; no silent failures.
- **Auth errors:** standard Supabase Auth error surfaces (invalid
  credentials, unverified email) shown inline on the form.

## Testing

- Unit tests for the distance-query service (mocked Supabase client) and
  any pure geolocation/formatting utilities.
- Component tests for the Finder view's list↔map selection sync.
- The Edge Function's upsert logic tested against a sample NPS API
  response fixture (paging, partial-failure retention).
- No end-to-end test suite in v1 — matches AlienHunter01's current scope;
  can be added later if the app grows.

## Open Questions / Future Phases

- Native mobile app (Ionic/Capacitor) — deferred, no committed phase yet.
- Live site-availability data — deferred; would require investigating
  recreation.gov's (unofficial/undocumented) options separately.
- Push/email alerts for new favorites' status — deferred.
