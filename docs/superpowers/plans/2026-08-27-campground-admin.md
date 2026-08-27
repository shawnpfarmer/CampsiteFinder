# Campground Admin — Edit/Add Functionality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current read-only `/admin` page (a bare list of display name/role) into the full two-tab admin page from the existing design spec: a Users tab with role-edit/suspend/delete, and a new Campground Attributes tab with add/edit/delete.

**Architecture:** One migration adds the `suspended` column, the `campground_attributes` table, and four `SECURITY DEFINER`/helper SQL functions (`is_admin`, `get_users_for_admin`, `admin_update_user_role`, `admin_set_user_suspended`). A new `admin-delete-account` Edge Function handles admin-triggered deletion of another user's `auth.users` row (mirroring the existing self-service `delete-account` function but with a caller-is-admin check and a body-supplied target). Two new signal-backed services (`AdminUsersService`, `CampgroundAttributesService`) replace the old bare `AdminService`, following the same local-signal-update-on-write pattern as `TripsService`/`FavoritesService`. `CampgroundsService` gains a `searchByName` method for the campground picker. `LoginComponent` gains a suspension check after sign-in. `AdminComponent` is rebuilt around PrimeNG's `p-tabs` with the two tabs. The `/admin` route and `adminGuard` already exist exactly as designed and need no changes.

**Tech Stack:** Same as the rest of this app — Angular 22 standalone components + signals, PrimeNG 22 (Aura theme), `@supabase/supabase-js`, Deno (Edge Functions), Vitest for Angular tests.

**Spec:** `docs/superpowers/specs/2026-08-24-campground-admin-design.md`

## Global Constraints

- Angular: standalone components using `inject()`, no SSR. All routes are lazy (`loadComponent`) — the `/admin` route already is.
- PrimeNG: Aura theme preset. Every PrimeNG tag used in this plan has been verified against this exact install's `node_modules/primeng/types/*.d.ts` and `node_modules/primeng/fesm2022/*.mjs`: `p-tabs`/`p-tablist`/`p-tab`/`p-tabpanels`/`p-tabpanel` (module `TabsModule` from `primeng/tabs`), `p-select` (module `SelectModule` from `primeng/select`, inputs `options`/`optionLabel`/`optionValue`), `p-autocomplete` (module `AutoCompleteModule` from `primeng/autocomplete`, input `suggestions`/`optionLabel`/`forceSelection`, output `completeMethod` firing `{ query: string }`, output `onSelect` firing `{ value: any }`). Do not second-guess these against general PrimeNG knowledge; if a template still throws `NG8001`/`NG8002`, stop and report rather than adding `CUSTOM_ELEMENTS_SCHEMA`.
- **This scaffold's test runner is Vitest, not Karma/Jasmine.** Every task's test-verification step uses `npx ng test --watch=false` and Vitest-native `vi.fn()`/`.mockResolvedValue()`/`.mockRejectedValue()`.
- User-account deletion uses the inline two-step confirm UI (button reveals Cancel/"Yes, delete", no `window.confirm()`) — this applies to admin-deleting another user's account too, per the spec (at least as high-stakes as self-deletion). Campground attribute rows use a plain delete button, no confirm step — low-stakes, freely re-addable data, per the spec.
- **Deviation from the spec's literal `CampgroundsService.searchByName(): Promise<Campground[]>` signature:** `campgrounds.location` is a PostGIS `geography` column — the existing `getNearest`/`getByIds` only ever read it through RPCs (`nearest_campgrounds`/`get_campgrounds_by_ids`) that unwrap it with `st_x`/`st_y`. A plain PostgREST `.select().ilike()` can't do that unwrapping, and the campground picker only ever needs an id and a name to display and to pass into `loadForCampground`. `searchByName` therefore returns a lighter `{ id: string; name: string }[]` instead of full `Campground[]` — no new RPC, no unused lat/lng/fees/etc. fields threaded through the admin UI for no reason.
- **No task is considered verified until driven in a real browser**, per this project's standing rule.
- Supabase project ref for all MCP tool calls: `jpiicvvnipsckkhgjinn`.
- Per this project's README, never use throwaway addresses (`test@test.com`) for manual signup testing — use a real inbox you control, e.g. a `+alias` on your own domain (`shawnpfarmer+admintest1@gmail.com`).
- The `/admin` route (`src/app/app.routes.ts`), `adminGuard` (`src/app/core/guards/admin.guard.ts`), and the nav link in `src/app/app.html` already exist exactly as the spec describes — no task in this plan touches them.

---

## Task 1: Database Schema — `suspended` column, `campground_attributes` table, admin RPCs

**Files:**
- Create: `supabase/migrations/0008_campground_admin.sql`

**Interfaces:**
- Produces: `public.users.suspended boolean`; `public.campground_attributes` table; SQL functions `public.is_admin(uid uuid)`, `public.get_users_for_admin()`, `public.admin_update_user_role(target_user_id uuid, new_role text)`, `public.admin_set_user_suspended(target_user_id uuid, is_suspended boolean)`. Consumed by Task 2 (Edge Function's `is_admin` check), Task 3 (`AdminUsersService`), Task 4 (`CampgroundAttributesService`), Task 6 (`LoginComponent`'s suspension check).

- [ ] **Step 1: Confirm the next migration number is still free**

Run: `ls supabase/migrations/`
Expected: highest existing file is `0007_set_shawnpfarmer_admin.sql` (if later work has landed since this plan was written, name this file the next number up instead of `0008`, and use that number throughout this task).

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0008_campground_admin.sql`:

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

- [ ] **Step 3: Apply the migration**

Using `mcp__claude_ai_Supabase__apply_migration`, apply the SQL above to project `jpiicvvnipsckkhgjinn` as migration `0008_campground_admin` (adjust the number if Step 1 found a later one already taken).

- [ ] **Step 4: Verify the schema**

Using `mcp__claude_ai_Supabase__execute_sql` on project `jpiicvvnipsckkhgjinn`:

```sql
select column_name from information_schema.columns where table_name = 'users' and column_name = 'suspended';
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'campground_attributes';
select policyname from pg_policies where tablename = 'campground_attributes';
select routine_name, security_type from information_schema.routines where routine_schema = 'public' and routine_name in ('is_admin', 'get_users_for_admin', 'admin_update_user_role', 'admin_set_user_suspended');
```

Expected: `suspended` column present; `campground_attributes` table present; policy `admins manage campground attributes` present; all four routines present, with `get_users_for_admin`, `admin_update_user_role`, and `admin_set_user_suspended` showing `security_type = 'DEFINER'` and `is_admin` showing `'INVOKER'`.

Then, since migration `0007` already promoted `shawnpfarmer@gmail.com` to `role = 'admin'`, confirm `is_admin` resolves correctly for a real row:

```sql
select public.is_admin(id) from public.users where id = (select id from auth.users where email = 'shawnpfarmer@gmail.com');
```

Expected: `true`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_campground_admin.sql
git commit -m "Add suspended column, campground_attributes table, and admin RPCs"
```

---

## Task 2: `admin-delete-account` Edge Function

**Files:**
- Create: `supabase/functions/admin-delete-account/index.ts`

**Interfaces:**
- Consumes: `public.is_admin(uuid)` (Task 1).
- Produces: a deployed `admin-delete-account` Edge Function invoked by `AdminUsersService.deleteUser()` (Task 3) as `supabase.functions.invoke('admin-delete-account', { body: { target_user_id } })`.

**Note:** No unit test file — matches this project's existing `delete-account`/`nps-sync` precedent (no established harness for mocking `Deno.serve`/`createClient` at the HTTP-handler level). Verification is a real deploy + real invocation (Steps 3–5).

- [ ] **Step 1: Write the function**

Create `supabase/functions/admin-delete-account/index.ts`:

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

- [ ] **Step 2: Deploy the function**

Using `mcp__claude_ai_Supabase__deploy_edge_function`, deploy `admin-delete-account` to project `jpiicvvnipsckkhgjinn`. No manual secret setup needed — `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected.

- [ ] **Step 3: Sign up two disposable test accounts**

Using the project's anon key (from `src/environments/environment.ts`) and real inbox aliases:

```bash
curl -X POST "https://jpiicvvnipsckkhgjinn.supabase.co/auth/v1/signup" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"email":"shawnpfarmer+admintest1@gmail.com","password":"Temp-Password-123!","data":{"display_name":"Admin Test Caller"}}'

curl -X POST "https://jpiicvvnipsckkhgjinn.supabase.co/auth/v1/signup" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"email":"shawnpfarmer+admintest2@gmail.com","password":"Temp-Password-123!","data":{"display_name":"Admin Test Target"}}'
```

Note each response's `access_token` and each user's `id`.

- [ ] **Step 4: Verify a non-admin caller is rejected**

```bash
curl -i -X POST "https://jpiicvvnipsckkhgjinn.supabase.co/functions/v1/admin-delete-account" \
  -H "Authorization: Bearer <admintest1 access_token>" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"target_user_id": "<admintest2 user id>"}'
```

Expected: `403 Forbidden` (neither test account is an admin).

- [ ] **Step 5: Promote the caller to admin, then verify a real deletion**

Using `mcp__claude_ai_Supabase__execute_sql`:

```sql
update public.users set role = 'admin' where id = '<admintest1 user id>';
```

Then repeat the Step 4 curl call. Expected: `204 No Content`. Then:

```sql
select count(*) from public.users where id = '<admintest2 user id>';
```

Expected: `0`. Finally, confirm the self-delete rejection:

```bash
curl -i -X POST "https://jpiicvvnipsckkhgjinn.supabase.co/functions/v1/admin-delete-account" \
  -H "Authorization: Bearer <admintest1 access_token>" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"target_user_id": "<admintest1 user id>"}'
```

Expected: `400` with the "Use the self-service delete-account function" message. Clean up afterwards — delete the now-admin `admintest1` account via the self-service `delete-account` function (or `auth.admin.deleteUser` via `execute_sql`-adjacent tooling) so no disposable admin account is left behind.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/admin-delete-account
git commit -m "Add admin-delete-account Edge Function"
```

---

## Task 3: `AdminUsersService`

**Files:**
- Create: `src/app/core/models/admin-user.model.ts`
- Create: `src/app/core/services/admin-users.service.ts`
- Test: `src/app/core/services/admin-users.service.spec.ts`
- Delete: `src/app/core/services/admin.service.ts`
- Delete: `src/app/core/services/admin.service.spec.ts`
- Modify: `src/app/core/models/user.model.ts` (remove `AdminUserSummary` — superseded by `AdminUser`; confirmed unused outside the admin feature)

**Interfaces:**
- Consumes: `get_users_for_admin`/`admin_update_user_role`/`admin_set_user_suspended` RPCs (Task 1), `admin-delete-account` Edge Function (Task 2).
- Produces: `interface AdminUser { id, email, displayName, role, suspended, createdAt }`; `AdminUsersService` with `users: Signal<AdminUser[]>`, `loadUsers(): Promise<void>`, `updateRole(userId: string, role: 'user' | 'moderator' | 'admin'): Promise<void>`, `setSuspended(userId: string, suspended: boolean): Promise<void>`, `deleteUser(userId: string): Promise<void>` — consumed by `AdminComponent` (Task 7).

- [ ] **Step 1: Add the model**

Create `src/app/core/models/admin-user.model.ts`:

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

- [ ] **Step 2: Remove `AdminUserSummary` from `user.model.ts`**

In `src/app/core/models/user.model.ts`, delete the `AdminUserSummary` interface (the last four lines of the file), leaving only `UserProfile`.

- [ ] **Step 3: Write the failing tests**

Create `src/app/core/services/admin-users.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AdminUsersService } from './admin-users.service';
import { SupabaseService } from './supabase.service';

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let rpcSpy: ReturnType<typeof vi.fn>;
  let invokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpcSpy = vi.fn();
    invokeSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: { client: { rpc: rpcSpy, functions: { invoke: invokeSpy } } } },
      ],
    });
    service = TestBed.inject(AdminUsersService);
  });

  it('loads users via get_users_for_admin', async () => {
    rpcSpy.mockResolvedValue({
      data: [
        {
          id: 'user-1',
          email: 'alex@example.com',
          display_name: 'Alex',
          role: 'user',
          suspended: false,
          created_at: '2026-08-01T00:00:00Z',
        },
      ],
      error: null,
    });

    await service.loadUsers();

    expect(rpcSpy).toHaveBeenCalledWith('get_users_for_admin');
    expect(service.users()).toEqual([
      {
        id: 'user-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'user',
        suspended: false,
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
  });

  it('throws when loadUsers errors', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(service.loadUsers()).rejects.toThrow('boom');
  });

  it('updates a role and reflects it locally without reloading', async () => {
    service.users.set([
      {
        id: 'user-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'user',
        suspended: false,
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
    rpcSpy.mockResolvedValue({ data: null, error: null });

    await service.updateRole('user-1', 'moderator');

    expect(rpcSpy).toHaveBeenCalledWith('admin_update_user_role', { target_user_id: 'user-1', new_role: 'moderator' });
    expect(service.users()[0].role).toBe('moderator');
  });

  it('throws when updateRole errors', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: new Error('cannot modify your own role') });

    await expect(service.updateRole('user-1', 'admin')).rejects.toThrow('cannot modify your own role');
  });

  it('sets suspended and reflects it locally', async () => {
    service.users.set([
      {
        id: 'user-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'user',
        suspended: false,
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
    rpcSpy.mockResolvedValue({ data: null, error: null });

    await service.setSuspended('user-1', true);

    expect(rpcSpy).toHaveBeenCalledWith('admin_set_user_suspended', { target_user_id: 'user-1', is_suspended: true });
    expect(service.users()[0].suspended).toBe(true);
  });

  it('throws when setSuspended errors', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(service.setSuspended('user-1', true)).rejects.toThrow('boom');
  });

  it('deletes a user via the admin-delete-account function and removes it locally', async () => {
    service.users.set([
      {
        id: 'user-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'user',
        suspended: false,
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
    invokeSpy.mockResolvedValue({ error: null });

    await service.deleteUser('user-1');

    expect(invokeSpy).toHaveBeenCalledWith('admin-delete-account', { body: { target_user_id: 'user-1' } });
    expect(service.users()).toEqual([]);
  });

  it('throws when deleteUser errors', async () => {
    invokeSpy.mockResolvedValue({ error: new Error('boom') });

    await expect(service.deleteUser('user-1')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `./admin-users.service` does not exist yet.

- [ ] **Step 5: Implement `AdminUsersService`**

Create `src/app/core/services/admin-users.service.ts`:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AdminUser } from '../models/admin-user.model';

@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  private readonly supabase = inject(SupabaseService);
  readonly users = signal<AdminUser[]>([]);

  async loadUsers(): Promise<void> {
    const { data, error } = await this.supabase.client.rpc('get_users_for_admin');
    if (error) throw error;
    this.users.set((data ?? []).map(mapRow));
  }

  async updateRole(userId: string, role: 'user' | 'moderator' | 'admin'): Promise<void> {
    const { error } = await this.supabase.client.rpc('admin_update_user_role', {
      target_user_id: userId,
      new_role: role,
    });
    if (error) throw error;
    this.users.update((users) => users.map((u) => (u.id === userId ? { ...u, role } : u)));
  }

  async setSuspended(userId: string, suspended: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('admin_set_user_suspended', {
      target_user_id: userId,
      is_suspended: suspended,
    });
    if (error) throw error;
    this.users.update((users) => users.map((u) => (u.id === userId ? { ...u, suspended } : u)));
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('admin-delete-account', {
      body: { target_user_id: userId },
    });
    if (error) throw error;
    this.users.update((users) => users.filter((u) => u.id !== userId));
  }
}

function mapRow(row: any): AdminUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    suspended: row.suspended,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 6: Delete the superseded `AdminService`**

```bash
rm src/app/core/services/admin.service.ts src/app/core/services/admin.service.spec.ts
```

(`AdminComponent` still imports it until Task 7 rewrites it — expect `AdminComponent`/its spec to fail to compile until then; that's fine, Task 7 fixes it immediately after.)

- [ ] **Step 7: Run the tests to verify the new service passes**

Run: `npx ng test --watch=false`
Expected: `admin-users.service.spec.ts` PASSES. `admin.component.spec.ts` and `admin.component.ts` will fail/error (missing `AdminService`) — expected until Task 7.

- [ ] **Step 8: Commit**

```bash
git add src/app/core/models/admin-user.model.ts src/app/core/models/user.model.ts \
  src/app/core/services/admin-users.service.ts src/app/core/services/admin-users.service.spec.ts
git rm src/app/core/services/admin.service.ts src/app/core/services/admin.service.spec.ts
git commit -m "Add AdminUsersService, remove superseded AdminService"
```

---

## Task 4: `CampgroundAttributesService`

**Files:**
- Create: `src/app/core/models/campground-attribute.model.ts`
- Create: `src/app/core/services/campground-attributes.service.ts`
- Test: `src/app/core/services/campground-attributes.service.spec.ts`

**Interfaces:**
- Consumes: `public.campground_attributes` table (Task 1).
- Produces: `interface CampgroundAttribute { id, campgroundId, type, name, value, createdAt }`; `CampgroundAttributesService` with `attributes: Signal<CampgroundAttribute[]>`, `loadForCampground(campgroundId: string): Promise<void>`, `addAttribute(campgroundId: string, type: string, name: string, value: string | null): Promise<void>`, `updateAttribute(attributeId: string, type: string, name: string, value: string | null): Promise<void>`, `deleteAttribute(attributeId: string): Promise<void>` — consumed by `AdminComponent` (Task 8).

- [ ] **Step 1: Add the model**

Create `src/app/core/models/campground-attribute.model.ts`:

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

- [ ] **Step 2: Write the failing tests**

Create `src/app/core/services/campground-attributes.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CampgroundAttributesService } from './campground-attributes.service';
import { SupabaseService } from './supabase.service';

function createQueryBuilderMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  ['select', 'insert', 'update', 'delete', 'eq', 'order'].forEach((method) => {
    builder[method] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(result);
  builder.then = (resolve: any) => resolve(result);
  return builder;
}

describe('CampgroundAttributesService', () => {
  let service: CampgroundAttributesService;
  let fromSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { client: { from: fromSpy } } }],
    });
    service = TestBed.inject(CampgroundAttributesService);
  });

  it('loads attributes for a campground', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: [
          {
            id: 'attr-1',
            campground_id: 'cg-1',
            type: 'accessibility',
            name: 'Wheelchair accessible',
            value: 'yes',
            created_at: '2026-08-01T00:00:00Z',
          },
        ],
        error: null,
      }),
    );

    await service.loadForCampground('cg-1');

    expect(fromSpy).toHaveBeenCalledWith('campground_attributes');
    expect(service.attributes()).toEqual([
      {
        id: 'attr-1',
        campgroundId: 'cg-1',
        type: 'accessibility',
        name: 'Wheelchair accessible',
        value: 'yes',
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
  });

  it('throws when loadForCampground errors', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: new Error('boom') }));

    await expect(service.loadForCampground('cg-1')).rejects.toThrow('boom');
  });

  it('adds an attribute and appends it locally', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: {
          id: 'attr-2',
          campground_id: 'cg-1',
          type: 'fee',
          name: 'Reservation fee',
          value: '10',
          created_at: '2026-08-02T00:00:00Z',
        },
        error: null,
      }),
    );

    await service.addAttribute('cg-1', 'fee', 'Reservation fee', '10');

    expect(service.attributes()).toEqual([
      { id: 'attr-2', campgroundId: 'cg-1', type: 'fee', name: 'Reservation fee', value: '10', createdAt: '2026-08-02T00:00:00Z' },
    ]);
  });

  it('throws when addAttribute errors', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: new Error('boom') }));

    await expect(service.addAttribute('cg-1', 'fee', 'Reservation fee', '10')).rejects.toThrow('boom');
  });

  it('updates an attribute in place', async () => {
    service.attributes.set([
      { id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'Old', value: '5', createdAt: '2026-08-01T00:00:00Z' },
    ]);
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: [{ id: 'attr-1', campground_id: 'cg-1', type: 'fee', name: 'New', value: '15', created_at: '2026-08-01T00:00:00Z' }],
        error: null,
      }),
    );

    await service.updateAttribute('attr-1', 'fee', 'New', '15');

    expect(service.attributes()[0]).toEqual({
      id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'New', value: '15', createdAt: '2026-08-01T00:00:00Z',
    });
  });

  it('throws and leaves attributes untouched when an update matches no rows', async () => {
    service.attributes.set([
      { id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'Old', value: '5', createdAt: '2026-08-01T00:00:00Z' },
    ]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

    await expect(service.updateAttribute('attr-1', 'fee', 'New', '15')).rejects.toThrow('No matching attribute to update');
    expect(service.attributes()[0].name).toBe('Old');
  });

  it('deletes an attribute', async () => {
    service.attributes.set([
      { id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'Old', value: '5', createdAt: '2026-08-01T00:00:00Z' },
    ]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [{ id: 'attr-1' }], error: null }));

    await service.deleteAttribute('attr-1');

    expect(service.attributes()).toEqual([]);
  });

  it('throws and leaves attributes untouched when a delete matches no rows', async () => {
    service.attributes.set([
      { id: 'attr-1', campgroundId: 'cg-1', type: 'fee', name: 'Old', value: '5', createdAt: '2026-08-01T00:00:00Z' },
    ]);
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

    await expect(service.deleteAttribute('attr-1')).rejects.toThrow('No matching attribute to delete');
    expect(service.attributes().length).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `./campground-attributes.service` does not exist yet.

- [ ] **Step 4: Implement `CampgroundAttributesService`**

Create `src/app/core/services/campground-attributes.service.ts`:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CampgroundAttribute } from '../models/campground-attribute.model';

@Injectable({ providedIn: 'root' })
export class CampgroundAttributesService {
  private readonly supabase = inject(SupabaseService);
  readonly attributes = signal<CampgroundAttribute[]>([]);

  async loadForCampground(campgroundId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('campground_attributes')
      .select('id, campground_id, type, name, value, created_at')
      .eq('campground_id', campgroundId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    this.attributes.set((data ?? []).map(mapRow));
  }

  async addAttribute(campgroundId: string, type: string, name: string, value: string | null): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('campground_attributes')
      .insert({ campground_id: campgroundId, type, name, value })
      .select('id, campground_id, type, name, value, created_at')
      .single();
    if (error) throw error;
    this.attributes.update((attrs) => [...attrs, mapRow(data)]);
  }

  async updateAttribute(attributeId: string, type: string, name: string, value: string | null): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('campground_attributes')
      .update({ type, name, value })
      .eq('id', attributeId)
      .select('id, campground_id, type, name, value, created_at');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No matching attribute to update');
    const updated = mapRow(data[0]);
    this.attributes.update((attrs) => attrs.map((a) => (a.id === attributeId ? updated : a)));
  }

  async deleteAttribute(attributeId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('campground_attributes')
      .delete()
      .eq('id', attributeId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No matching attribute to delete');
    this.attributes.update((attrs) => attrs.filter((a) => a.id !== attributeId));
  }
}

function mapRow(row: any): CampgroundAttribute {
  return {
    id: row.id,
    campgroundId: row.campground_id,
    type: row.type,
    name: row.name,
    value: row.value,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/models/campground-attribute.model.ts \
  src/app/core/services/campground-attributes.service.ts \
  src/app/core/services/campground-attributes.service.spec.ts
git commit -m "Add CampgroundAttributesService"
```

---

## Task 5: `CampgroundsService.searchByName`

**Files:**
- Modify: `src/app/core/services/campgrounds.service.ts`
- Modify: `src/app/core/services/campgrounds.service.spec.ts`

**Interfaces:**
- Produces: `CampgroundsService.searchByName(query: string): Promise<{ id: string; name: string }[]>` — consumed by `AdminComponent`'s campground picker (Task 8). See Global Constraints for why this returns a lighter shape than `Campground[]`.

- [ ] **Step 1: Write the failing test**

In `src/app/core/services/campgrounds.service.spec.ts`, change the `beforeEach` to also provide a `from` spy (alongside the existing `rpc` spy), and add these tests at the end of the `describe` block:

```ts
  it('searches campgrounds by name', async () => {
    const builder: any = {};
    ['select', 'ilike', 'limit'].forEach((method) => {
      builder[method] = vi.fn().mockReturnValue(builder);
    });
    builder.then = (resolve: any) => resolve({ data: [{ id: 'cg-1', name: 'Blackwoods Campground' }], error: null });
    fromSpy.mockReturnValue(builder);

    const results = await service.searchByName('black');

    expect(fromSpy).toHaveBeenCalledWith('campgrounds');
    expect(builder.ilike).toHaveBeenCalledWith('name', '%black%');
    expect(builder.limit).toHaveBeenCalledWith(20);
    expect(results).toEqual([{ id: 'cg-1', name: 'Blackwoods Campground' }]);
  });

  it('throws when searchByName errors', async () => {
    const builder: any = {};
    ['select', 'ilike', 'limit'].forEach((method) => {
      builder[method] = vi.fn().mockReturnValue(builder);
    });
    builder.then = (resolve: any) => resolve({ data: null, error: new Error('boom') });
    fromSpy.mockReturnValue(builder);

    await expect(service.searchByName('black')).rejects.toThrow('boom');
  });
```

And update the top of the file's `beforeEach`/provider wiring to:

```ts
  let service: CampgroundsService;
  let rpcSpy: ReturnType<typeof vi.fn>;
  let fromSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpcSpy = vi.fn();
    fromSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { client: { rpc: rpcSpy, from: fromSpy } } }],
    });
    service = TestBed.inject(CampgroundsService);
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `service.searchByName is not a function`.

- [ ] **Step 3: Implement `searchByName`**

In `src/app/core/services/campgrounds.service.ts`, add this method to `CampgroundsService` (after `getByIds`):

```ts
  async searchByName(query: string): Promise<{ id: string; name: string }[]> {
    const { data, error } = await this.supabase.client
      .from('campgrounds')
      .select('id, name')
      .ilike('name', `%${query}%`)
      .limit(20);
    if (error) throw error;
    return data ?? [];
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/campgrounds.service.ts src/app/core/services/campgrounds.service.spec.ts
git commit -m "Add CampgroundsService.searchByName for the admin campground picker"
```

---

## Task 6: Suspension Enforcement at Sign-In

**Files:**
- Modify: `src/app/features/auth/login.component.ts`
- Modify: `src/app/features/auth/login.component.spec.ts`

**Interfaces:**
- Consumes: `public.users.suspended` (Task 1).

- [ ] **Step 1: Write the failing test**

In `src/app/features/auth/login.component.spec.ts`, replace the file with:

```ts
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Router, ActivatedRoute } from '@angular/router';
import { LoginComponent } from './login.component';
import { SupabaseService } from '../../core/services/supabase.service';

function createUsersQueryBuilderMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  ['select', 'eq'].forEach((method) => {
    builder[method] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(result);
  return builder;
}

describe('LoginComponent', () => {
  let component: LoginComponent;
  let signInSpy: ReturnType<typeof vi.fn>;
  let signOutSpy: ReturnType<typeof vi.fn>;
  let fromSpy: ReturnType<typeof vi.fn>;
  let navigateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signInSpy = vi.fn();
    signOutSpy = vi.fn().mockResolvedValue({ error: null });
    fromSpy = vi.fn();
    navigateSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        {
          provide: SupabaseService,
          useValue: { client: { auth: { signInWithPassword: signInSpy, signOut: signOutSpy }, from: fromSpy } },
        },
        { provide: Router, useValue: { navigateByUrl: navigateSpy } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    });

    component = TestBed.createComponent(LoginComponent).componentInstance;
  });

  it('navigates home on successful sign-in when not suspended', async () => {
    signInSpy.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    fromSpy.mockReturnValue(createUsersQueryBuilderMock({ data: { suspended: false }, error: null }));
    component.email = 'a@b.com';
    component.password = 'secret';

    await component.onSubmit();

    expect(navigateSpy).toHaveBeenCalledWith('/');
    expect(component.error()).toBeNull();
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('sets an error message on failed sign-in', async () => {
    signInSpy.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid credentials' } });

    await component.onSubmit();

    expect(component.error()).toBe('Invalid credentials');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('signs out and shows a suspended message instead of navigating in', async () => {
    signInSpy.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    fromSpy.mockReturnValue(createUsersQueryBuilderMock({ data: { suspended: true }, error: null }));

    await component.onSubmit();

    expect(signOutSpy).toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component.error()).toBe('This account has been suspended.');
  });
});
```

- [ ] **Step 2: Run the tests to verify the suspended-flow test fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `component.onSubmit` doesn't yet check `suspended`, and doesn't yet destructure `data` from `signInWithPassword`.

- [ ] **Step 3: Implement the suspension check**

Replace `onSubmit` in `src/app/features/auth/login.component.ts`:

```ts
  async onSubmit(): Promise<void> {
    this.submitting.set(true);
    this.error.set(null);
    const { data, error } = await this.supabase.client.auth.signInWithPassword({
      email: this.email,
      password: this.password,
    });
    if (error) {
      this.submitting.set(false);
      this.error.set(error.message);
      return;
    }

    const { data: userRow, error: suspendedError } = await this.supabase.client
      .from('users')
      .select('suspended')
      .eq('id', data.user!.id)
      .single();
    this.submitting.set(false);
    if (suspendedError) {
      this.error.set(suspendedError.message);
      return;
    }
    if (userRow.suspended) {
      await this.supabase.client.auth.signOut();
      this.error.set('This account has been suspended.');
      return;
    }
    this.router.navigateByUrl('/');
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/auth/login.component.ts src/app/features/auth/login.component.spec.ts
git commit -m "Block sign-in for suspended accounts"
```

---

## Task 7: Admin Page — Users Tab

**Files:**
- Modify: `src/app/features/admin/admin.component.ts` (full rewrite)
- Modify: `src/app/features/admin/admin.component.html` (full rewrite; Campground Attributes tab content added in Task 8)
- Modify: `src/app/features/admin/admin.component.spec.ts` (full rewrite)

**Interfaces:**
- Consumes: `AdminUsersService` (Task 3).
- Produces: `AdminComponent` with a `p-tabs` shell (Users tab fully wired here; an empty Campground Attributes tab placeholder wired in Task 8).

- [ ] **Step 1: Write the failing tests**

Replace `src/app/features/admin/admin.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AdminComponent } from './admin.component';
import { AdminUsersService } from '../../core/services/admin-users.service';
import { CampgroundAttributesService } from '../../core/services/campground-attributes.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { AdminUser } from '../../core/models/admin-user.model';
import { signal } from '@angular/core';

describe('AdminComponent', () => {
  function setup(overrides: { users?: AdminUser[] } = {}) {
    const loadUsersSpy = vi.fn().mockResolvedValue(undefined);
    const updateRoleSpy = vi.fn().mockResolvedValue(undefined);
    const setSuspendedSpy = vi.fn().mockResolvedValue(undefined);
    const deleteUserSpy = vi.fn().mockResolvedValue(undefined);
    const usersSignal = signal<AdminUser[]>(overrides.users ?? []);

    TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        {
          provide: AdminUsersService,
          useValue: {
            users: usersSignal,
            loadUsers: loadUsersSpy,
            updateRole: updateRoleSpy,
            setSuspended: setSuspendedSpy,
            deleteUser: deleteUserSpy,
          },
        },
        {
          provide: CampgroundAttributesService,
          useValue: { attributes: signal([]), loadForCampground: vi.fn(), addAttribute: vi.fn(), updateAttribute: vi.fn(), deleteAttribute: vi.fn() },
        },
        { provide: CampgroundsService, useValue: { searchByName: vi.fn().mockResolvedValue([]) } },
      ],
    });

    const fixture = TestBed.createComponent(AdminComponent);
    return {
      component: fixture.componentInstance,
      loadUsersSpy,
      updateRoleSpy,
      setSuspendedSpy,
      deleteUserSpy,
    };
  }

  const user: AdminUser = {
    id: 'user-1', email: 'alex@example.com', displayName: 'Alex', role: 'user', suspended: false, createdAt: '2026-08-01T00:00:00Z',
  };

  it('loads users on init', async () => {
    const { component, loadUsersSpy } = setup();

    await component.ngOnInit();

    expect(loadUsersSpy).toHaveBeenCalled();
  });

  it('shows an error if loading users fails', async () => {
    const { component, loadUsersSpy } = setup();
    loadUsersSpy.mockRejectedValue(new Error('boom'));

    await component.ngOnInit();

    expect(component.usersError()).toBe('boom');
  });

  it('changes a role', async () => {
    const { component, updateRoleSpy } = setup({ users: [user] });

    await component.onRoleChange('user-1', 'moderator');

    expect(updateRoleSpy).toHaveBeenCalledWith('user-1', 'moderator');
    expect(component.usersError()).toBeNull();
  });

  it('shows an error if a role change fails', async () => {
    const { component, updateRoleSpy } = setup({ users: [user] });
    updateRoleSpy.mockRejectedValue(new Error('cannot modify your own role'));

    await component.onRoleChange('user-1', 'admin');

    expect(component.usersError()).toBe('cannot modify your own role');
  });

  it('toggles suspension', async () => {
    const { component, setSuspendedSpy } = setup({ users: [user] });

    await component.onToggleSuspended(user);

    expect(setSuspendedSpy).toHaveBeenCalledWith('user-1', true);
  });

  it('requires confirmation before deleting a user', async () => {
    const { component, deleteUserSpy } = setup({ users: [user] });

    component.onDeleteUser('user-1');
    expect(component.confirmingDeleteUserId()).toBe('user-1');
    expect(deleteUserSpy).not.toHaveBeenCalled();

    await component.onConfirmDeleteUser('user-1');
    expect(deleteUserSpy).toHaveBeenCalledWith('user-1');
    expect(component.confirmingDeleteUserId()).toBeNull();
  });

  it('shows an error and stays confirmable when delete fails', async () => {
    const { component, deleteUserSpy } = setup({ users: [user] });
    deleteUserSpy.mockRejectedValue(new Error('boom'));
    component.onDeleteUser('user-1');

    await component.onConfirmDeleteUser('user-1');

    expect(component.usersError()).toBe('boom');
    expect(component.confirmingDeleteUserId()).toBe('user-1');
  });

  it('cancels a pending delete confirmation', () => {
    const { component } = setup({ users: [user] });
    component.onDeleteUser('user-1');

    component.onCancelDeleteUser();

    expect(component.confirmingDeleteUserId()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — the current `AdminComponent` still depends on the deleted `AdminService` and has none of these methods.

- [ ] **Step 3: Implement the component (Users tab; Campground Attributes tab body added in Task 8)**

Replace `src/app/features/admin/admin.component.ts`:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AdminUsersService } from '../../core/services/admin-users.service';
import { AdminUser } from '../../core/models/admin-user.model';

const ROLE_OPTIONS: { label: string; value: 'user' | 'moderator' | 'admin' }[] = [
  { label: 'User', value: 'user' },
  { label: 'Moderator', value: 'moderator' },
  { label: 'Admin', value: 'admin' },
];

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [DatePipe, FormsModule, TableModule, TabsModule, SelectModule, ButtonModule, MessageModule],
  templateUrl: './admin.component.html',
})
export class AdminComponent implements OnInit {
  private readonly adminUsersService = inject(AdminUsersService);

  readonly roleOptions = ROLE_OPTIONS;
  readonly users = this.adminUsersService.users;
  readonly usersError = signal<string | null>(null);
  readonly confirmingDeleteUserId = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      await this.adminUsersService.loadUsers();
    } catch (err) {
      this.usersError.set(err instanceof Error ? err.message : 'Could not load users.');
    }
  }

  async onRoleChange(userId: string, role: 'user' | 'moderator' | 'admin'): Promise<void> {
    this.usersError.set(null);
    try {
      await this.adminUsersService.updateRole(userId, role);
    } catch (err) {
      this.usersError.set(err instanceof Error ? err.message : 'Could not update role.');
    }
  }

  async onToggleSuspended(user: AdminUser): Promise<void> {
    this.usersError.set(null);
    try {
      await this.adminUsersService.setSuspended(user.id, !user.suspended);
    } catch (err) {
      this.usersError.set(err instanceof Error ? err.message : 'Could not update suspension.');
    }
  }

  onDeleteUser(userId: string): void {
    this.confirmingDeleteUserId.set(userId);
  }

  onCancelDeleteUser(): void {
    this.confirmingDeleteUserId.set(null);
  }

  async onConfirmDeleteUser(userId: string): Promise<void> {
    this.usersError.set(null);
    try {
      await this.adminUsersService.deleteUser(userId);
      this.confirmingDeleteUserId.set(null);
    } catch (err) {
      this.usersError.set(err instanceof Error ? err.message : 'Could not delete user.');
    }
  }
}
```

Replace `src/app/features/admin/admin.component.html`:

```html
<h1>Admin</h1>

<p-tabs value="0">
  <p-tablist>
    <p-tab value="0">Users</p-tab>
    <p-tab value="1">Campground Attributes</p-tab>
  </p-tablist>
  <p-tabpanels>
    <p-tabpanel value="0">
      @if (usersError()) {
        <p-message severity="error">{{ usersError() }}</p-message>
      }
      <p-table [value]="users()">
        <ng-template #header>
          <tr>
            <th>Email</th>
            <th>Display Name</th>
            <th>Role</th>
            <th>Suspended</th>
            <th>Created</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template #body let-user>
          <tr>
            <td>{{ user.email }}</td>
            <td>{{ user.displayName }}</td>
            <td>
              <p-select
                [ngModel]="user.role"
                [options]="roleOptions"
                optionLabel="label"
                optionValue="value"
                (onChange)="onRoleChange(user.id, $event.value)"
              />
            </td>
            <td>
              <button pButton [text]="true" (click)="onToggleSuspended(user)">
                {{ user.suspended ? 'Unsuspend' : 'Suspend' }}
              </button>
            </td>
            <td>{{ user.createdAt | date }}</td>
            <td>
              @if (confirmingDeleteUserId() === user.id) {
                <button pButton [text]="true" (click)="onCancelDeleteUser()">Cancel</button>
                <button pButton severity="danger" (click)="onConfirmDeleteUser(user.id)">Yes, delete</button>
              } @else {
                <button pButton severity="danger" [text]="true" (click)="onDeleteUser(user.id)">Delete</button>
              }
            </td>
          </tr>
        </ng-template>
      </p-table>
    </p-tabpanel>
    <p-tabpanel value="1">
      <!-- Campground Attributes tab content added in Task 8 -->
    </p-tabpanel>
  </p-tabpanels>
</p-tabs>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/admin/admin.component.ts src/app/features/admin/admin.component.html \
  src/app/features/admin/admin.component.spec.ts
git commit -m "Rebuild admin page: tabbed shell with full Users tab (role edit, suspend, delete)"
```

---

## Task 8: Admin Page — Campground Attributes Tab

**Files:**
- Modify: `src/app/features/admin/admin.component.ts`
- Modify: `src/app/features/admin/admin.component.html`
- Modify: `src/app/features/admin/admin.component.spec.ts`

**Interfaces:**
- Consumes: `CampgroundAttributesService` (Task 4), `CampgroundsService.searchByName` (Task 5).

- [ ] **Step 1: Write the failing tests**

In `src/app/features/admin/admin.component.spec.ts`, add these tests inside the existing `describe('AdminComponent', ...)` block (after the last Users-tab test), and update `setup()`'s `CampgroundAttributesService`/`CampgroundsService` providers to return spies you can assert on — replace the two `provide` entries with:

```ts
        {
          provide: CampgroundAttributesService,
          useValue: {
            attributes: signal(overrides.attributes ?? []),
            loadForCampground: loadForCampgroundSpy,
            addAttribute: addAttributeSpy,
            updateAttribute: updateAttributeSpy,
            deleteAttribute: deleteAttributeSpy,
          },
        },
        { provide: CampgroundsService, useValue: { searchByName: searchByNameSpy } },
```

and add the corresponding spy declarations and `overrides` parameter at the top of `setup`:

```ts
  function setup(overrides: { users?: AdminUser[]; attributes?: CampgroundAttribute[] } = {}) {
    const loadUsersSpy = vi.fn().mockResolvedValue(undefined);
    const updateRoleSpy = vi.fn().mockResolvedValue(undefined);
    const setSuspendedSpy = vi.fn().mockResolvedValue(undefined);
    const deleteUserSpy = vi.fn().mockResolvedValue(undefined);
    const usersSignal = signal<AdminUser[]>(overrides.users ?? []);
    const loadForCampgroundSpy = vi.fn().mockResolvedValue(undefined);
    const addAttributeSpy = vi.fn().mockResolvedValue(undefined);
    const updateAttributeSpy = vi.fn().mockResolvedValue(undefined);
    const deleteAttributeSpy = vi.fn().mockResolvedValue(undefined);
    const searchByNameSpy = vi.fn().mockResolvedValue([{ id: 'cg-1', name: 'Blackwoods Campground' }]);
```

and change the `return` at the end of `setup` to also expose the new spies:

```ts
    return {
      component: fixture.componentInstance,
      loadUsersSpy,
      updateRoleSpy,
      setSuspendedSpy,
      deleteUserSpy,
      loadForCampgroundSpy,
      addAttributeSpy,
      updateAttributeSpy,
      deleteAttributeSpy,
      searchByNameSpy,
    };
```

Add the import at the top of the file: `import { CampgroundAttribute } from '../../core/models/campground-attribute.model';`

Then add these tests:

```ts
  const attribute: CampgroundAttribute = {
    id: 'attr-1', campgroundId: 'cg-1', type: 'accessibility', name: 'Wheelchair accessible', value: 'yes', createdAt: '2026-08-01T00:00:00Z',
  };

  it('searches campgrounds by name', async () => {
    const { component, searchByNameSpy } = setup();

    await component.onSearchCampgrounds({ originalEvent: new Event('input'), query: 'black' } as any);

    expect(searchByNameSpy).toHaveBeenCalledWith('black');
    expect(component.campgroundSuggestions()).toEqual([{ id: 'cg-1', name: 'Blackwoods Campground' }]);
  });

  it('loads attributes when a campground is selected', async () => {
    const { component, loadForCampgroundSpy } = setup();

    await component.onSelectCampground({ originalEvent: new Event('click'), value: { id: 'cg-1', name: 'Blackwoods Campground' } } as any);

    expect(component.selectedCampground).toEqual({ id: 'cg-1', name: 'Blackwoods Campground' });
    expect(loadForCampgroundSpy).toHaveBeenCalledWith('cg-1');
  });

  it('adds an attribute for the selected campground and clears the form', async () => {
    const { component, addAttributeSpy } = setup();
    component.selectedCampground = { id: 'cg-1', name: 'Blackwoods Campground' };
    component.newAttributeType = 'fee';
    component.newAttributeName = 'Reservation fee';
    component.newAttributeValue = '10';

    await component.onAddAttribute();

    expect(addAttributeSpy).toHaveBeenCalledWith('cg-1', 'fee', 'Reservation fee', '10');
    expect(component.newAttributeType).toBe('');
    expect(component.newAttributeName).toBe('');
    expect(component.newAttributeValue).toBe('');
  });

  it('does not add an attribute when no campground is selected', async () => {
    const { component, addAttributeSpy } = setup();
    component.newAttributeType = 'fee';
    component.newAttributeName = 'Reservation fee';

    await component.onAddAttribute();

    expect(addAttributeSpy).not.toHaveBeenCalled();
  });

  it('starts and saves an attribute edit', async () => {
    const { component, updateAttributeSpy } = setup({ attributes: [attribute] });

    component.onStartEditAttribute(attribute);
    expect(component.editingAttributeId()).toBe('attr-1');
    expect(component.editAttributeType).toBe('accessibility');

    component.editAttributeValue = 'no';
    await component.onSaveEditAttribute('attr-1');

    expect(updateAttributeSpy).toHaveBeenCalledWith('attr-1', 'accessibility', 'Wheelchair accessible', 'no');
    expect(component.editingAttributeId()).toBeNull();
  });

  it('cancels an attribute edit', () => {
    const { component } = setup({ attributes: [attribute] });
    component.onStartEditAttribute(attribute);

    component.onCancelEditAttribute();

    expect(component.editingAttributeId()).toBeNull();
  });

  it('deletes an attribute', async () => {
    const { component, deleteAttributeSpy } = setup({ attributes: [attribute] });

    await component.onDeleteAttribute('attr-1');

    expect(deleteAttributeSpy).toHaveBeenCalledWith('attr-1');
  });

  it('shows an error if adding an attribute fails', async () => {
    const { component, addAttributeSpy } = setup();
    addAttributeSpy.mockRejectedValue(new Error('boom'));
    component.selectedCampground = { id: 'cg-1', name: 'Blackwoods Campground' };
    component.newAttributeType = 'fee';
    component.newAttributeName = 'Reservation fee';

    await component.onAddAttribute();

    expect(component.attributesError()).toBe('boom');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `AdminComponent` has no `onSearchCampgrounds`/`onSelectCampground`/`onAddAttribute`/etc. yet.

- [ ] **Step 3: Implement the Campground Attributes tab**

In `src/app/features/admin/admin.component.ts`, add the new imports:

```ts
import { InputTextModule } from 'primeng/inputtext';
import { AutoCompleteModule, AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { CampgroundAttributesService } from '../../core/services/campground-attributes.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { CampgroundAttribute } from '../../core/models/campground-attribute.model';
```

Add `InputTextModule, AutoCompleteModule` to the `@Component` `imports` array (alongside the existing ones).

Add a `CampgroundOption` type and extend the class body:

```ts
interface CampgroundOption {
  id: string;
  name: string;
}
```

Inside the `AdminComponent` class, add:

```ts
  private readonly campgroundAttributesService = inject(CampgroundAttributesService);
  private readonly campgroundsService = inject(CampgroundsService);

  readonly campgroundSuggestions = signal<CampgroundOption[]>([]);
  selectedCampground: CampgroundOption | null = null;
  readonly attributes = this.campgroundAttributesService.attributes;
  readonly attributesError = signal<string | null>(null);

  newAttributeType = '';
  newAttributeName = '';
  newAttributeValue = '';

  readonly editingAttributeId = signal<string | null>(null);
  editAttributeType = '';
  editAttributeName = '';
  editAttributeValue = '';

  async onSearchCampgrounds(event: AutoCompleteCompleteEvent): Promise<void> {
    const results = await this.campgroundsService.searchByName(event.query);
    this.campgroundSuggestions.set(results);
  }

  async onSelectCampground(event: AutoCompleteSelectEvent): Promise<void> {
    this.attributesError.set(null);
    const campground = event.value as CampgroundOption;
    this.selectedCampground = campground;
    try {
      await this.campgroundAttributesService.loadForCampground(campground.id);
    } catch (err) {
      this.attributesError.set(err instanceof Error ? err.message : 'Could not load attributes.');
    }
  }

  async onAddAttribute(): Promise<void> {
    if (!this.selectedCampground || this.newAttributeType.trim() === '' || this.newAttributeName.trim() === '') {
      return;
    }
    this.attributesError.set(null);
    try {
      await this.campgroundAttributesService.addAttribute(
        this.selectedCampground.id,
        this.newAttributeType.trim(),
        this.newAttributeName.trim(),
        this.newAttributeValue.trim() === '' ? null : this.newAttributeValue.trim(),
      );
      this.newAttributeType = '';
      this.newAttributeName = '';
      this.newAttributeValue = '';
    } catch (err) {
      this.attributesError.set(err instanceof Error ? err.message : 'Could not add attribute.');
    }
  }

  onStartEditAttribute(attribute: CampgroundAttribute): void {
    this.editingAttributeId.set(attribute.id);
    this.editAttributeType = attribute.type;
    this.editAttributeName = attribute.name;
    this.editAttributeValue = attribute.value ?? '';
  }

  onCancelEditAttribute(): void {
    this.editingAttributeId.set(null);
  }

  async onSaveEditAttribute(attributeId: string): Promise<void> {
    this.attributesError.set(null);
    try {
      await this.campgroundAttributesService.updateAttribute(
        attributeId,
        this.editAttributeType.trim(),
        this.editAttributeName.trim(),
        this.editAttributeValue.trim() === '' ? null : this.editAttributeValue.trim(),
      );
      this.editingAttributeId.set(null);
    } catch (err) {
      this.attributesError.set(err instanceof Error ? err.message : 'Could not update attribute.');
    }
  }

  async onDeleteAttribute(attributeId: string): Promise<void> {
    this.attributesError.set(null);
    try {
      await this.campgroundAttributesService.deleteAttribute(attributeId);
    } catch (err) {
      this.attributesError.set(err instanceof Error ? err.message : 'Could not delete attribute.');
    }
  }
```

Replace the placeholder second `<p-tabpanel>` in `src/app/features/admin/admin.component.html` with:

```html
    <p-tabpanel value="1">
      @if (attributesError()) {
        <p-message severity="error">{{ attributesError() }}</p-message>
      }
      <p-autocomplete
        [(ngModel)]="selectedCampground"
        [suggestions]="campgroundSuggestions()"
        optionLabel="name"
        placeholder="Search campgrounds by name"
        [forceSelection]="true"
        (completeMethod)="onSearchCampgrounds($event)"
        (onSelect)="onSelectCampground($event)"
      />

      @if (selectedCampground) {
        <p-table [value]="attributes()">
          <ng-template #header>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Value</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template #body let-attribute>
            <tr>
              @if (editingAttributeId() === attribute.id) {
                <td><input pInputText type="text" [(ngModel)]="editAttributeType" /></td>
                <td><input pInputText type="text" [(ngModel)]="editAttributeName" /></td>
                <td><input pInputText type="text" [(ngModel)]="editAttributeValue" /></td>
                <td>
                  <button pButton [text]="true" (click)="onCancelEditAttribute()">Cancel</button>
                  <button pButton (click)="onSaveEditAttribute(attribute.id)">Save</button>
                </td>
              } @else {
                <td>{{ attribute.type }}</td>
                <td>{{ attribute.name }}</td>
                <td>{{ attribute.value }}</td>
                <td>
                  <button pButton [text]="true" (click)="onStartEditAttribute(attribute)">Edit</button>
                  <button pButton severity="danger" [text]="true" (click)="onDeleteAttribute(attribute.id)">Delete</button>
                </td>
              }
            </tr>
          </ng-template>
          <ng-template #footer>
            <tr>
              <td><input pInputText type="text" placeholder="Type" [(ngModel)]="newAttributeType" /></td>
              <td><input pInputText type="text" placeholder="Name" [(ngModel)]="newAttributeName" /></td>
              <td><input pInputText type="text" placeholder="Value" [(ngModel)]="newAttributeValue" /></td>
              <td><button pButton (click)="onAddAttribute()">Add</button></td>
            </tr>
          </ng-template>
        </p-table>
      }
    </p-tabpanel>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/admin/admin.component.ts src/app/features/admin/admin.component.html \
  src/app/features/admin/admin.component.spec.ts
git commit -m "Add Campground Attributes tab: picker plus add/edit/delete"
```

---

## Task 9: Full Verification in a Real Browser

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite and build**

```bash
npx ng test --watch=false
npx ng build
```

Expected: both PASS with no errors.

- [ ] **Step 2: Manual end-to-end pass**

Run `npx ng serve`. Note: `shawnpfarmer@gmail.com` is already the bootstrap admin (migration `0007`) — its self-lockout guards mean it can't change/suspend/delete *itself*, so use a second disposable account (e.g. `shawnpfarmer+admintest3@gmail.com`) as the target of the actions below.

1. Sign in as `shawnpfarmer@gmail.com`, navigate to `/admin`. Confirm both tabs render.
2. **Users tab:** confirm the disposable test account appears with email/display name/role/suspended/created columns populated.
3. Change that account's role via the `p-select` — confirm it updates without a page reload and without resetting scroll/table state.
4. Click "Suspend" on that account — confirm the button flips to "Unsuspend."
5. Sign out, attempt to sign in as the suspended account — confirm sign-in is rejected with "This account has been suspended." and you are not navigated in.
6. Sign back in as the admin, click "Unsuspend" on that account — sign out, sign in as that account again — confirm it now succeeds.
7. As the admin, attempt to change your own role or suspend yourself via direct RPC call (or just confirm the UI doesn't offer a way to select yourself if you filtered the list — otherwise confirm the self-lockout error surfaces if you try).
8. Click "Delete" on the disposable account — confirm the two-step Cancel/"Yes, delete" UI appears; click Cancel once to confirm it backs out; click Delete again and confirm — confirm the row disappears and the account can no longer sign in.
9. **Campground Attributes tab:** type a partial campground name into the picker — confirm suggestions appear; select one — confirm its (likely empty) attribute table loads.
10. Add an attribute (type/name/value) via the footer row — confirm it appears in the table immediately.
11. Click "Edit" on that row, change its value, click "Save" — confirm the row updates in place.
12. Click "Delete" on that row — confirm it disappears immediately (no confirmation step).
13. Switch to a different campground via the picker — confirm the attribute table reloads for the new campground (and doesn't show the previous campground's rows).
14. Sign out and confirm navigating directly to `/admin` redirects to `/login`; sign in as a non-admin user and confirm navigating to `/admin` redirects to `/`.
15. Check the browser console for errors at every step above.

- [ ] **Step 3: Report results**

Confirm all steps above pass with no console errors before considering this plan complete. If any step fails, treat it as a bug against the specific task that introduced it, not a new task.
