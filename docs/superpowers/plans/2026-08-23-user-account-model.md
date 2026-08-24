# User Account Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `public.profiles` to `public.users` (adding `theme` and `role` columns), and give a signed-in user a self-service `/account` page to edit their display name, change their password, toggle light/dark theme, and delete their account.

**Architecture:** A single migration renames the existing `profiles` table in place and adds two columns, preserving all existing RLS policies and the signup-bootstrap trigger. A new `delete-account` Edge Function (service-role, caller-authenticated) handles the one operation a client can never do for itself — deleting an `auth.users` row — and everything else (`public.users` cascades from it). A new singular `UserService` (mirrors `SupabaseService`, not a collection service like `TripsService`) wraps all of it behind signals. A new guarded `/account` route and page, linked from the top nav, is the only new UI surface.

**Tech Stack:** Same as the rest of this app — Angular 22 standalone components + signals, PrimeNG (Aura theme), `@supabase/supabase-js`, Deno (Edge Functions), Vitest for Angular tests.

**Spec:** `docs/superpowers/specs/2026-08-23-user-account-model-design.md`

## Global Constraints

- Angular: standalone components using `inject()`, no SSR.
- PrimeNG: Aura theme preset, PrimeIcons for iconography. Every PrimeNG tag/binding used in this plan (`p-toggleswitch`/`ToggleSwitchModule`, `severity` on `p-message` and `pButton`) has already been verified against `node_modules/primeng/types/*.d.ts` and `node_modules/primeng/fesm2022/*.mjs` in this exact install — do not second-guess these against general PrimeNG knowledge, but if a template still throws `NG8001`/`NG8002` despite that, stop and report it rather than adding `CUSTOM_ELEMENTS_SCHEMA`/`NO_ERRORS_SCHEMA`.
- **This scaffold's test runner is Vitest, not Karma/Jasmine.** Every task's test-verification step uses `npx ng test --watch=false` and Vitest-native `vi.fn()`/`.mockResolvedValue()`/`.mockRejectedValue()` — never `jasmine.createSpy`/`.and.returnValue`/`expectAsync`.
- **All routes are lazy (`loadComponent`), not eager.** An earlier task found eager route imports blow the production bundle budget.
- Delete-account confirmation is an **inline two-step UI** (a "Delete Account" button reveals Cancel/"Yes, delete" — no native `window.confirm()`), matching AlienHunter01's `ProfileForm.jsx` pattern. This deliberately differs from this project's trip-delete convention (`window.confirm()`) — account deletion is irreversible and higher-stakes, so it gets the more deliberate inline UI. Don't "fix" this to match trips.
- Out of scope for this feature (see spec for full reasoning): notification preferences (home location/radius/push/email), any RLS/RPC/UI that consumes the new `role` column, app-wide dark-mode CSS (the theme toggle persists a value and flips `data-theme` on `<html>` but does not yet reskin anything), email change, admin-triggered deletion of another user's account.
- **No task is considered verified until driven in a real browser** (established after an earlier task's unit tests passed while the UI was actually broken in seven different ways). `npx ng test`/`npx ng build` passing is necessary, not sufficient.
- Supabase project ref for all MCP tool calls: `jpiicvvnipsckkhgjinn`.
- Per this project's README, never use throwaway addresses (`test@test.com`) for manual signup testing — use a real inbox you control, e.g. a `+alias` on your own domain (`shawnpfarmer+accounttest1@gmail.com`).

---

## Task 1: Database Schema — Rename `profiles` to `users`

**Files:**
- Create: `supabase/migrations/0004_rename_profiles_to_users.sql`

**Interfaces:**
- Produces: `public.users` table (`id`, `display_name`, `theme`, `role`), replacing `public.profiles`. Consumed by Task 2 (Edge Function) and Task 3 (`UserService`).

- [ ] **Step 1: Confirm the next migration number is still free**

Run: `ls supabase/migrations/`
Expected: highest existing file is `0003_favorite_notes_and_trips.sql` (or later, if other work has landed since this plan was written — if so, name this file the next number up instead of `0004`, and use that number throughout this task).

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0004_rename_profiles_to_users.sql`:

```sql
alter table public.profiles rename to users;

alter table public.users
  add column theme text check (theme in ('light', 'dark')),
  add column role text not null default 'user' check (role in ('user', 'moderator', 'admin'));
```

- [ ] **Step 3: Apply the migration**

Using the `mcp__claude_ai_Supabase__apply_migration` tool, apply the SQL above to project `jpiicvvnipsckkhgjinn` as migration `0004_rename_profiles_to_users` (adjust the number if Step 1 found a later one already taken).

- [ ] **Step 4: Verify the schema**

Using `mcp__claude_ai_Supabase__execute_sql` on project `jpiicvvnipsckkhgjinn`:

```sql
select table_name from information_schema.tables where table_schema = 'public' and table_name in ('profiles', 'users');
select column_name, is_nullable, column_default from information_schema.columns where table_name = 'users' order by ordinal_position;
select policyname, tablename from pg_policies where tablename = 'users';
```

Expected: first query returns only `users` (not `profiles`); second returns `id, display_name, theme, role` with `role` having `not null`/default `'user'::text`; third returns the three pre-existing policies (`anyone can read profiles`, `users can insert own profile`, `users can update own profile`) now attached to `users` — their names are unchanged by the table rename, which is expected (renaming policies is cosmetic and out of scope, per the spec).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0004_rename_profiles_to_users.sql
git commit -m "Rename profiles to users, add theme and role columns"
```

---

## Task 2: Delete-Account Edge Function

**Files:**
- Create: `supabase/functions/delete-account/index.ts`

**Interfaces:**
- Consumes: `public.users` → `auth.users` cascade (Task 1).
- Produces: a deployed `delete-account` Edge Function invoked by `UserService.deleteAccount()` (Task 3) as `supabase.functions.invoke('delete-account')`.

**Note:** this function has no unit test file, matching this project's existing `nps-sync` Edge Function — that function's thin `Deno.serve` HTTP handler isn't unit tested either (only its pure `transform.ts` helper is); there's no established harness in this codebase for mocking `Deno.serve`/`createClient` at the HTTP-handler level, and inventing one for a five-line handler isn't worth it. Verification here is a real deploy + real invocation (Steps 3–4), same as `nps-sync`'s Task 3.

- [ ] **Step 1: Write the function**

Create `supabase/functions/delete-account/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response("Missing required environment variables", { status: 500 });
  }

  // Authenticate the caller using their own JWT (forwarded automatically by
  // supabase-js's functions.invoke) against the anon-key client -- this is
  // what proves *who* is asking, before any deletion happens. Only after
  // this succeeds do we reach for the service-role client, and only ever to
  // delete that same, now-known, caller.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("delete-account failed:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(null, { status: 204 });
});
```

- [ ] **Step 2: Deploy the function**

Using `mcp__claude_ai_Supabase__deploy_edge_function`, deploy `delete-account` to project `jpiicvvnipsckkhgjinn`. Unlike `nps-sync`'s `NPS_API_KEY`, no manual secret setup is needed here — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into every Edge Function by Supabase.

- [ ] **Step 3: Sign up a disposable test account and get its access token**

Using the project's anon key (from `src/environments/environment.ts`) and a real inbox alias (see Global Constraints — do not use `test@test.com`):

```bash
curl -X POST "https://jpiicvvnipsckkhgjinn.supabase.co/auth/v1/signup" \
  -H "apikey: <anon key from src/environments/environment.ts>" \
  -H "Content-Type: application/json" \
  -d '{"email":"shawnpfarmer+accounttest1@gmail.com","password":"Temp-Password-123!","data":{"display_name":"Delete Me"}}'
```

Note the `access_token` in the response (if email confirmation is on for this project, sign in instead with `/auth/v1/token?grant_type=password` after confirming — check the project's Auth settings if the signup response has no session).

- [ ] **Step 4: Invoke the function and verify the account is gone**

```bash
curl -i -X POST "https://jpiicvvnipsckkhgjinn.supabase.co/functions/v1/delete-account" \
  -H "Authorization: Bearer <access_token from Step 3>" \
  -H "apikey: <anon key>"
```

Expected: `204 No Content`. Then using `mcp__claude_ai_Supabase__execute_sql`:

```sql
select count(*) from public.users where display_name = 'Delete Me';
```

Expected: `0`. (The `auth.users` row is gone too — `public.users` cascades from it — but `auth.users` isn't directly queryable via `execute_sql`; the zero-row count on `public.users` confirms the cascade fired.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/delete-account
git commit -m "Add delete-account Edge Function"
```

---

## Task 3: UserService

**Files:**
- Create: `src/app/core/models/user.model.ts`
- Create: `src/app/core/services/user.service.ts`
- Test: `src/app/core/services/user.service.spec.ts`

**Interfaces:**
- Consumes: `public.users` table (Task 1), `delete-account` Edge Function (Task 2), `SupabaseService` (existing).
- Produces: `interface UserProfile { id, displayName, theme, role }`; `UserService` with `profile: Signal<UserProfile | null>`, `loadProfile(): Promise<void>`, `updateDisplayName(displayName: string): Promise<void>`, `updatePassword(password: string): Promise<void>`, `updateTheme(theme: 'light' | 'dark'): Promise<void>`, `deleteAccount(): Promise<void>` — all consumed by `AccountComponent` (Task 4).

- [ ] **Step 1: Add the model**

Create `src/app/core/models/user.model.ts`:

```ts
export interface UserProfile {
  id: string;
  displayName: string;
  theme: 'light' | 'dark' | null;
  role: 'user' | 'moderator' | 'admin';
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/app/core/services/user.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { UserService } from './user.service';
import { SupabaseService } from './supabase.service';

function createQueryBuilderMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  ['select', 'update', 'eq'].forEach((method) => {
    builder[method] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(result);
  builder.then = (resolve: any) => resolve(result);
  return builder;
}

describe('UserService', () => {
  let service: UserService;
  let fromSpy: ReturnType<typeof vi.fn>;
  let updateUserSpy: ReturnType<typeof vi.fn>;
  let signOutSpy: ReturnType<typeof vi.fn>;
  let invokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromSpy = vi.fn();
    updateUserSpy = vi.fn().mockResolvedValue({ error: null });
    signOutSpy = vi.fn().mockResolvedValue({ error: null });
    invokeSpy = vi.fn().mockResolvedValue({ error: null });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SupabaseService,
          useValue: {
            session: () => ({ user: { id: 'user-1' } }),
            client: {
              from: fromSpy,
              auth: { updateUser: updateUserSpy, signOut: signOutSpy },
              functions: { invoke: invokeSpy },
            },
          },
        },
      ],
    });
    service = TestBed.inject(UserService);
  });

  it('loads the profile for the signed-in user', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: { id: 'user-1', display_name: 'Alex', theme: 'dark', role: 'user' },
        error: null,
      }),
    );

    await service.loadProfile();

    expect(service.profile()).toEqual({ id: 'user-1', displayName: 'Alex', theme: 'dark', role: 'user' });
  });

  it('sets profile to null when signed out', async () => {
    TestBed.overrideProvider(SupabaseService, {
      useValue: { session: () => null, client: { from: fromSpy } },
    });
    service = TestBed.inject(UserService);

    await service.loadProfile();

    expect(service.profile()).toBeNull();
  });

  it('updates display name in the table and syncs auth metadata', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    await service.updateDisplayName('New Name');

    expect(fromSpy).toHaveBeenCalledWith('users');
    expect(updateUserSpy).toHaveBeenCalledWith({ data: { display_name: 'New Name' } });
  });

  it('updates password via supabase auth', async () => {
    await service.updatePassword('new-password-123');

    expect(updateUserSpy).toHaveBeenCalledWith({ password: 'new-password-123' });
  });

  it('updates theme in the table', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    await service.updateTheme('dark');

    expect(fromSpy).toHaveBeenCalledWith('users');
  });

  it('invokes the delete-account function and signs out', async () => {
    await service.deleteAccount();

    expect(invokeSpy).toHaveBeenCalledWith('delete-account');
    expect(signOutSpy).toHaveBeenCalled();
    expect(service.profile()).toBeNull();
  });

  it('throws and does not sign out when delete-account fails', async () => {
    invokeSpy.mockResolvedValue({ error: new Error('boom') });

    await expect(service.deleteAccount()).rejects.toThrow('boom');
    expect(signOutSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `./user.service` does not exist yet.

- [ ] **Step 4: Implement `UserService`**

Create `src/app/core/services/user.service.ts`:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserProfile } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly supabase = inject(SupabaseService);
  readonly profile = signal<UserProfile | null>(null);

  async loadProfile(): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) {
      this.profile.set(null);
      return;
    }
    const { data, error } = await this.supabase.client
      .from('users')
      .select('id, display_name, theme, role')
      .eq('id', userId)
      .single();
    if (error) throw error;
    this.profile.set({
      id: data.id,
      displayName: data.display_name,
      theme: data.theme,
      role: data.role,
    });
  }

  async updateDisplayName(displayName: string): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to update display name');

    const { error: updateError } = await this.supabase.client
      .from('users')
      .update({ display_name: displayName })
      .eq('id', userId);
    if (updateError) throw updateError;

    // Keeps the session's user_metadata in sync with the users row (mirrors
    // AlienHunter01's pattern). Nothing in this app reads display_name from
    // the session today, but this keeps the two from silently drifting.
    const { error: metadataError } = await this.supabase.client.auth.updateUser({
      data: { display_name: displayName },
    });
    if (metadataError) throw metadataError;

    this.profile.update((p) => (p ? { ...p, displayName } : p));
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.supabase.client.auth.updateUser({ password });
    if (error) throw error;
  }

  async updateTheme(theme: 'light' | 'dark'): Promise<void> {
    const userId = this.supabase.session()?.user.id;
    if (!userId) throw new Error('Must be signed in to update theme');

    const { error } = await this.supabase.client
      .from('users')
      .update({ theme })
      .eq('id', userId);
    if (error) throw error;

    document.documentElement.dataset['theme'] = theme;
    this.profile.update((p) => (p ? { ...p, theme } : p));
  }

  async deleteAccount(): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('delete-account');
    if (error) throw error;
    await this.supabase.client.auth.signOut();
    this.profile.set(null);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/models/user.model.ts src/app/core/services/user.service.ts src/app/core/services/user.service.spec.ts
git commit -m "Add UserService for account profile, password, theme, and deletion"
```

---

## Task 4: Account Page

**Files:**
- Create: `src/app/features/account/account.component.ts`
- Create: `src/app/features/account/account.component.html`
- Test: `src/app/features/account/account.component.spec.ts`

**Interfaces:**
- Consumes: `UserService` (Task 3).
- Produces: `AccountComponent` — routed in Task 5.

- [ ] **Step 1: Write the failing tests**

Create `src/app/features/account/account.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideRouter } from '@angular/router';
import { AccountComponent } from './account.component';
import { UserService } from '../../core/services/user.service';

describe('AccountComponent', () => {
  function setup(overrides: Partial<Record<keyof UserService, unknown>> = {}) {
    const userService = {
      profile: () => ({ id: 'user-1', displayName: 'Alex', theme: 'light', role: 'user' }),
      loadProfile: vi.fn().mockResolvedValue(undefined),
      updateDisplayName: vi.fn().mockResolvedValue(undefined),
      updatePassword: vi.fn().mockResolvedValue(undefined),
      updateTheme: vi.fn().mockResolvedValue(undefined),
      deleteAccount: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    TestBed.configureTestingModule({
      imports: [AccountComponent],
      providers: [provideRouter([]), { provide: UserService, useValue: userService }],
    });
    const fixture = TestBed.createComponent(AccountComponent);
    return { fixture, component: fixture.componentInstance, userService };
  }

  it('loads the profile and seeds the display name field on init', async () => {
    const { component } = setup();

    await component.ngOnInit();

    expect(component.displayName).toBe('Alex');
    expect(component.isDarkTheme()).toBe(false);
  });

  it('saves the display name', async () => {
    const { component, userService } = setup();
    await component.ngOnInit();
    component.displayName = 'New Name';

    await component.onSaveDisplayName();

    expect(userService.updateDisplayName).toHaveBeenCalledWith('New Name');
    expect(component.displayNameNotice()).toBe('Display name updated.');
  });

  it('shows an error when saving the display name fails', async () => {
    const { component } = setup({ updateDisplayName: vi.fn().mockRejectedValue(new Error('boom')) });
    await component.ngOnInit();

    await component.onSaveDisplayName();

    expect(component.displayNameError()).toBe('Could not update display name. Please try again.');
  });

  it('rejects a password save when the confirmation does not match', async () => {
    const { component, userService } = setup();
    component.newPassword = 'abc123';
    component.confirmPassword = 'different';

    await component.onSavePassword();

    expect(userService.updatePassword).not.toHaveBeenCalled();
    expect(component.passwordError()).toBe('Passwords do not match.');
  });

  it('saves the password when confirmation matches', async () => {
    const { component, userService } = setup();
    component.newPassword = 'abc123';
    component.confirmPassword = 'abc123';

    await component.onSavePassword();

    expect(userService.updatePassword).toHaveBeenCalledWith('abc123');
    expect(component.passwordNotice()).toBe('Password updated.');
  });

  it('toggles theme and reverts on failure', async () => {
    const { component } = setup({ updateTheme: vi.fn().mockRejectedValue(new Error('boom')) });
    await component.ngOnInit();

    await component.onThemeToggle(true);

    expect(component.isDarkTheme()).toBe(false);
    expect(component.themeError()).toBe('Could not update theme. Please try again.');
  });

  it('requires confirmation before deleting the account', async () => {
    const { component, userService } = setup();

    component.onDeleteAccount();
    expect(component.confirmingDelete()).toBe(true);
    expect(userService.deleteAccount).not.toHaveBeenCalled();

    await component.onConfirmDelete();
    expect(userService.deleteAccount).toHaveBeenCalled();
  });

  it('shows an error and stays confirmable when delete fails', async () => {
    const { component } = setup({ deleteAccount: vi.fn().mockRejectedValue(new Error('boom')) });
    component.onDeleteAccount();

    await component.onConfirmDelete();

    expect(component.deleteError()).toBe('Could not delete account. Please try again.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx ng test --watch=false`
Expected: FAIL — `./account.component` does not exist yet.

- [ ] **Step 3: Implement the component**

Create `src/app/features/account/account.component.ts`:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { UserService } from '../../core/services/user.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, MessageModule, ToggleSwitchModule],
  templateUrl: './account.component.html',
})
export class AccountComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  displayName = '';
  readonly displayNameNotice = signal<string | null>(null);
  readonly displayNameError = signal<string | null>(null);
  readonly savingDisplayName = signal(false);

  newPassword = '';
  confirmPassword = '';
  readonly passwordNotice = signal<string | null>(null);
  readonly passwordError = signal<string | null>(null);
  readonly savingPassword = signal(false);

  readonly isDarkTheme = signal(false);
  readonly themeError = signal<string | null>(null);

  readonly confirmingDelete = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly deletingAccount = signal(false);

  async ngOnInit(): Promise<void> {
    await this.userService.loadProfile();
    const profile = this.userService.profile();
    if (profile) {
      this.displayName = profile.displayName;
      this.isDarkTheme.set(profile.theme === 'dark');
    }
  }

  async onSaveDisplayName(): Promise<void> {
    this.displayNameNotice.set(null);
    this.displayNameError.set(null);
    this.savingDisplayName.set(true);
    try {
      await this.userService.updateDisplayName(this.displayName.trim());
      this.displayNameNotice.set('Display name updated.');
    } catch {
      this.displayNameError.set('Could not update display name. Please try again.');
    } finally {
      this.savingDisplayName.set(false);
    }
  }

  async onSavePassword(): Promise<void> {
    this.passwordNotice.set(null);
    this.passwordError.set(null);
    if (this.newPassword !== this.confirmPassword) {
      this.passwordError.set('Passwords do not match.');
      return;
    }
    this.savingPassword.set(true);
    try {
      await this.userService.updatePassword(this.newPassword);
      this.newPassword = '';
      this.confirmPassword = '';
      this.passwordNotice.set('Password updated.');
    } catch {
      this.passwordError.set('Could not update password. Please try again.');
    } finally {
      this.savingPassword.set(false);
    }
  }

  async onThemeToggle(isDark: boolean): Promise<void> {
    this.themeError.set(null);
    const previous = this.isDarkTheme();
    this.isDarkTheme.set(isDark);
    try {
      await this.userService.updateTheme(isDark ? 'dark' : 'light');
    } catch {
      this.isDarkTheme.set(previous);
      this.themeError.set('Could not update theme. Please try again.');
    }
  }

  onDeleteAccount(): void {
    this.confirmingDelete.set(true);
  }

  onCancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  async onConfirmDelete(): Promise<void> {
    this.deleteError.set(null);
    this.deletingAccount.set(true);
    try {
      await this.userService.deleteAccount();
      this.router.navigateByUrl('/');
    } catch {
      this.deleteError.set('Could not delete account. Please try again.');
      this.deletingAccount.set(false);
    }
  }
}
```

Create `src/app/features/account/account.component.html`:

```html
<h1>Account</h1>

<form (ngSubmit)="onSaveDisplayName()">
  <h2>Display name</h2>
  <input pInputText type="text" [(ngModel)]="displayName" name="displayName" required />
  @if (displayNameNotice()) {
    <p-message severity="success">{{ displayNameNotice() }}</p-message>
  }
  @if (displayNameError()) {
    <p-message severity="error">{{ displayNameError() }}</p-message>
  }
  <button pButton type="submit" [disabled]="savingDisplayName() || displayName.trim() === ''">Save Name</button>
</form>

<form (ngSubmit)="onSavePassword()">
  <h2>Password</h2>
  <input pInputText type="password" placeholder="New password" [(ngModel)]="newPassword" name="newPassword" />
  <input
    pInputText
    type="password"
    placeholder="Confirm password"
    [(ngModel)]="confirmPassword"
    name="confirmPassword"
  />
  @if (passwordNotice()) {
    <p-message severity="success">{{ passwordNotice() }}</p-message>
  }
  @if (passwordError()) {
    <p-message severity="error">{{ passwordError() }}</p-message>
  }
  <button pButton type="submit" [disabled]="savingPassword() || newPassword === ''">Update Password</button>
</form>

<div>
  <h2>Theme</h2>
  <label>
    <p-toggleswitch [ngModel]="isDarkTheme()" (ngModelChange)="onThemeToggle($event)" name="theme" />
    Dark mode
  </label>
  @if (themeError()) {
    <p-message severity="error">{{ themeError() }}</p-message>
  }
</div>

<div class="danger-zone">
  <h2>Delete Account</h2>
  @if (deleteError()) {
    <p-message severity="error">{{ deleteError() }}</p-message>
  }
  @if (confirmingDelete()) {
    <p>Delete your account? This cannot be undone.</p>
    <button pButton [text]="true" (click)="onCancelDelete()">Cancel</button>
    <button pButton severity="danger" [disabled]="deletingAccount()" (click)="onConfirmDelete()">
      Yes, delete my account
    </button>
  } @else {
    <button pButton severity="danger" (click)="onDeleteAccount()">Delete Account</button>
  }
</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/account
git commit -m "Add Account page: display name, password, theme, delete account"
```

---

## Task 5: Routing & Nav Integration

**Files:**
- Modify: `src/app/app.routes.ts`
- Modify: `src/app/app.html`

**Interfaces:**
- Consumes: `AccountComponent` (Task 4), `authGuard` (existing).

- [ ] **Step 1: Add the guarded route**

In `src/app/app.routes.ts`, add (alongside the existing `favorites`/`trips` guarded routes):

```ts
  {
    path: 'account',
    loadComponent: () => import('./features/account/account.component').then((m) => m.AccountComponent),
    canActivate: [authGuard],
  },
```

- [ ] **Step 2: Add the nav link**

In `src/app/app.html`, add an "Account" link next to "Sign out," inside the existing authenticated branch:

```html
<nav class="app-nav">
  <a routerLink="/">Finder</a>
  <a routerLink="/favorites">Favorites</a>
  <a routerLink="/trips">Trips</a>
  @if (supabase.isAuthenticated) {
    <a routerLink="/account">Account</a>
    <button pButton [text]="true" (click)="onSignOut()">Sign out</button>
  } @else {
    <a routerLink="/login">Sign in</a>
  }
</nav>
<router-outlet />
```

- [ ] **Step 3: Run the full test suite**

Run: `npx ng test --watch=false`
Expected: PASS (no existing test references the nav's exact link count/text, so this is a regression check, not a new assertion).

- [ ] **Step 4: Verify in a real browser**

Run `npx ng serve`, then in a browser:

1. Sign in with an existing test account.
2. Click "Account" in the nav — confirm the page loads with the current display name pre-filled.
3. Change the display name, save, reload the page — confirm it persisted.
4. Change the password, sign out, sign back in with the new password — confirm it works.
5. Toggle dark mode, reload the page — confirm the toggle stays on (persisted), and check `document.documentElement.dataset.theme` in devtools reflects it (no visual reskin is expected yet — that's explicitly out of scope).
6. Sign out and try navigating to `/account` directly — confirm the `authGuard` redirects to `/login`.
7. Using a throwaway test account (see Global Constraints), click "Delete Account," confirm the two-step inline confirmation appears, cancel it once to confirm Cancel works, then confirm for real — confirm you're signed out and redirected, and that signing back in with that account's credentials fails.
8. Check the browser console for errors at each step above.

- [ ] **Step 5: Commit**

```bash
git add src/app/app.routes.ts src/app/app.html
git commit -m "Route and link the Account page"
```
