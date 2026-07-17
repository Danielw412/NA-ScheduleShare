# AGENTS.md

## Project overview

NA ScheduleShare is a student schedule-sharing site built by the NA Computer and AI Club. Students create an A/B-day schedule, find classes and classmates, and discover other schedules only when the schedule owner’s privacy setting permits it. It is not an official school website.

The frontend is a React 19 + TypeScript + Vite single-page application. `src/App.tsx` defines the routes, `src/features/auth/AuthProvider.tsx` owns authentication/profile state, and a `HashRouter` in `src/main.tsx` makes nested routes reliable on GitHub Pages at `/NA-ScheduleShare/`. `.github/workflows/deploy.yml` builds and deploys `dist`.

Supabase supplies Auth and PostgreSQL. Authorization, schedule privacy, suspension enforcement, admin permissions, immutable history, and audit behavior are enforced by PostgreSQL RLS and narrowly granted RPC functions in `supabase/migrations`; frontend route guards are not security boundaries.

Keep the core model distinct:

- `classes` is the shared class definition.
- `class_meeting_slots` stores validated explicit A/B day + period rows for that class.
- `class_enrollments` connects one student to a shared class and stores the student’s academic term and active state.

Removing an enrollment must never delete a shared class. Never collapse meeting slots into a single day/period field or unvalidated text/JSON column.

## Repository map

- `src/pages/` — routed screens: home, authentication/onboarding, schedule, class search/detail, student/classmate directories, profile/privacy/account management, reporting, and the six-section admin page.
- `src/components/` — reusable UI. `auth/` has route/discovery/suspension guards, `layout/` has the shell/navigation/footer, `schedule/` has the grid/add flow/term controls/utility rail, and `ui/` has shared brand/loading components.
- `src/hooks/useSchedule.ts` and `src/hooks/useClassSearch.ts` — schedule loading/mutations and shared debounced class-search state.
- `src/hooks/useCourseNameSearch.ts` — debounced reusable course-catalog search used before creating a class section.
- `src/lib/supabase/client.ts` — browser Supabase client; only public URL/publishable-key variables belong here.
- `src/lib/supabase/data.ts` — typed frontend queries and RPC calls.
- `src/lib/supabase/database.types.ts` — generated-compatible TypeScript database types. Regenerate after schema changes.
- `src/features/auth/AuthProvider.tsx` — Supabase Auth session hydration, pre-profile suspension check, Google/password actions, onboarding, and admin status.
- `src/lib/domain.ts` — shared application domain types and labels.
- `src/lib/schedule.ts` — term overlap, slot lookup, double-period, and conflict logic.
- `src/lib/teacher.ts` — teacher last-name normalization and practical invalid-input checks shared by forms and tests.
- `src/lib/scheduleImport.ts` and `src/components/schedule/ScheduleImportDialog.tsx` — screenshot preparation, Worker client, editable import review, exact class reconciliation, and transactional whole-schedule replacement.
- `src/lib/profile.ts`, `src/components/ui/ProfileAvatar.tsx`, and `src/pages/ProfilePage.tsx` — profile editing, public avatar presentation with fallback initials, Storage upload/removal, privacy controls, and confirmed self-service account deletion.
- `src/pages/AdminPage.tsx` — admin user/report/class/history/role/audit workflows; the database still authorizes every action.
- `src/config/brand.ts` — single source for site name, organization, attribution, URLs, and temporary logo path.
- `src/styles.css` — centralized design tokens and responsive styles.
- `src/lib/*.test.ts` and `src/test/` — frontend unit tests and setup.
- `supabase/migrations/` — ordered schema, secure API/RPC, grant, and RLS migrations.
- `supabase/data/course_names.txt` — authoritative approved course-name catalog embedded idempotently by the catalog migration.
- `supabase/tests/database/` — pgTAP privacy and authorization integration tests.
- `supabase/seed.sql` — local-only Auth users, profiles, classes, slots, and enrollments.
- `supabase/config.toml` — local Supabase/Auth settings and seed configuration.
- `.github/workflows/deploy.yml` and `vite.config.ts` — GitHub Pages build/deployment and `/NA-ScheduleShare/` base path.
- `cloudflare/schedule-import-worker/` and `.github/workflows/deploy-worker.yml` — authenticated screenshot extraction Worker, strict AI-output validation, KV rate limiting, tests, safe public-logo model diagnostic, and manual deployment.
- `supabase/functions/delete-account/` — authenticated server-side account deletion that removes the fixed avatar object and deletes the caller's Auth account with the service role kept inside the function runtime.
- `public/na-club-logo.png` — square site logo, favicon, and mobile touch-icon asset.
- `docs/design/` — generated visual direction references used to validate desktop and mobile implementation.

Update this map whenever the structure changes.

## Common commands

Run from the repository root with Node 22+ and pnpm 11.7.0:

```bash
pnpm install                    # install locked dependencies
pnpm dev                        # start local Vite development
pnpm typecheck                  # run TypeScript project checks
pnpm lint                       # run ESLint
pnpm test                       # run frontend unit tests
pnpm test:worker                # run Cloudflare Worker unit tests
pnpm worker:typecheck           # typecheck the Cloudflare Worker
pnpm test:privacy               # run pgTAP privacy/integration tests; local Supabase must be running
pnpm build                      # create the production build in dist
pnpm preview                    # preview the production build
pnpm db:push                    # apply migrations to the linked Supabase project
pnpm types:generate             # regenerate src/lib/supabase/database.types.ts from local Supabase
pnpm worker:dev                 # start the local Cloudflare Worker
pnpm worker:deploy              # deploy the Cloudflare Worker
```

Local database setup commands:

```bash
pnpm supabase:start
pnpm db:reset
pnpm supabase:stop
```

## Security invariants

- Look for and read the current root `AGENTS.md` before coding.
- Never put the Supabase service-role key, OAuth secret, or other private key in frontend code or `VITE_*` variables.
- Do not trust client-supplied user IDs, role values, owners, or administrators. Database functions must derive the actor from `auth.uid()` and validate it.
- Every exposed table requires RLS, explicit grants, and tests. Keep role/moderation/rate-limit tables in the non-exposed `private` schema.
- Do not weaken `class_enrollments` policies: private schedules must not be reconstructable by direct queries.
- Normal users cannot write roles, moderation data, schedule history, or audit logs.
- Admin actions belong in audited database functions. Merges must remain transactional and preserve enrollment/history.
- A suspension must take effect at the database layer immediately, not only in a route guard.
- Treat privacy/auth/admin/database-access changes as high risk and run the complete frontend plus pgTAP suites.
- Do not edit a migration that has already shipped to production. Add a new ordered migration.

## Small-change workflow

1. Read the relevant files before editing and trace the existing interface/data flow.
2. Identify the smallest set of files required for the fix.
3. Make a narrow, understandable patch. Avoid unrelated refactoring and preserve existing interfaces unless the task requires changing them.
4. Do not rewrite a large component merely to fix a small bug.
5. Run the most relevant targeted test first.
6. Run `pnpm typecheck` and `pnpm lint`.
7. Run `pnpm test` for shared frontend logic. Run the full frontend and `pnpm test:privacy` suites for authentication, database access, privacy, RLS, shared schedule logic, or admin behavior.
8. Run `pnpm build` when route, build, environment, or deployment behavior can be affected.
9. Summarize the files changed and the exact validation performed.

Prefer a narrow, reviewable patch over a broad architectural change. Preserve unrelated work in a dirty worktree.
