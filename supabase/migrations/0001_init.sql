create extension if not exists postgis;

create table campgrounds (
  id text primary key,
  park_code text not null,
  name text not null,
  description text,
  location geography(Point, 4326) not null,
  amenities jsonb,
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
-- no insert/update/delete policy for anon/authenticated: only the
-- nps-sync Edge Function (service role key) writes to this table.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
);

alter table profiles enable row level security;
create policy "anyone can read profiles" on profiles for select using (true);
create policy "users can insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "users can update own profile" on profiles for update using (auth.uid() = id);

create function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

create table favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  campground_id text not null references campgrounds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, campground_id)
);

alter table favorites enable row level security;
create policy "users manage own favorites" on favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function nearest_campgrounds(
  user_lat double precision,
  user_lng double precision,
  result_limit int default 50
)
returns table (
  id text,
  park_code text,
  name text,
  description text,
  lat double precision,
  lng double precision,
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
    c.id,
    c.park_code,
    c.name,
    c.description,
    st_y(c.location::geometry) as lat,
    st_x(c.location::geometry) as lng,
    c.amenities,
    c.fees,
    c.reservation_url,
    c.directions_url,
    c.images,
    c.contact,
    st_distance(c.location, st_setsrid(st_point(user_lng, user_lat), 4326)::geography) as distance_m
  from campgrounds c
  order by c.location <-> st_setsrid(st_point(user_lng, user_lat), 4326)::geography
  limit result_limit;
$$;

grant execute on function nearest_campgrounds(double precision, double precision, int) to anon, authenticated;

create or replace function get_campgrounds_by_ids(campground_ids text[])
returns table (
  id text,
  park_code text,
  name text,
  description text,
  lat double precision,
  lng double precision,
  amenities jsonb,
  fees jsonb,
  reservation_url text,
  directions_url text,
  images jsonb,
  contact jsonb
)
language sql
stable
as $$
  select
    c.id,
    c.park_code,
    c.name,
    c.description,
    st_y(c.location::geometry) as lat,
    st_x(c.location::geometry) as lng,
    c.amenities,
    c.fees,
    c.reservation_url,
    c.directions_url,
    c.images,
    c.contact
  from campgrounds c
  where c.id = any(campground_ids);
$$;

grant execute on function get_campgrounds_by_ids(text[]) to anon, authenticated;
