# NA ScheduleShare

NA ScheduleShare is a student schedule-sharing application built by the **NA Computer and AI Club**. It is not an official school website. Students build an A/B-day schedule, find shared classes, and discover schedules only when each schedule owner’s privacy choice permits it. Administrators can moderate accounts, reports, classes, duplicate merges, roles, history, and audit records.

The frontend is React 19 + TypeScript + Vite and uses a `HashRouter`, so nested routes work when hosted at `https://danielw412.github.io/NA-ScheduleShare/`. Supabase provides Auth and PostgreSQL. Privacy and authorization are enforced in PostgreSQL with RLS and narrowly granted RPC functions; frontend checks are only presentation safeguards.

## Features

- Google OAuth with a personal-account reminder, plus email/password sign-up and sign-in
- Required full-name, grade, and privacy onboarding
- Immediate protected-data lockout for suspended accounts
- Fast A/B schedule-cell workflow with term selection, double-period support, conflict warnings, replace/remove actions, and immutable history
- Shared class definitions with explicit normalized meeting-slot rows
- Privacy-aware class members, classmates, student schedules, and searchable school directory
- Reports with moderation workflows
- Admin sections for users, reports, classes, schedule history, roles, and immutable audit logs
- Transactional duplicate-class merging that preserves enrollment and avoids duplicate membership
- Responsive black, gold, and white interface using centralized brand/design tokens

## Architecture

The central model separates three concepts:

1. `classes` stores a shared course definition (name, teacher, default term, and double-period flag).
2. `class_meeting_slots` stores one validated A/B day + period row per explicit meeting slot. Nothing is packed into an unvalidated text field.
3. `class_enrollments` connects a student to a shared class and stores that student’s term and active status. Removing an enrollment never deletes the shared class.

`profiles` stores safe student-facing data. Administrative roles and suspension/deletion metadata live in the non-exposed `private` schema. History, reports, and audit tables preserve their own records when a user is deleted by using nullable references where appropriate.

The browser never receives a service-role key. Student writes and every admin action use functions that derive the actor from `auth.uid()`. Base-table grants are minimized, all relevant tables have RLS enabled, and `private` schema tables are not exposed through the Data API.

## Prerequisites

- Node.js 22 or newer (CI uses Node 24)
- pnpm 11.7.0
- Docker Desktop for the local Supabase stack
- Supabase CLI (installed as a pinned development dependency)

## Local development

```bash
pnpm install
cp .env.example .env.local
pnpm supabase:start
pnpm db:reset
pnpm dev
```

Copy the local API URL and publishable/anonymous key printed by `pnpm supabase:start` into `.env.local`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your-local-public-key
VITE_ENABLE_DEMO_MODE=false
```

Open `http://127.0.0.1:5173/NA-ScheduleShare/`. Local seed accounts all use `ScheduleShare123!`:

- `admin@scheduleshare.local`
- `jordan@scheduleshare.local`
- `alex@scheduleshare.local`

For UI-only work without Supabase, set `VITE_ENABLE_DEMO_MODE=true` and leave the two Supabase variables blank. Demo mode is intentionally disabled in `.env.example` and must not be enabled for production.

## Validation commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:privacy
pnpm build
pnpm preview
```

`pnpm test:privacy` expects the local Supabase stack to be running. The pgTAP suite verifies private, classmates, and school schedule visibility; suspended-user denial; admin-operation denial; self-promotion prevention; direct enrollment-table protection; and transactional class merging.

## Supabase project setup

1. Create a Supabase project on a currently supported PostgreSQL major version.
2. Install the CLI dependency with `pnpm install` and authenticate with `pnpm exec supabase login`.
3. Link the repository: `pnpm exec supabase link --project-ref YOUR_PROJECT_REF`.
4. Apply migrations: `pnpm db:push`.
5. In Authentication > URL Configuration set:
   - Site URL: `https://danielw412.github.io/NA-ScheduleShare/`
   - Redirect URL: `https://danielw412.github.io/NA-ScheduleShare/`
   - Also add `http://127.0.0.1:5173/NA-ScheduleShare/` and `http://localhost:5173/NA-ScheduleShare/` for development.
6. In Authentication > Email, keep email/password sign-up enabled. Enable email confirmation for production and configure an SMTP provider before launch.
7. Set production password and Auth rate-limit policies to match or exceed the local settings in `supabase/config.toml`.

Supabase’s current Data API behavior does not automatically expose newly created tables. The migrations explicitly grant only the operations this application needs, which makes the intended API surface repeatable.

### Bootstrap the first administrator

Normal users cannot promote themselves, and the admin-management RPCs require an existing administrator. After the first trusted administrator has signed up, run this once in the Supabase SQL Editor as the project owner, replacing both UUIDs with that user’s Auth UUID:

```sql
insert into private.user_roles (user_id, role, granted_by)
values ('TRUSTED_USER_UUID', 'administrator', 'TRUSTED_USER_UUID')
on conflict (user_id) do update
set role = excluded.role,
    granted_by = excluded.granted_by,
    granted_at = now();
```

After bootstrap, use the Admin page for role management. The database prevents the last administrator from removing their own access.

## Google OAuth setup

1. In Google Cloud Console, configure the OAuth consent screen. This app strongly asks students to choose a personal Google account; it does not claim school endorsement.
2. Create a Web application OAuth client.
3. Add authorized JavaScript origins:
   - `https://danielw412.github.io`
   - `http://127.0.0.1:5173`
   - `http://localhost:5173`
4. Add the Supabase callback as an authorized redirect URI:
   - `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
5. In Supabase Authentication > Providers > Google, enable Google and enter the client ID and secret.
6. Confirm the Supabase Site URL and redirect allowlist from the previous section.

The app sends users back to the GitHub Pages project path; the hash router then restores the application route.

## GitHub Pages deployment

The deployment workflow is `.github/workflows/deploy.yml`. In GitHub:

1. Open Settings > Pages and select **GitHub Actions** as the source.
2. Add Actions secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Push to `main` or run the workflow manually.

The workflow installs the locked dependencies, runs typechecking, linting, unit tests, and the production build, then deploys `dist`. Privacy tests run separately because they require Docker/Supabase services.

## Database commands

```bash
# Rebuild the local database, apply migrations, and load seed data
pnpm db:reset

# Apply pending migrations to the linked remote project
pnpm db:push

# Regenerate frontend Database types from the local schema
pnpm types:generate
```

Always review generated type changes. Never edit an already-applied production migration; add a new migration instead.

## Security model

- `private.require_active_user()` is the gate used by protected application RPCs. RLS policies also call active-user helpers, so suspensions block direct Data API reads and writes.
- `private.can_view_full_schedule(viewer, owner)` implements self/admin, Classmates, and School visibility. Private users expose only membership in a class the viewer also attends.
- Direct `class_enrollments` reads are RLS-limited. A private student’s other enrollments cannot be used to reconstruct their schedule.
- Discovery RPCs require the current student to have at least one active enrollment, except administrators.
- Role and moderation records live in `private`; only safe public wrappers are executable by `authenticated`.
- Class creation and report creation use database-backed rate limits. Names are normalized and exact duplicate creation is rejected; fuzzy suggestions never merge automatically.
- Admin mutations validate the current actor in security-definer functions, record immutable audit entries, and revoke active Auth sessions on suspension.
- Schedule history and audit logs cannot be updated or deleted by normal users.
- Class merge locks both classes, upserts memberships into the canonical class, resolves duplicate student membership, preserves history, audits the operation, and marks the duplicate as merged in one transaction.

See the official Supabase guidance for [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Google login](https://supabase.com/docs/guides/auth/social-login/auth-google), and [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Brand changes

Update `src/config/brand.ts` for the site name, organization, attribution, repository URL, or logo path. Replace `public/na-club-logo.png` to change the current temporary logo without editing page components. `BrandLogo` is the only component responsible for rendering it. Design colors and layout tokens are centralized at the top of `src/styles.css`.

## Repository guide

See `AGENTS.md` for a concise map, exact commands, security invariants, and the required small-change workflow for future contributors and coding agents.
