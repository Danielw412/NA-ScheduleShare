# AGENTS.md

## Project

NA ScheduleShare is a React + TypeScript + Vite website backed by Supabase. It supports semester-aware A/B-day schedules, classmate discovery, access requests, screenshot importing, and secure sharing. It is not an official school website.

Make the smallest change that solves the request. Do not scan unrelated systems for a narrow UI or copy change.

## Start with the likely file

- Page content or layout: `src/pages/`
- Reusable UI: `src/components/`
- Navigation and notifications: `src/components/layout/`
- Global styling: `src/styles.css`
- Mobile viewport/safe-area fixes: `src/mobile-layout-fixes.css`
- Site name, links, production URL, and logo: `src/config/brand.ts`
- Routes: `src/App.tsx`
- Schedule behavior: `src/hooks/useSchedule.ts`, `src/lib/schedule.ts`, and `src/components/schedule/`
- Supabase calls: `src/lib/supabase/data.ts`
- Authentication and recovery: `src/features/auth/AuthProvider.tsx` and `src/pages/PasswordResetPage.tsx`
- Database schema, RLS, and RPCs: `supabase/migrations/`
- Active Gemini importer: `src/lib/scheduleImport.ts`, `src/components/schedule/ScheduleImportDialog.tsx`, and `supabase/functions/schedule-import/`
- Share pages/images and legacy importer: `cloudflare/schedule-import-worker/`

Use search to find the exact text, component, function, RPC, or migration involved. Read that file and its direct dependencies before editing.

## Simple website changes

For copy, color, spacing, responsive CSS, icons, static links, or presentational ordering:

1. Find the exact page or component.
2. Inspect the relevant CSS file.
3. Make a narrow patch without unrelated refactoring.
4. Preserve desktop, mobile, safe-area, and existing component behavior.
5. Do not inspect backend code or migrations unless the change affects stored behavior or authorization.

Do not run `pnpm install`, regenerate database types, or run the full suite for a clearly presentational or documentation-only change.

## Validation

- TypeScript logic, state, forms, or routing: `pnpm typecheck` plus the most relevant test
- Shared frontend behavior: `pnpm test`
- Build, environment, or deployment changes: `pnpm build`
- Active importer changes: `pnpm test:function`
- Worker/share changes: `pnpm worker:typecheck` and `pnpm test:worker`
- Auth, privacy, admin permissions, Supabase queries, RLS, RPCs, or migrations: inspect the full data flow and run relevant frontend and database tests
- Documentation-only changes: verify the final diff; tests are not required

## Non-negotiable rules

- Never expose service-role keys, Gemini keys, OAuth secrets, or other private credentials in frontend code or `VITE_*` variables.
- Frontend guards are not security boundaries. Authorization, privacy, suspension, and admin access must remain enforced by Supabase RLS and RPCs.
- Do not trust user IDs or roles supplied by the browser.
- Treat `course_names.term_policy` as the course-format authority.
- Personal attendance belongs in `class_enrollment_meeting_slots`; do not create duplicate class sections for each student's pattern.
- Removing an enrollment must not delete the shared class.
- Lunch and Study Hall teachers must remain `N/A` in both UI and database paths.
- Full Year Lunch must expand into separate Semester 1 and Semester 2 enrollments at the same period.
- Preserve automatic Lunch/Study Hall period and attendance inference unless the request explicitly changes it.
- New screenshot-import behavior belongs in the Supabase Edge Function, not the legacy Cloudflare importer.
- Do not edit a migration already applied to production. Add a new ordered migration.
- Do not weaken schedule privacy, roster visibility, share-link privacy, access-request enforcement, suspension checks, or audit logging.
- Preserve unrelated work and avoid broad rewrites for small requests.

At the end, state which files changed and what validation was performed.
