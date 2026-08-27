alter table public.users add column suspended boolean not null default false;

create table public.campground_attributes (
  id uuid primary key default gen_random_uuid(),
  campground_id text not null references public.campgrounds (id) on delete cascade,
  type text not null,
  name text not null,
  value text,
  created_at timestamptz not null default now()
);

alter table public.campground_attributes enable row level security;

create function public.is_admin(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.users where id = uid and role = 'admin');
$$;

create policy "admins manage campground attributes" on public.campground_attributes
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create function public.get_users_for_admin()
returns table (id uuid, email text, display_name text, role text, suspended boolean, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  return query
    select u.id, au.email::text, u.display_name, u.role, u.suspended, au.created_at
    from public.users u
    join auth.users au on au.id = u.id
    order by au.created_at desc;
end;
$$;

create function public.admin_update_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot modify your own role';
  end if;
  if new_role not in ('user', 'moderator', 'admin') then
    raise exception 'invalid role';
  end if;
  update public.users set role = new_role where id = target_user_id;
end;
$$;

create function public.admin_set_user_suspended(target_user_id uuid, is_suspended boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot modify your own suspension';
  end if;
  update public.users set suspended = is_suspended where id = target_user_id;
end;
$$;

revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.get_users_for_admin() from public, anon;
revoke execute on function public.admin_update_user_role(uuid, text) from public, anon;
revoke execute on function public.admin_set_user_suspended(uuid, boolean) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.get_users_for_admin() to authenticated;
grant execute on function public.admin_update_user_role(uuid, text) to authenticated;
grant execute on function public.admin_set_user_suspended(uuid, boolean) to authenticated;
