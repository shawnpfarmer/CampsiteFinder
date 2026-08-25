# Campground Admin Page — Design

## Context

The [user account model work](2026-08-23-user-account-model-design.md) added
a `role` column to `public.users` (`'user' | 'moderator' | 'admin'`) as
groundwork, explicitly deferring any feature that consumes it. This spec is
that first consumer: an admin-only page for managing users (view, change
role, suspend/unsuspend, delete another user's account) and for attaching
free-form "attributes" to campgrounds (a `type`/`name`/`value` record per
campground) — the closest CampsiteFinder equivalent to how AlienHunter01
lets admins manage `sighting_field_options`.

Campground data itself (`public.campgrounds`) is a read-only mirror of the
NPS API, refreshed by the existing `nps-sync` Edge Function's `upsert` on
every sync run. Attributes must not be columns on that table — an `upsert`
that doesn't mention a column leaves it alone, so in principle a column
would survive syncs too, but keeping attributes as their own table makes
that safety independent of `nps-sync`'s implementation rather than
incidental to it, and lets a campground carry an arbitrary number of
attributes rather than a fixed set of columns.

## Goals

- An `/admin` route, visible and reachable only to users with `role =
  'admin'` (not `moderator` — that role stays unused groundwork, same as
  today).
- **Users tab:** list all users (email, display name, role, suspended
  status, created date); change a user's role; suspend/unsuspend a user;
  delete another user's account entirely.
- **Campground Attributes tab:** pick a campground, then view/add/edit/
  delete `type`/`name`/`value` records attached to it.
- Suspension actually blocks sign-in for the suspended user going forward.

## Out of Scope (this phase)

- Displaying campground attributes anywhere public-facing (campground
  detail page, Finder, etc.) — admin-only visibility for now, per explicit
  decision. A later phase can surface them once real attribute data exists
  and it's clear what's worth showing.
- A separate "attribute definitions" table constraining which `type`/`name`
  combinations are allowed. `type` and `name` are free text, admin-entered,
  no schema-level enum — the same simplicity trade AlienHunter01's
  `sighting_field_options` made in the other direction (it constrains a
  fixed set of sighting form fields; this app has no such fixed set yet).
- Forcibly ending an already-active session when a user is suspended.
  Suspension is checked at sign-in time only; a user already signed in when
  suspended keeps their session until it naturally expires or they sign out.
  (Supabase's native `ban_duration` mechanism *would* close this gap, but a
  custom flag was the explicit choice here — see Design Decisions below.)
- Moderator-role permissions of any kind. `moderator` remains inert
  groundwork; this entire page is gated on `role = 'admin'` only.
- Bulk actions (bulk role change, bulk suspend, bulk delete) — one user or
  one attribute at a time.
- An audit log of admin actions (who changed what, when).
- Any UI for granting the *first* admin — see Bootstrap below; it's a
  one-time manual step, not a feature.

## Design Decisions

**Suspend via a custom `suspended` column, not Supabase's native ban.**
Explicit choice over `auth.admin.updateUserById({ ban_duration })`: keeps
the state visible in `public.users` (readable the same way `role`/`theme`
already are) rather than inside Supabase's internal auth state, at the cost
of enforcing it ourselves. Enforcement point: `LoginComponent.onSubmit()`,
immediately after a successful `signInWithPassword` — query
`public.users.suspended` for the signed-in id (`public.users` is
readable-by-anyone via its existing RLS policy, so this needs no new grant),
and if `true`, call `signOut()` immediately and show "This account has been
suspended" instead of navigating in. This is a client-side gate, consistent
with how `authGuard` already gates routes client-side — not airtight against
someone bypassing the Angular client entirely, but consistent with this
app's existing security posture and proportionate to a personal project's
threat model.

**Admin actions go through `SECURITY DEFINER` RPCs, not RLS+grants.** The
account-model migration `0006` deliberately locked `public.users` down
(`authenticated` can only write `display_name`/`theme` on their own row).
Reopening that with admin-scoped RLS policies means the "is this caller
actually an admin" check gets duplicated across every policy that needs it.
Instead, following AlienHunter01's proven pattern
(`get_users_for_admin()`, `admin_update_user_role()`): a small `is_admin(uid
uuid) returns boolean` SQL helper, and one `SECURITY DEFINER` RPC per admin
action, each starting with `if not is_admin(auth.uid()) then raise
exception 'not authorized'; end if;`. RPCs run as their owner regardless of
the caller's own grants, so no new column grants are needed on
`public.users` for `role`/`suspended` — `authenticated` still can't write
either column directly.

**Admin-deleting another user is a separate Edge Function
(`admin-delete-account`), not a parameter on the existing
`delete-account`.** The existing function infers *who* to delete entirely
from the caller's own verified JWT — it has no notion of a target different
from the caller, by design, precisely to make an IDOR bug structurally
impossible. Adding a caller-suppliable target id to that same function would
reintroduce exactly the class of bug it was built to avoid. A new function
keeps the two authorization models (self-delete vs. admin-delete-on-behalf)
textually separate: `admin-delete-account` authenticates the caller via
their JWT (same pattern as `delete-account`), then checks `is_admin` for
that caller's id via `execute_sql`-equivalent logic before calling
`auth.admin.deleteUser(targetUserId)` with a body-supplied target.

**Self-lockout guards.** `admin_update_user_role` and
`admin_set_user_suspended` both reject the caller acting on their own id
(`raise exception 'cannot modify your own role/suspension'`) — cheap
protection against an admin accidentally demoting or suspending themselves
with no one left to undo it. `admin-delete-account` does the same for
deleting your own account (use the existing self-service `delete-account`
for that instead).

## Bootstrap

Granting the *first* admin has no UI path — every signup defaults to
`role = 'user'`, and only an existing admin can promote someone. This is a
one-time manual step: after this feature ships, run directly against the
live project via `execute_sql`:

```sql
update public.users set role = 'admin' where id = '<your own auth user id>';
```

Documented here so it's not forgotten as a plan task, not something the app
itself provides a button for.

## Data Model

New migration (next available number after `0006`):

```sql
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
```

`is_admin` is explicitly restricted to `authenticated` too (not left on its
default PUBLIC grant) — an anonymous caller has no legitimate reason to
probe whether an arbitrary uid is an admin, and `admin-delete-account`'s
own call to it always carries a real caller JWT (it 401s before ever
reaching that call otherwise), so `authenticated`-only costs nothing.

Execute is granted to `authenticated` broadly (matching
`get_sightings_for_moderation`'s precedent in AlienHunter01) because each
function's own `is_admin` check is the real gate — a non-admin caller gets
a raised exception, not data. `campground_attributes` needs no equivalent
grant dance: its RLS policy alone is sufficient since it's a plain table
(no `auth.users` join needed), unlike the two RPCs above.

## Edge Function: `admin-delete-account`

New `supabase/functions/admin-delete-account/index.ts`, structurally similar
to the existing `delete-account` (JWT-authenticate the caller via an
anon-key client, use a service-role client for the actual deletion) but
takes a `target_user_id` from the request body and additionally checks the
*caller* is an admin before proceeding:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response("Missing required environment variables", { status: 500, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const { data: isAdmin, error: adminCheckError } = await callerClient.rpc("is_admin", { uid: user.id });
  if (adminCheckError || !isAdmin) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  const { target_user_id } = await req.json();
  if (!target_user_id || typeof target_user_id !== "string") {
    return new Response("target_user_id is required", { status: 400, headers: corsHeaders });
  }
  if (target_user_id === user.id) {
    return new Response("Use the self-service delete-account function to delete your own account", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.auth.admin.deleteUser(target_user_id);
  if (error) {
    console.error("admin-delete-account failed:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  return new Response(null, { status: 204, headers: corsHeaders });
});
```

`callerClient.rpc("is_admin", ...)` reuses the same SQL function the other
RPCs check with, rather than duplicating the admin-check query — `is_admin`
is a plain `stable` SQL function (not `security definer`), callable by any
authenticated client, and its own result reveals nothing sensitive (just a
boolean about the caller).

## Service Layer

**New `src/app/core/models/admin-user.model.ts`:**
```ts
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'moderator' | 'admin';
  suspended: boolean;
  createdAt: string;
}
```

**New `src/app/core/services/admin-users.service.ts`:**
```ts
@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  readonly users = signal<AdminUser[]>([]);

  async loadUsers(): Promise<void>; // calls get_users_for_admin RPC
  async updateRole(userId: string, role: 'user' | 'moderator' | 'admin'): Promise<void>; // admin_update_user_role RPC
  async setSuspended(userId: string, suspended: boolean): Promise<void>; // admin_set_user_suspended RPC
  async deleteUser(userId: string): Promise<void>; // functions.invoke('admin-delete-account', { body: { target_user_id: userId } })
}
```
Each mutating method updates the local `users` signal in place on success
(same pattern as `FavoritesService`/`TripsService`), rather than reloading
the whole list, so the table doesn't flicker/reset scroll position after
one action.

**New `src/app/core/models/campground-attribute.model.ts`:**
```ts
export interface CampgroundAttribute {
  id: string;
  campgroundId: string;
  type: string;
  name: string;
  value: string | null;
  createdAt: string;
}
```

**New `src/app/core/services/campground-attributes.service.ts`:**
```ts
@Injectable({ providedIn: 'root' })
export class CampgroundAttributesService {
  readonly attributes = signal<CampgroundAttribute[]>([]);

  async loadForCampground(campgroundId: string): Promise<void>; // select ... where campground_id = ...
  async addAttribute(campgroundId: string, type: string, name: string, value: string | null): Promise<void>;
  async updateAttribute(attributeId: string, type: string, name: string, value: string | null): Promise<void>;
  async deleteAttribute(attributeId: string): Promise<void>;
}
```
Plain RLS-protected table access (no RPC needed — the `is_admin` RLS policy
on `campground_attributes` is sufficient, and there's no `auth.users` join
required the way `get_users_for_admin` needs one).

## Routing & Guard

New `src/app/core/guards/admin.guard.ts`:
```ts
export const adminGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const userService = inject(UserService);
  const router = inject(Router);

  if (!supabase.isAuthenticated) {
    return router.parseUrl('/login');
  }
  if (!userService.profile()) {
    await userService.loadProfile();
  }
  return userService.profile()?.role === 'admin' ? true : router.parseUrl('/');
};
```
Async (not the synchronous style `authGuard` uses) specifically because it
can't assume `App`'s bootstrap effect has already populated
`UserService.profile()` by the time someone deep-links straight to
`/admin` — it loads the profile itself if missing, the same defensive
approach the final review of the account-model plan flagged as a latent
gap in `authGuard` (noted there as pre-existing and out of scope; this new
guard just doesn't repeat that gap for itself).

New route `/admin` (lazy `loadComponent`, `canActivate: [adminGuard]`). Nav
link in `app.html`, shown only when `userService.profile()?.role ===
'admin'` — sits alongside "Account"/"Sign out" in the authenticated branch.

## Admin Page UI

New `src/app/features/admin/admin.component.ts` (+ external template),
using PrimeNG's `Tabs`/`TabList`/`Tab`/`TabPanels`/`TabPanel` (`primeng/tabs`
— this project's installed PrimeNG 22 uses this new API, not the legacy
`p-tabView`/`p-tabPanel`) with two tabs:

**Users tab.** A `p-table` (same component/pattern as
`CampgroundTableComponent`) listing `AdminUsersService.users()`: email,
display name, role, suspended, created date. Per row: a role `p-select`
(user/moderator/admin) that calls `updateRole` on change; a suspend/
unsuspend toggle button; a "Delete" action. Delete uses the same inline
two-step confirm pattern as account self-deletion (no `window.confirm()`)
— irreversible, admin-triggered deletion of someone else's account is at
least as high-stakes as the self-service case that established that
convention.

**Campground Attributes tab.** A campground picker — a `p-autocomplete`
(`AutoCompleteModule` from `primeng/autocomplete`; selector confirmed
lowercase against this project's installed PrimeNG 22) rather than a plain
`p-select` listing every campground, since `campgrounds` could be a few
thousand rows — to choose a campground by name.
`CampgroundsService` has no name-search method today (only
`getNearest`/`getByIds`) — this adds one: `searchByName(query: string):
Promise<Campground[]>`, a plain `.from('campgrounds').select(...).ilike('name',
\`%${query}%\`).limit(20)` query (no new RPC needed — `campgrounds` is
already publicly readable via its existing "anyone can read campgrounds"
RLS policy, and this is a simple filter, not the distance calculation
`nearest_campgrounds` exists for). Once a campground is selected, a
`p-table` of
`CampgroundAttributesService.attributes()` for that campground (type, name,
value), with inline add/edit/delete — new-row form at the top (type/name/
value text inputs + "Add"), each existing row editable in place or via an
edit icon, each row deletable (a plain PrimeNG-styled action, not the heavy
two-step confirm — attribute rows are low-stakes, freely re-addable data,
unlike a user account).

## Suspension Enforcement

`src/app/features/auth/login.component.ts`'s `onSubmit()`, after a
successful `signInWithPassword`: query `public.users.suspended` for the
signed-in id; if `true`, `signOut()` immediately and set the error message
to "This account has been suspended." instead of navigating to `/`.

## Error Handling

Follows the app's established pattern: service methods propagate errors
(`if (error) throw error`), components catch and surface via `p-message`.
The three self-lockout guards (own role, own suspension, own deletion) all
raise a Postgres/Edge-Function error with a specific message — the admin
page surfaces that message (not a generic one) so an admin who tries to
demote themselves understands why, rather than seeing an opaque failure
(the same "surface `error.message`" lesson from the account-model plan's
final review applies here from the start, not as a follow-up fix).

## Testing

Unit tests, mirroring this project's established patterns (TestBed +
Vitest-native `vi.fn()`/`.mockResolvedValue()`):

- Migration: applied and verified via `execute_sql` — table + RLS present,
  all three functions exist with correct `security definer`/execute grants,
  `is_admin` returns correct results for an admin/non-admin test row.
- `admin-delete-account`: no unit test file, same justification as
  `delete-account` (this project's Edge Functions verify via live
  invocation, not a Deno test harness) — verify live: a non-admin caller
  gets `403`, an admin caller successfully deletes a disposable target
  account, and a caller passing their own id gets the `400` self-delete
  rejection.
- `AdminUsersService`, `CampgroundAttributesService`: one test per method
  against a mocked Supabase client, matching `TripsService.spec.ts`'s
  style — including the local-signal-update-without-reload behavior.
- `adminGuard`: signed-out → redirect to `/login`; signed-in non-admin →
  redirect to `/`; signed-in admin → allowed; signed-in with no profile
  loaded yet → loads it, then decides correctly (exercises the async path
  directly, since this is exactly the race it exists to close).
- `AdminComponent`: role-change/suspend/delete interactions against mocked
  `AdminUsersService`; attribute add/edit/delete against mocked
  `CampgroundAttributesService`; campground picker selection driving
  `loadForCampground`.
- `LoginComponent`: new case — a successful sign-in for a suspended user
  results in an immediate `signOut()` call and the suspended-specific error
  message, not navigation.

Per this project's standing rule, no task is considered verified until
driven in a real browser: bootstrap a real admin (manual SQL per Bootstrap
above), sign in, reach `/admin`, change another test user's role, suspend
and confirm that user can no longer sign in, unsuspend and confirm they
can again, delete a disposable test user's account end-to-end, and add/
edit/delete a campground attribute — with console errors checked at each
step, and a non-admin/signed-out attempt to reach `/admin` confirmed
redirected.

## Open Questions / Future Phases

- Publicly displaying campground attributes — deferred above; revisit once
  there's real attribute data to decide a display treatment for.
- An "attribute definitions" table constraining allowed `type`/`name`
  values — deferred above as premature normalization.
- Forcibly terminating an already-active session on suspension — deferred
  above; would need either Supabase's native ban mechanism (a bigger
  change to the suspend mechanism itself) or a realtime subscription/
  periodic re-check on the client.
- Moderator-role permissions — still entirely unused; a future phase would
  need to decide what, if anything, a moderator can do that a plain user
  can't.
- An audit log of admin actions — deferred above.
