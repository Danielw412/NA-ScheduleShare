# NA ScheduleShare

NA ScheduleShare is a student-built website for creating A/B-day schedules, finding classmates, and comparing schedules with friends. It was created by the **NA Computer and AI Club** and is not an official school website.

**Live site:** https://danielw412.github.io/NA-ScheduleShare/

## Main features

- Build an A/B-day class schedule with full-year and semester terms
- Support normal and double-period classes
- Import one or two PowerSchool schedule screenshots with AI-assisted review
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
- Cloudflare Workers AI for screenshot extraction
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
supabase/migrations/               Database schema, RLS, and RPC migrations
supabase/tests/database/           Database privacy and authorization tests
cloudflare/schedule-import-worker/ Screenshot extraction Worker
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
VITE_SCHEDULE_IMPORT_API_URL=http://127.0.0.1:8787
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

The importer accepts up to two PNG, JPEG, or WebP screenshots through file selection, drag-and-drop, or clipboard paste. Extracted classes are shown in an editable review screen before anything is saved.

The importer may create a new class section, but it must match an existing course in the approved course catalogue. It does not create new course names. Images are processed by the Cloudflare Worker and are not stored in Supabase or persistent Worker storage.

See [`cloudflare/schedule-import-worker/README.md`](cloudflare/schedule-import-worker/README.md) for local Worker setup, KV configuration, secrets, and deployment.

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
- `class_meeting_slots`: explicit A/B day and period rows
- `class_enrollments`: each student's membership and academic term

Removing an enrollment does not delete the shared class.

Supabase Auth identifies the signed-in user. PostgreSQL RLS and narrowly granted RPC functions enforce privacy, permissions, suspension rules, and administrative access. Frontend route guards only control the interface and are not treated as security boundaries.

The browser receives only the public Supabase URL and publishable key. Service-role keys and other private credentials must never be placed in frontend code or `VITE_*` environment variables.

Never edit a migration that has already been applied to production. Add a new ordered migration instead.

## Deployment

The frontend deployment workflow is `.github/workflows/deploy.yml`.

Required GitHub Actions secrets:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SCHEDULE_IMPORT_API_URL
```

GitHub Pages must use **GitHub Actions** as its deployment source. Pushing to `main` runs the frontend validation and deployment workflow.

The screenshot Worker uses the separate manual workflow at `.github/workflows/deploy-worker.yml`. Deploy and configure the Worker before setting its URL for the frontend build.

## Brand changes

- Edit `src/config/brand.ts` for names, links, attribution, or the configured logo path.
- Replace `public/na-club-logo.png` to update the main logo and icons.
- Edit the design tokens near the top of `src/styles.css` for colors and shared layout values.