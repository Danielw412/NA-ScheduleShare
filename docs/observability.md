# Logging and issue tracking

ScheduleShare reports errors from every part of the system into one place,
groups them into **issues**, and lets administrators triage them under
**Administration → Issues**. Event shapes and grouping follow Sentry's model,
so switching on Sentry later is a dependency install and a few lines of setup
(see [Enabling Sentry](#enabling-sentry)).

## Privacy rules

ScheduleShare's users are high-school students. These rules apply to every
log line and error report, in every component:

- An event may carry an **opaque account id**. Never names, emails, grades,
  schedules, class rosters, share tokens, screenshots, prompts, or AI
  responses.
- Routes are reported as templates (`/students/:id`, `/share/:token`).
- Request breadcrumbs record method, path, status, and duration only — never
  query strings, headers, or bodies.
- Scrubbing happens before data leaves the browser
  (`src/lib/observability/scrub.ts`) **and again** in the database
  (`private.issue_*` sanitizers and `private.safe_event_metadata`).

## How it fits together

```
Browser                    Edge Functions            Schedule Engine worker
src/lib/observability      _shared/observability.ts  src/observability.ts
  capture + scrub            request logs (JSON)       job logs (text or JSON)
  breadcrumbs                crash → issue             failure → issue
  error boundaries
      │                           │                          │
      ▼ report_app_issue          ▼ service_report_app_issue ▼
   ┌───────────────────────────────────────────────────────────┐
   │ private.app_issues (grouped by fingerprint)                │
   │ private.app_issue_events (25 newest samples per issue)     │
   │ private.app_issue_users (affected accounts)                │
   └───────────────────────────────────────────────────────────┘
      ▲ admin_list/get/update/delete_app_issue
   Administration → Issues
```

### Browser (`src/lib/observability/`)

| File | Purpose |
| --- | --- |
| `client.ts` | Capture hub: `captureException`, `captureMessage`, `addBreadcrumb`, `setUser`, `setTag`. Deduplicates repeats (30 s window) and caps events per page load. |
| `logger.ts` | `createLogger(scope)` — `debug`/`info`/`warn` leave breadcrumbs; `error` also creates an issue. |
| `scrub.ts` | Privacy scrubbing for text, data, and routes. |
| `stack.ts`, `fingerprint.ts` | Stack parsing and grouping keys that survive deploys (content hashes are stripped from chunk names). |
| `globalHandlers.ts` | Uncaught errors, unhandled rejections, connectivity changes, stale-chunk detection. |
| `instrumentFetch.ts` | Wraps the Supabase client's `fetch`: a breadcrumb per request; 5xx responses become warning-level issues. |
| `transports/` | `console` (development), `database` (first-party store, batched and capped), `sentry` (adapter). |
| `setup.ts` | Called once from `src/main.tsx`. |

React integration:

- `src/components/errors/ErrorBoundary.tsx` + `ErrorFallback.tsx`. A boundary
  wraps the whole app and another wraps each routed page, so a crash keeps
  the navigation usable. The fallback shows an **error reference** (the first
  eight characters of the event id) and links to *Report a problem* with the
  reference filled in. Administrators paste that reference into
  *Find* on the Issues screen.
- A stale tab after a deploy (lazy route chunk gone) shows "ScheduleShare was
  updated" with a reload button instead of an error.
- `AuthProvider` attaches the signed-in account id; `AppShell` records
  navigation breadcrumbs.

Use it in code:

```ts
import { createLogger } from '../lib/observability'

const log = createLogger('schedule-import')
log.info('Upload started', { files: 2 })
try {
  await importSchedule()
} catch (error) {
  log.error('Import failed', error, { tags: { step: 'apply' } })
  setMessage('The import could not be saved. Try again.')
}
```

Expected business errors (validation, permission, rate limits) should stay
inline in the UI and do **not** need `log.error`; reserve issues for things a
developer should fix.

### Edge Functions (`supabase/functions/_shared/observability.ts`)

Each function's default export is wrapped with `observeHandler`, which:

- writes one JSON line per request (`function`, `request_id`, `method`,
  `status`, `duration_ms`) — searchable in the Supabase log explorer;
- catches crashes, including async rejections that the previous
  `try { return handler() }` pattern let escape, answers with the function's
  own 503 "unavailable" response, and reports an issue through
  `service_report_app_issue` with the service-role client.

Set the optional `APP_RELEASE` function secret to tag reports with a release.

### Schedule Engine worker (`schedule-engine-worker/src/observability.ts`)

Failed jobs are logged and reported (`source = schedule_engine`). Notification
failures are reported as warnings and never change a completed job's outcome.
Set `SCHEDULE_ENGINE_LOG_FORMAT=json` for JSON log lines and `APP_RELEASE` to
tag reports.

### Cloudflare share worker

`cloudflare/schedule-import-worker/src/entry.ts` already logs one JSON line per
request with the `CF-Ray` request id and catches unexpected failures. It only
holds a publishable key, so it does not write to the issue store; use
Cloudflare's Workers Logs, or Sentry (below).

## The issue store

Migration: `supabase/migrations/20261016140000_app_issue_tracking.sql`.
Tests: `supabase/tests/database/app_issue_tracking.test.sql`.

- **Grouping**: by `fingerprint`. Severity escalates (warning → error → fatal);
  releases are tracked as first/last seen.
- **Regressions**: a new event on a *resolved* issue reopens it and marks it
  regressed.
- **Abuse limits**: each account may report 10 events per minute; anonymous
  visitors share 30 per minute; browser reports are capped at 300 per hour and
  2,000 per day (500 anonymous, 1,500 signed in); browser events over 6 KB are
  rejected (16 KB for servers). New issues have separate hourly budgets for the
  browser (40) and for servers (60), so browser spam can never block Edge
  Function or Schedule Engine reports. Reports outside these limits are dropped
  silently.
- **Kill switch**: *Accept new reports* on the Issues screen
  (`admin_set_app_issue_ingest`).
- **Retention** (`app-issue-retention` cron job, daily): anonymous browser
  samples for 7 days, other samples for 30 days; issues nobody has hit for 90
  days are deleted; rate-limit counters for two days. Deleting an account
  removes its affected-account rows and detaches its events.
- **Access**: administrators only. Account ids on sample events are shown to
  super administrators only, matching who can see per-account activity
  elsewhere. Status changes, deletions, ingestion changes, and new
  server-side issues are written to the event log.

Configuration (`.env.example`):

| Variable | Meaning |
| --- | --- |
| `VITE_APP_RELEASE` | Release tag on browser reports. CI sets it to the commit SHA. |
| `VITE_ISSUE_REPORTING` | `off` stops the browser from sending reports to the issue store. |
| `VITE_SENTRY_DSN` | Reserved for Sentry. |

Development builds print captured events to the console and never send them
to the database.

## Enabling Sentry

1. `pnpm add @sentry/react`
2. In `src/main.tsx`, before `setupObservability`:

   ```ts
   import * as Sentry from '@sentry/react'
   import { createSentryTransport, scrubSentryBreadcrumb, scrubSentryEvent } from './lib/observability'

   const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim()
   if (sentryDsn) {
     Sentry.init({
       dsn: sentryDsn,
       release: import.meta.env.VITE_APP_RELEASE,
       environment: import.meta.env.MODE,
       sendDefaultPii: false,
       // ScheduleShare's own handlers already capture uncaught errors.
       integrations: (defaults) => defaults.filter((integration) => integration.name !== 'GlobalHandlers'),
       // Apply the same privacy rules to what Sentry collects on its own.
       beforeSend: (event) => scrubSentryEvent(event),
       beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
     })
   }

   setupObservability({
     reportIssue: isSupabaseConfigured ? reportAppIssue : undefined,
     transports: sentryDsn ? [createSentryTransport(Sentry)] : [],
   })
   ```

   Every captured event then goes to Sentry with the same fingerprint,
   breadcrumbs, tags, and account id. The adapter sends a scrubbed copy of each
   error, and the `beforeSend`/`beforeBreadcrumb` scrubbers cover what Sentry's
   own integrations collect (request URLs, navigation and fetch breadcrumbs). Set `VITE_ISSUE_REPORTING=off` if you no
   longer want the first-party store.
3. Source maps: build with `build.sourcemap: 'hidden'` and upload `dist/**/*.map`
   with `@sentry/vite-plugin` or `sentry-cli` in the deploy workflow, then
   delete the `.map` files before publishing to GitHub Pages.
4. Edge Functions: Sentry's Deno SDK can be called from `observeHandler`'s
   catch block next to `reportIssue`.
5. Cloudflare worker: wrap the default export in `entry.ts` with
   `withSentry` from `@sentry/cloudflare`.
