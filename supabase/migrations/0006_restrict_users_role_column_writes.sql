-- Restrict column-level UPDATE privileges on public.users so that
-- authenticated users can only ever write display_name and theme via
-- PostgREST. The existing "users can update own profile" RLS policy
-- already restricts *which row* can be updated (owner-only); this grant
-- restricts *which columns* -- never id or role. Without this, any
-- signed-in user could currently run
--   supabase.from('users').update({ role: 'admin' }).eq('id', myId)
-- from the browser console and succeed, pre-seeding a privilege
-- escalation the moment any future feature starts consuming role.
revoke update on public.users from anon, authenticated;
grant update (display_name, theme) on public.users to authenticated;
