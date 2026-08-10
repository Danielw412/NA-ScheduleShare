# AGENTS.md

## What this repo is

NA ScheduleShare is a React + TypeScript + Vite frontend on GitHub Pages, backed by Supabase Auth/Postgres/RLS/RPCs. It also has a Supabase Gemini screenshot importer, a Cloudflare Worker for public share pages/images plus a legacy importer, and a separate laptop-run Schedule Engine worker.

Start here instead of scanning the whole repo. For normal changes, find the exact page/component/function/RPC named below, read it plus its direct dependencies and nearby tests, then make the smallest safe patch.

## Fast map: where to change things

### Frontend

- Routes / page wiring: `src/App.tsx`
- Routed screens: `src/pages/`
- Shared UI: `src/components/`
- Schedule editor UI: `src/components/schedule/`
- Navigation, shell, access-request notifications: `src/components/layout/`
- Auth/session/onboarding state: `src/features/auth/AuthProvider.tsx`
- Auth guards/prompts: `src/components/auth/`
- Schedule loading state: `src/hooks/useSchedule.ts`
- Class/course search hooks: `src/hooks/useClassSearch.ts`, `src/hooks/useCourseNameSearch.ts`
- Core schedule/slot/conflict helpers: `src/lib/schedule.ts`
- Shared app/domain types: `src/lib/domain.ts`
- Teacher normalization/validation: `src/lib/teacher.ts`
- Almost all browser -> Supabase reads/writes/RPC calls: `src/lib/supabase/data.ts`
- Supabase client setup: `src/lib/supabase/client.ts`
- Generated DB types: `src/lib/supabase/database.types.ts` — regenerate with `pnpm types:generate`; do not hand-edit
- Brand/site URLs/logo config: `src/config/brand.ts`
- Main CSS: `src/styles.css`
- Targeted mobile/safe-area fixes: `src/mobile-layout-fixes.css`
- Demo-mode fixtures: `src/lib/demo-data.ts`

### Main pages

- Schedule: `src/pages/SchedulePage.tsx`
- Students/directory: `src/pages/StudentsPage.tsx`
- Student schedule/access: `src/pages/StudentDetailPage.tsx`
- Classes/rosters: `src/pages/ClassesPage.tsx`
- Schedule Engine: `src/pages/ScheduleEnginePage.tsx`
- Profile/privacy: `src/pages/ProfilePage.tsx`
- Admin: `src/pages/AdminPage.tsx`
- Reports: `src/pages/ReportPage.tsx`
- Public React share view: `src/pages/SharedSchedulePage.tsx`

### Supabase / database

- Schema, RLS, policies, triggers, indexes, RPCs: `supabase/migrations/`
- Database authorization/integrity tests: `supabase/tests/database/`
- Local Supabase config: `supabase/config.toml`
- Active Gemini importer: `supabase/functions/schedule-import/`
- Account deletion Edge Function: `supabase/functions/delete-account/`
- Protected site reset Edge Function: `supabase/functions/site-reset/`

Never edit a migration already applied to production. Add a new timestamped migration. When changing a table/RPC/policy, search later migrations for the same object before assuming an older migration is still the current definition.

### Schedule Engine worker

The website only queues/reads jobs. Actual prediction runs in `schedule-engine-worker/` using the Supabase service-role key on the operator's machine.

- Worker overview/setup: `schedule-engine-worker/README.md`
- Queue lifecycle / processing: `schedule-engine-worker/src/worker.ts`
- Supabase worker RPC adapter: `schedule-engine-worker/src/supabase-store.ts`
- Core search algorithm: `schedule-engine-worker/src/prediction-engine.ts`
- Final completeness/credit/special-course policy layer: `schedule-engine-worker/src/schedule-policy.ts`
- Shared worker types: `schedule-engine-worker/src/types.ts`
- Email notification: `schedule-engine-worker/src/notifier.ts`
- CLI / local control panel: `schedule-engine-worker/src/cli.ts`, `schedule-engine-worker/src/gui.ts`
- Tests: `schedule-engine-worker/test/`

Frontend Schedule Engine prechecks live in `src/lib/scheduleEngineRules.ts`; worker-side enforcement lives in `schedule-engine-worker/src/schedule-policy.ts`. If changing credit, completeness, Study Hall, Lunch, or replacement rules, inspect and usually update both sides plus their tests.

### Sharing / Cloudflare

`cloudflare/schedule-import-worker/` has two responsibilities:

1. Current public share HTML + 1200x630 preview PNGs.
2. The old Cloudflare-AI screenshot importer kept for backward compatibility.

- Worker entry/router: `cloudflare/schedule-import-worker/src/entry.ts`
- Legacy importer: `cloudflare/schedule-import-worker/src/index.ts`
- Share HTML/image logic: `cloudflare/schedule-import-worker/src/share.ts`
- Bounded HTTP helpers: `cloudflare/schedule-import-worker/src/http.ts`
- Worker config: `cloudflare/schedule-import-worker/wrangler.toml`
- Tests: `cloudflare/schedule-import-worker/test/`

New screenshot-import behavior belongs in the Supabase `schedule-import` Edge Function, not the legacy Cloudflare importer.

### Deployment / docs

- Main CI + GitHub Pages deploy: `.github/workflows/deploy.yml`
- Cloudflare worker deploy: `.github/workflows/deploy-worker.yml`
- Operational/design notes: `docs/`
- Root setup/commands/architecture: `README.md`
- `backup/` contains historical text snapshots; do not use or edit them unless explicitly requested.

## How ScheduleShare works

### Schedule data flow

Typical editor flow:

`SchedulePage` -> `useSchedule` / schedule components -> helpers in `src/lib/schedule.ts` -> functions in `src/lib/supabase/data.ts` -> Supabase RPC/table access -> RLS/database validation.

Important data model:

- `course_names`: approved catalogue entry; `term_policy` defines allowed schedule format.
- `classes`: shared section such as course + teacher + default pattern.
- `class_meeting_slots`: a shared section's default A/B periods.
- `class_enrollments`: a student's membership in a shared section and academic term.
- `class_enrollment_meeting_slots`: that student's actual attendance pattern for the section.

A class is shared data. A student's enrollment/meeting slots are personal schedule data. Removing one enrollment must not delete the shared class.

### Schedule rules that are easy to break

- `course_names.term_policy` is the format authority; do not infer policy only from course text.
- Conflicts are semester-aware and A/B-day-aware.
- A student-specific pattern belongs in `class_enrollment_meeting_slots`, not a duplicate class section.
- Lunch and Study Hall teachers are `N/A` through UI and database paths.
- Full Year Lunch is represented as matching Semester 1 + Semester 2 enrollments at the same period.
- Lunch/Study Hall period/day behavior is intentionally inferred in several flows; preserve it unless the request changes the rule.
- Teacher names are normalized through `src/lib/teacher.ts`; do not add one-off normalization elsewhere.
- Schedule Engine only uses existing sections/patterns. It does not invent new sections.
- Schedule Engine returns at most three ranked schedules, preferring fewer collateral changes, and rejects incomplete or credit-unbalanced results.

### Screenshot import flow

`ScheduleImportDialog` -> `src/lib/scheduleImport.ts` -> Supabase `schedule-import` Edge Function -> Gemini -> catalogue/class resolution -> frontend auto-apply or review -> authorized schedule write.

Key files:

- UI: `src/components/schedule/ScheduleImportDialog.tsx`
- Browser preprocessing/review/apply helpers: `src/lib/scheduleImport.ts`
- Server request/provider/catalogue logic: `supabase/functions/schedule-import/core.ts`
- Function wiring/Supabase RPC access: `supabase/functions/schedule-import/index.ts`

The AI output is untrusted. It must resolve against the approved catalogue and pass normal schedule validation. Guest imports may remain local until account creation; screenshots are request data, not application records.

### Privacy, auth, and admin

Frontend route guards are UI only. Security must remain enforced in Supabase RLS/security-definer RPCs.

When changing schedule visibility, classmates, rosters, access requests, suspension, admin actions, reporting, event logs, or account deletion, trace the whole path:

page/component -> `src/lib/supabase/data.ts` -> RPC/table -> current migration definition/RLS -> relevant database test.

Do not trust a browser-supplied user ID, role, admin flag, or access decision.

### Public sharing

Frontend share-link management is in `src/lib/scheduleShare.ts`. Anonymous share HTML/images are served by the Cloudflare Worker using the bounded `get_public_schedule_share` RPC. Privacy-sensitive unavailable states intentionally expose the same generic no-data response and share responses use `no-store`.

## Editing rules

- Prefer exact symbol/text search over repo-wide reading.
- Read the target file, imported domain/helper code, corresponding data/RPC path, and nearby tests only as needed.
- Keep changes narrow; do not refactor unrelated areas while fixing one feature.
- Do not duplicate business rules in a new helper if an existing one in `schedule.ts`, `teacher.ts`, `scheduleEngineRules.ts`, database RPCs, or worker policy already owns it.
- Do not move authorization from the database into React.
- Never expose service-role keys, Gemini keys, SMTP credentials, OAuth secrets, or other private secrets in frontend code or `VITE_*` variables.
- The Schedule Engine service-role key belongs only in the local worker environment.
- Do not weaken schedule privacy, roster visibility, access-request enforcement, suspension checks, share-link privacy, or audit logging.
- Preserve unrelated work.

## Validation

Use the smallest relevant validation, then expand if the change crosses boundaries:

- Docs only: inspect final diff; no tests required.
- Frontend TypeScript/state/forms/routing: `pnpm typecheck` + nearest test file.
- Shared frontend behavior: `pnpm test`.
- Schedule core rules: relevant `src/lib/*.test.ts` plus affected page/component tests.
- Schedule Engine frontend/worker rules: `pnpm typecheck` and `pnpm test:schedule-engine`.
- Active importer: `pnpm test:function`; also relevant frontend importer tests when browser review/apply behavior changes.
- Cloudflare share/legacy worker: `pnpm worker:typecheck` and `pnpm test:worker`.
- RLS/RPC/schema/privacy/admin changes: `pnpm test:privacy` with local Supabase running, plus affected frontend tests.
- Build/env/deploy changes: `pnpm build` and the subsystem typechecks/tests above.

Do not run `pnpm install`, regenerate DB types, reset the database, or run every suite for a simple copy/CSS/docs change.

At the end, report files changed and validation performed.