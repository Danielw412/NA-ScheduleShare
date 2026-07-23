# NA ScheduleShare

NA ScheduleShare is a student-built website for creating semester-aware A/B-day schedules, finding classmates, and sharing schedules with friends. It was created by the **NA Computer and AI Club** and is not an official school website.

**Live site:** https://danielw412.github.io/NA-ScheduleShare/

## Main features

- Switch between Semester 1 and Semester 2, each with separate A-day and B-day columns
- Support full-year, semester, A-only, B-only, different-period A/B, and double-period classes
- Keep each student's attendance pattern separate while reusing shared class sections
- Import up to three PowerSchool schedule screenshots with Gemini-assisted review
- Find classes and classmates based on each student's privacy setting
- Search student schedules when access is permitted
- Report inappropriate content or accounts
- Manage users, classes, reports, roles, and audit history through the admin dashboard
- Edit profile information, upload a profile picture, change privacy settings, or delete an account
- Responsive desktop and mobile interface

## Technology

- React 19
- TypeScript
- Vite
- Supabase Auth and PostgreSQL
- PostgreSQL Row Level Security and RPC functions
- Supabase Edge Functions and Google Gemini for screenshot extraction
- Cloudflare Workers for private schedule-share previews
- GitHub Pages and GitHub Actions

The frontend uses a hash router so routes work correctly under the GitHub Pages project path.

## Project structure

```text
src/pages/                         Routed pages
src/components/                    Reusable interface components
src/components/schedule/           Schedule editor and screenshot import UI
src/features/auth/                 Authentication and profile state
src/hooks/                         Shared React hooks
src/lib/                           Domain logic and Supabase calls
src/config/brand.ts                Site name, links, and logo settings
src/styles.css                     Global and responsive styling
supabase/migrations/               Database schema, RLS, indexes, and RPC migrations
supabase/functions/schedule-import Gemini screenshot importer
supabase/tests/database/           Database privacy and authorization tests
cloudflare/schedule-import-worker/ Schedule-share and legacy import Worker
docs/design/                       Design references
```

See [`AGENTS.md`](AGENTS.md) for concise instructions for coding agents and contributors.

## Local development

### Requirements

- Node.js 22 or newer
- pnpm 11.7.0
- Docker Desktop for the local Supabase stack

### Setup

```bash
pnpm install
cp .env.example .env.local
pnpm supabase:start
pnpm db:reset
pnpm dev
```

Add the local Supabase values printed by `pnpm supabase:start` to `.env.local`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your-local-public-key
VITE_SCHEDULE_SHARE_BASE_URL=http://127.0.0.1:8787
VITE_ENABLE_DEMO_MODE=false
```

Open:

```text
http://127.0.0.1:5173/NA-ScheduleShare/
```

Local seed accounts use the password `ScheduleShare123!`:

- `admin@scheduleshare.local`
- `jordan@scheduleshare.local`
- `alex@scheduleshare.local`

For UI-only development without Supabase, set `VITE_ENABLE_DEMO_MODE=true` and leave the Supabase variables blank. Demo mode must remain disabled in production.

## Screenshot importer

The importer accepts up to three PNG, JPEG, or WebP screenshots, no larger than 5 MB each, through file selection, drag-and-drop, or clipboard paste. Extracted classes are shown in an editable review screen before anything is saved.

The browser invokes the `schedule-import` Supabase Edge Function, which sends the images to Gemini and resolves the result against the approved course catalogue. It never creates course names. When the first reading is incomplete or conflicts, the function continues the same Gemini conversation once with the first result and asks it to correct the questionable rows. A clean first reading makes only one Gemini call. Images are processed in request memory and are not stored by ScheduleShare.

Set `GEMINI_API_KEY` as a Supabase Function secret and deploy with `supabase functions deploy schedule-import`. The function validates signed-in requests and rate-limits guest requests before processing images.

## Common commands

```bash
pnpm dev                 # Start the frontend
pnpm typecheck           # Check TypeScript
pnpm lint                # Run ESLint
pnpm test                # Run frontend tests
pnpm test:function       # Test Supabase Edge Functions
pnpm worker:typecheck    # Check Worker TypeScript
pnpm test:worker         # Run Worker tests
pnpm test:privacy        # Run local database privacy tests
pnpm build               # Create the production build
pnpm preview             # Preview the production build
pnpm db:reset            # Rebuild the local database
pnpm db:push             # Apply migrations to linked Supabase
pnpm types:generate      # Regenerate database TypeScript types
```

`pnpm test:privacy` requires the local Supabase stack to be running.

## Data and security model

The main schedule model separates:

- `classes`: shared class sections
- `class_meeting_slots`: a section's default A/B day and period rows
- `class_enrollments`: each student's membership and academic term
- `class_enrollment_meeting_slots`: the student's actual attendance pattern for that shared section
- `course_names.term_policy`: the authoritative full-year, half-credit, flexible, lunch, variable-credit, or versioned format

Full-year enrollments appear in both semesters. Semester enrollments appear only in their selected semester, and conflicts are evaluated independently for Semester 1 A, Semester 1 B, Semester 2 A, and Semester 2 B. Removing an enrollment does not delete the shared class.

Supabase Auth identifies the signed-in user. PostgreSQL RLS and narrowly granted RPC functions enforce privacy, permissions, suspension rules, and administrative access. Frontend route guards only control the interface and are not treated as security boundaries.

The browser receives only the public Supabase URL and publishable key. Service-role keys and other private credentials must never be placed in frontend code or `VITE_*` environment variables.

Never edit a migration that has already been applied to production. Add a new ordered migration instead.

## Deployment

The frontend deployment workflow is `.github/workflows/deploy.yml`.

Required GitHub Actions secrets:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

The schedule-share Worker origin is configured in the workflow. The Gemini API key belongs in Supabase Function secrets, never in a frontend or GitHub Pages `VITE_*` variable.

GitHub Pages must use **GitHub Actions** as its deployment source. Pushing to `main` runs the frontend validation and deployment workflow.

The share and legacy-import Worker uses the separate manual workflow at `.github/workflows/deploy-worker.yml`.

## Brand changes

- Edit `src/config/brand.ts` for names, links, attribution, or the configured logo path.
- Replace `public/na-club-logo.png` to update the main logo and icons.
- Edit the design tokens near the top of `src/styles.css` for colors and shared layout values.
