# Why the Midwest Map Looks Sparse, and How to Add BLM (and Other Federal) Campgrounds — Analysis

## Root cause (confirmed from the CampsiteFinder repo, shawnpfarmer/CampsiteFinder)

The app has exactly one data source: the NPS Data API
(`https://developer.nps.gov/api/v1/campgrounds`), pulled weekly by the
Supabase edge function `supabase/functions/nps-sync`, upserted into a
single `campgrounds` Postgres table, and served to the Angular frontend via
the `nearest_campgrounds` RPC (see
[2026-08-15-campsite-finder-design.md](2026-08-15-campsite-finder-design.md),
which explicitly scopes v1 to NPS data only).

NPS = National Park Service units only (national parks, monuments,
seashores, etc.). It does not include: BLM (Bureau of Land Management),
USFS (national forests), USACE (Army Corps of Engineers reservoir
campgrounds), or USFWS refuges. In the Midwest, NPS units are sparse, so the
map looks empty even though there's plenty of federal camping nearby
(national forests, Corps of Engineers lake campgrounds).

## Important nuance on BLM specifically

BLM's surface land holdings are heavily concentrated in ~12 western states.
In the Midwest, BLM (via its Eastern States district) manages only
scattered, minor parcels — e.g. Lake Vermilion and some Wisconsin River
islands in Minnesota/Wisconsin — with very few developed campgrounds.
Adding BLM alone will barely move the needle on Midwest coverage.

What will actually fix the "not enough campsites" problem is adding US
Forest Service (national forests: Chequamegon-Nicolet, Chippewa, Superior,
Hiawatha, Ottawa, Huron-Manistee, Shawnee, Hoosier, Mark Twain, Black Hills,
etc.) and US Army Corps of Engineers reservoir campgrounds, both of which
are heavily present across the Midwest.

## Recommended fix: switch/add Recreation.gov's RIDB API

RIDB (Recreation Information Database, `https://ridb.recreation.gov/api/v1`)
is the federal government's unified recreation data API — it aggregates
facilities from NPS, USFS, BLM, USACE, USFWS, and Bureau of Reclamation in
one schema (`/facilities`, filterable by state/activity, with
organization/agency linkage). Free API key. This is a drop-in architectural
sibling to the existing `nps-sync` function.

### Plan sketch

- New Supabase migration: add an `agency` (or `source`) column to
  `campgrounds`, and namespace `id` values per source (e.g.
  `ridb:<FacilityID>`) to avoid collisions with existing NPS ids.
- New edge function `ridb-sync`, structured like `nps-sync`: paginate
  `/facilities`, filter to campground-type facilities, resolve the
  managing agency, upsert.
- Update `campground.model.ts` / `campgrounds.service.ts` / finder UI to
  expose an agency filter/badge.
- Requires the user to sign up for a free RIDB API key at
  ridb.recreation.gov and store it as a Supabase secret (`RIDB_API_KEY`).

This plan sketch is fleshed out into a full implementation design in
[2026-08-28-ridb-multi-agency-campground-design.md](2026-08-28-ridb-multi-agency-campground-design.md),
including the exact migration SQL, the RPC function changes, and the
frontend changes — see that doc for anything beyond the high-level shape
above.

## Status as of 2026-08-28

Not yet implemented — pending decision on scope (BLM-only vs. all
agencies) and the user obtaining an RIDB API key.
