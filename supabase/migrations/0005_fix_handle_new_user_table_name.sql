-- Migration 0004 renamed public.profiles to public.users but left
-- handle_new_user() (the on_auth_user_created trigger function) still
-- inserting into public.profiles, which no longer exists. This broke every
-- new signup with "Database error saving new user" (the trigger raises
-- relation "public.profiles" does not exist, which auth.users' insert
-- trigger surfaces as a generic 500). Repoint it at public.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;
