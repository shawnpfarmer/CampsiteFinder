drop function nearest_campgrounds(double precision, double precision, int, text[], double precision);
drop function get_campgrounds_by_ids(text[], text[]);

create function public.nearest_campgrounds(
  user_lat double precision,
  user_lng double precision,
  result_limit int default 50,
  agency_filter text[] default null,
  max_distance_m double precision default null,
  state_filter text[] default null
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
    and (state_filter is null or c.state = any(state_filter))
    and (
      max_distance_m is null
      or st_dwithin(c.location, st_setsrid(st_point(user_lng, user_lat), 4326)::geography, max_distance_m)
    )
  order by c.location <-> st_setsrid(st_point(user_lng, user_lat), 4326)::geography
  limit (case when max_distance_m is not null then null else result_limit end);
$$;

grant execute on function public.nearest_campgrounds(double precision, double precision, int, text[], double precision, text[]) to anon, authenticated;

create function public.get_campgrounds_by_ids(campground_ids text[], agency_filter text[] default null)
returns table (
  id text, park_code text, name text, description text,
  lat double precision, lng double precision, agency text, state text,
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
    c.agency, c.state, c.amenities, c.fees, c.reservation_url, c.directions_url,
    c.images, c.contact
  from public.campgrounds c
  where c.id = any(campground_ids)
    and (agency_filter is null or c.agency = any(agency_filter));
$$;

grant execute on function public.get_campgrounds_by_ids(text[], text[]) to anon, authenticated;
