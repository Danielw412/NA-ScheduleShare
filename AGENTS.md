# AGENTS.md

## Project

NA ScheduleShare is a React + TypeScript + Vite website backed by Supabase. It lets students build and share A/B-day schedules with privacy controls. It is not an official school website.

Make the smallest change that solves the request. Do not scan the entire repository unless the task genuinely affects multiple systems.

## Start with the likely file

- Page content or layout: `src/pages/`
- Reusable UI: `src/components/`
- Global styling and responsive rules: `src/styles.css`
- Site name, links, and logo configuration: `src/config/brand.ts`
- Routes: `src/App.tsx`
- Schedule behavior: `src/hooks/useSchedule.ts`, `src/lib/schedule.ts`, and `src/components/schedule/`
- Supabase calls: `src/lib/supabase/data.ts`
- Authentication and profile state: `src/features/auth/AuthProvider.tsx`
- Database schema, RLS, and RPCs: `supabase/migrations/`
- Screenshot importer: `src/lib/scheduleImport.ts`, `src/components/schedule/ScheduleImportDialog.tsx`, and `cloudflare/schedule-import-worker/`

Use search to find the exact text, component, or function named in the request. Read that file and only its direct dependencies before editing.

## Simple website changes

For copy changes, colors, spacing, responsive CSS, icons, static links, or hiding/reordering presentational elements:

1. Find the exact page or component.
2. Inspect that file and the relevant section of `src/styles.css`.
3. Make a narrow patch without unrelated refactoring.
4. Preserve existing component patterns and mobile behavior.
5. Do not inspect database migrations, backend code, or test suites unless the change touches them.
6. Tests are not required for a clearly presentational change unless the user asks for them. A quick local visual check is enough when available.

Do not run `pnpm install`, regenerate database types, or run the full test suite for a small UI or text edit.

## When validation is needed

- TypeScript logic, state, forms, or routing: run `pnpm typecheck` and the most relevant test.
- Shared frontend behavior: run `pnpm test`.
- Build, environment, or deployment changes: run `pnpm build`.
- Worker changes: run `pnpm worker:typecheck` and `pnpm test:worker`.
- Auth, privacy, admin permissions, Supabase queries, RLS, RPCs, or migrations: inspect the full data flow and run the relevant frontend and database tests.

Useful commands:

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:privacy
```

## Non-negotiable rules

- Never expose service-role keys, OAuth secrets, or other private credentials in frontend code or `VITE_*` variables.
- Frontend guards are not security boundaries. Authorization and privacy must remain enforced by Supabase RLS and RPCs.
- Do not trust user IDs or admin roles supplied by the browser.
- Removing a student's enrollment must not delete the shared class.
- Do not edit a migration already applied to production. Add a new migration.
- Do not weaken schedule privacy, roster visibility, suspension enforcement, or admin auditing.
- Preserve unrelated work and avoid broad rewrites for small requests.

At the end, state which files changed and what validation, if any, was performed.