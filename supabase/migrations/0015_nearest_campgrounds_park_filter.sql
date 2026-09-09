-- Unlike state_filter (0014), park_filter has no null-tolerant clause: a
-- null park_code means the campground genuinely isn't part of any NPS unit
-- (RIDB-sourced USFS/BLM/USACE/FWS campgrounds never have one) rather than
-- data that just hasn't been backfilled yet, so filtering to specific parks
-- should exclude those rows, not show them anyway.
--
-- Adding a new trailing parameter changes the function's signature, and
-- CREATE OR REPLACE FUNCTION can't do that (see 0013) — drop and recreate.
drop function public.nearest_campgrounds(double precision, double precision, int, text[], double precision, text[]);

create function public.nearest_campgrounds(
  user_lat double precision,
  user_lng double precision,
  result_limit int default 50,
  agency_filter text[] default null,
  max_distance_m double precision default null,
  state_filter text[] default null,
  park_filter text[] default null
)
returns table (
  id text,
  park_code text,
  name text,
  description text,
  lat double precision,
  lng double precision,
  agency text,
  state text,
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
    c.agency, c.state, c.amenities, c.fees, c.reservation_url, c.directions_url,
    c.images, c.contact,
    st_distance(c.location, st_setsrid(st_point(user_lng, user_lat), 4326)::geography) as distance_m
  from public.campgrounds c
  where (agency_filter is null or c.agency = any(agency_filter))
    and (state_filter is null or c.state is null or c.state = any(state_filter))
    and (park_filter is null or c.park_code = any(park_filter))
    and (
      max_distance_m is null
      or st_dwithin(c.location, st_setsrid(st_point(user_lng, user_lat), 4326)::geography, max_distance_m)
    )
  order by c.location <-> st_setsrid(st_point(user_lng, user_lat), 4326)::geography
  limit (case when max_distance_m is not null then null else result_limit end);
$$;

grant execute on function public.nearest_campgrounds(double precision, double precision, int, text[], double precision, text[], text[]) to anon, authenticated;
