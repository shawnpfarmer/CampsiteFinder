alter table public.campgrounds
  add column agency text not null default 'NPS',
  add column source text not null default 'nps',
  alter column park_code drop not null;

create index campgrounds_agency_idx on public.campgrounds (agency);
