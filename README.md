# CampsiteFinder

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.1.4.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Supabase backend

Project: `campsite-finder` (`jpiicvvnipsckkhgjinn`, us-east-1). Dashboard: https://supabase.com/dashboard/project/jpiicvvnipsckkhgjinn

### Auth email testing

Supabase's built-in email service (used by `auth.signUp` in [signup.component.ts](src/app/features/auth/signup.component.ts)) has strict, shared sending limits and will throttle/restrict a project once its bounce rate gets flagged. Rules of thumb:

- **Don't invent throwaway addresses** (`test@test.com`, `asdf@asdf.com`, etc.) when exercising the signup form manually — they bounce and count against the project.
- Use a real inbox you control (a `+alias` on your own domain/Gmail works fine, e.g. `shawnpfarmer+test1@gmail.com`) or a disposable-but-valid service (Mailinator, temp-mail) so the address actually accepts mail.
- Before shipping to real users, switch off the shared Supabase email service and configure [custom SMTP](https://supabase.com/dashboard/project/jpiicvvnipsckkhgjinn/settings/auth) (Auth → Settings → SMTP Settings) — this is Supabase's own recommendation and removes the shared-service bounce-rate risk entirely.

### Known security advisories (from `supabase get_advisors`, 2026-08-18)

- ~~`handle_new_user()` callable directly via RPC by `anon`/`authenticated`~~ — fixed in [0002_lock_down_handle_new_user.sql](supabase/migrations/0002_lock_down_handle_new_user.sql), which revokes `EXECUTE` from `public`/`anon`/`authenticated`. The `on_auth_user_created` trigger still fires normally (trigger invocation isn't ACL-checked the way a direct RPC call is).
- **Leaked password protection is disabled** — enable it in Auth settings (dashboard toggle, not a migration) so signups are checked against HaveIBeenPwned.
- `postgis` extension and its dependency `spatial_ref_sys` table live in the `public` schema (RLS-disabled lint fires on `spatial_ref_sys`). This is PostGIS's default install layout and low-risk (read-only reference data, no user data) but the by-the-book fix is moving the extension to its own schema.
- A couple of PostGIS-related functions (`nearest_campgrounds`, `get_campgrounds_by_ids`, `st_estimatedextent`) have mutable `search_path`, flagged by the linter as a general hardening recommendation.
- **`spatial_ref_sys` has RLS disabled and can't be fixed directly** — it's owned by `supabase_admin` (created by the `postgis` extension), and the project's `postgres` role isn't the table owner, so `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` fails with "must be owner of table" even via migrations. Confirmed via `list_tables`: it's the *only* public table without RLS — `campgrounds`, `profiles`, and `favorites` all have it enabled. Since `spatial_ref_sys` holds ~8,500 static EPSG projection rows with no user data, the advisory is safe to leave as-is. The real fix, if pursued, is moving the `postgis` extension out of the `public` schema into a dedicated non-exposed schema — a bigger change since it touches everything that references PostGIS types (`campgrounds.location`, `nearest_campgrounds()`), so treat as a separate task rather than a quick migration.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
