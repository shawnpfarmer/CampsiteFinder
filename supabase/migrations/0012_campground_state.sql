alter table public.campgrounds add column state text;
create index campgrounds_state_idx on public.campgrounds (state);
