alter table public.profiles rename to users;

alter table public.users
  add column theme text check (theme in ('light', 'dark')),
  add column role text not null default 'user' check (role in ('user', 'moderator', 'admin'));
