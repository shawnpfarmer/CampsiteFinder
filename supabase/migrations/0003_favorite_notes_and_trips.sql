alter table favorites add column note text;

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

create index trip_stops_trip_id_idx on trip_stops (trip_id);
