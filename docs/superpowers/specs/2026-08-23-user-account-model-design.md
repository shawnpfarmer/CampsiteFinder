# User Account Model — Design

## Context

CampsiteFinder has had a `public.profiles` table since Task 1
(0001_init.sql): `id` (→ `auth.users`), `display_name`, bootstrapped on
signup by a `handle_new_user()` trigger, with RLS (anyone can read;
owner can insert/update). Nothing in the frontend reads or writes it
beyond that trigger — no service, no settings page.

A sibling project, AlienHunter01, has a materially richer version of
the same pattern: its `profiles` table also carries notification
preferences, a `theme` preference, and a `role` column
(`user`/`moderator`/`admin`), backing a full account-settings screen
(display name, password change, notification prefs, theme, delete
account). This spec ports the *account-management* parts of that
model into CampsiteFinder — renamed from `profiles` to `users` — while
dropping the parts that are specific to AlienHunter01's proximity-alert
feature (home location, notification radius, push/email toggles),
which have no analog in a campsite finder.

AlienHunter01's `delete-account` Edge Function is referenced from its
`authStore.js` but does not exist in that repo's source — like its
early migrations, it was deployed directly to Supabase and never
committed. It's designed fresh here, following this project's existing
`nps-sync` Edge Function as a structural reference.

## Goals

- Rename `public.profiles` → `public.users`, carrying forward its
  existing rows, RLS policies, and bootstrap trigger.
- Add `theme` and `role` columns to `users`, matching AlienHunter01's
  column definitions.
- A signed-in user can view and edit their account at a new `/account`
  page: change display name, change password, delete their account.
- A signed-in user can toggle light/dark theme, persisted to
  `users.theme` and applied via a `data-theme` attribute on
  `<html>` — the same mechanism AlienHunter01's `useTheme` hook uses.

## Out of Scope (this phase)

- Notification preferences (home location, radius, push/email toggles)
  — AlienHunter01-specific, no analog here.
- Any moderation/admin feature that *consumes* `role`. The column is
  added now as groundwork (matches AlienHunter01's schema shape), but
  no RLS policy, RPC, or UI branches on it yet. Every account is
  created with `role = 'user'` and nothing in this phase changes that.
- App-wide dark-mode styling. The `theme` toggle in this phase flips a
  `data-theme` attribute and persists the choice, but no PrimeNG
  dark-mode selector config or SCSS dark-mode rules are added — so
  toggling it will not visibly reskin the app yet. Wiring actual dark
  CSS throughout is a larger, separate effort (PrimeNG's Aura preset
  dark-mode selector, plus auditing every component's own styles) and
  is deferred to a later phase.
- Email change. Not present in AlienHunter01's `ProfileForm` either;
  not added here.
- Admin-triggered deletion of another user's account — this phase is
  self-service delete-own-account only.

## Data Model

New migration, `0004_rename_profiles_to_users.sql`:

```sql
alter table public.profiles rename to users;

alter table public.users
  add column theme text check (theme in ('light', 'dark')),
  add column role text not null default 'user' check (role in ('user', 'moderator', 'admin'));
```

No other table needs a change. `favorites.user_id` and
`trips.user_id` already reference `auth.users(id)` directly (not
`profiles`), so the rename has no downstream FK impact. Existing RLS
policy names (`"anyone can read profiles"`, etc.) and the
`handle_new_user()` trigger continue to work unchanged after a table
rename — Postgres renames the table in place, policies and triggers
follow it. Policy names themselves are left as-is (renaming a policy
is a cosmetic-only change with no behavioral effect, not worth a
second migration statement).

## Delete-Account Edge Function

New `supabase/functions/delete-account/index.ts`, following
`nps-sync`'s structure (`Deno.serve`, env-var-sourced Supabase client).
Differs from `nps-sync` in one important way: `nps-sync` runs as a
trusted scheduled job with no caller identity to check, but
`delete-account` is called by an end user and must delete *only their
own* account — so it needs to authenticate the caller first:

```ts
Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response("Missing required environment variables", { status: 500 });
  }

  // Authenticate the caller using their own JWT (forwarded automatically
  // by supabase-js's functions.invoke) against the anon-key client --
  // this is what proves *who* is asking, before any deletion happens.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Only the service-role client can delete an auth user.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(null, { status: 204 });
});
```

Deleting the `auth.users` row cascades to `public.users` via its
existing `on delete cascade` FK, and from there to `favorites`/`trips`
via their own `on delete cascade` FKs — no explicit cleanup step
needed in the function itself.

## Service Layer

New `src/app/core/models/user.model.ts`:

```ts
export interface UserProfile {
  id: string;
  displayName: string;
  theme: 'light' | 'dark' | null;
  role: 'user' | 'moderator' | 'admin';
}
```

New `src/app/core/services/user.service.ts` (singular — mirrors
`SupabaseService`; this is "the current user's own record," not a
collection service like `TripsService`):

```ts
@Injectable({ providedIn: 'root' })
export class UserService {
  readonly profile = signal<UserProfile | null>(null);

  async loadProfile(): Promise<void>;
  async updateDisplayName(displayName: string): Promise<void>; // also syncs auth user_metadata, same reason AlienHunter01's does: the nav bar reads display_name from the session, not from a users fetch
  async updatePassword(password: string): Promise<void>; // supabase.auth.updateUser({ password })
  async updateTheme(theme: 'light' | 'dark'): Promise<void>; // persists + sets document.documentElement.dataset['theme']
  async deleteAccount(): Promise<void>; // supabase.functions.invoke('delete-account'), then signOut()
}
```

`loadProfile` follows the same signed-out-safe pattern as
`FavoritesService.loadFavoriteIds`: if there's no session, it sets
`profile` to `null` rather than querying.

## Account Page

New `src/app/features/account/` (mirrors the `favorites`/`trips`
feature-folder pattern), route `/account`, guarded by `authGuard`,
linked from the top nav (`app.html`) next to "Sign out" — visible only
when authenticated, same `@if (supabase.isAuthenticated)` guard already
used there.

Three sections on one page, matching `ProfileForm.jsx`'s layout and
save-independently-per-section behavior (each section has its own
loading/error/success state, saved via its own button):

1. **Display name** — text input + Save, calls
   `updateDisplayName`.
2. **Password** — new password + confirm, calls `updatePassword` after
   a client-side match check.
3. **Theme** — a toggle (PrimeNG `ToggleSwitch` or similar), calls
   `updateTheme`.

Below those, a danger-zone delete section: a "Delete Account" button
that reveals a confirm/cancel pair (`window.confirm()`-free explicit
inline confirmation, matching `ProfileForm.jsx`'s two-step pattern
rather than this project's existing `window.confirm()` shortcut used
for trips — account deletion is irreversible and higher-stakes than a
trip delete, so it gets the more deliberate inline confirm UI
AlienHunter01 already uses). On confirm: `deleteAccount()`, then
navigate to `/`.

## Error Handling

Follows the app's existing pattern: service methods propagate Supabase
errors (`if (error) throw error`); the account page catches per-section
and surfaces a message via `p-message`, same as
Login/Signup/Favorites. A failed `deleteAccount()` leaves the user on
the page with an error banner (mirrors `ProfileForm.jsx`'s
`isConfirmingDelete`/`deleteError` handling) rather than signing them
out on failure.

## Testing

Unit tests, mirroring this project's established patterns (TestBed +
Vitest-native `vi.fn()`/`.mockResolvedValue()`):

- Migration: applied and verified via `execute_sql` (table renamed,
  new columns present with correct constraints, existing RLS policies
  and trigger still functional), same as every prior schema task.
- `delete-account` function: a Deno test (mirrors
  `transform.test.ts`'s style) covering the unauthenticated-caller
  401 path and a mocked successful-delete path.
- `UserService`: one test per method against a mocked Supabase client
  (load, update display name, update password, update theme, delete +
  sign out), matching `CampgroundsService.spec.ts`'s mocking style.
- Account page component: per-section save/error states, delete
  confirm/cancel flow, mirroring `FavoritesComponent`'s existing test
  style for its own confirm flows.

Per this project's standing rule (established after Task 10 surfaced
seven real bugs no unit test caught), no task in the resulting
implementation plan is considered verified until driven in a real
browser: edit display name, change password (and sign back in with the
new one), toggle theme and confirm it persists across reload, and
delete a throwaway test account end-to-end — with console errors
checked.

## Open Questions / Future Phases

- App-wide dark-mode CSS (PrimeNG dark-mode selector + SCSS audit) —
  explicitly deferred above; the `theme` column and toggle exist but
  don't yet reskin anything.
- Any moderation/admin UI or RLS that consumes `role` — explicitly
  deferred above; the column is groundwork only.
- Notification preferences — explicitly out of scope; no analog to
  AlienHunter01's proximity-alert use case exists in this app today.
