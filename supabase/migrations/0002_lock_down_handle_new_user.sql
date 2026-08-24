-- handle_new_user() is a trigger for on_auth_user_created; it should only ever
-- run via that trigger (fired by supabase_auth_admin), not be callable directly
-- through PostgREST at /rest/v1/rpc/handle_new_user. Revoking the default PUBLIC
-- execute grant does not affect trigger firing, since Postgres invokes trigger
-- functions internally rather than through an ACL-checked call.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
