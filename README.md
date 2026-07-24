# NA ScheduleShare

NA ScheduleShare is a student-built website for creating semester-aware A/B-day schedules, finding classmates, and securely sharing schedules. It was created by the **NA Computer and AI Club** and is not an official school website.

**Live site:** https://schedule.naclubs.net/

## Main features

### Schedule building

- Separate Semester 1 and Semester 2 views, each with A-day and B-day columns
- Support for full-year, semester, A-only, B-only, different-period A/B, variable-credit, and double-period schedules
- Search existing shared class sections or create a missing section from the approved course catalogue
- Student-specific attendance patterns, even when multiple students use the same shared class section
- Independent conflict checks for Semester 1 A, Semester 1 B, Semester 2 A, and Semester 2 B
- One-click schedule clearing with confirmation
- Responsive schedule editing and class-detail sheets that stay inside mobile safe areas

### Important Lunch and Study Hall behavior

Lunch and Study Hall use additional rules that are easy to miss:

- Lunch and Study Hall teachers are always stored as `N/A`. This is enforced in the interface and at the database boundary.
- Search results collapse duplicate Lunch or Study Hall variants into one result per period instead of exposing internal A-day, B-day, or semester variants.
- The period is inferred from the schedule cell the student opened, so the student does not choose it again.
- Semester Lunch is placed on both A and B days in that semester.
- Choosing **Full Year** Lunch creates matching Semester 1 and Semester 2 enrollments at the same period. It is intentionally stored as two semester-specific roster entries rather than one full-year roster entry.
- Study Hall attendance is inferred automatically. A semester Study Hall spans both A and B days; a full-year Study Hall can follow the selected A-day or B-day cell.
- The importer normalizes campus-specific Lunch and Study Hall names, such as NAI and NASH variants, using the student's grade when needed.

### AI screenshot importing

- Import one to three PNG, JPEG, or WebP PowerSchool screenshots, up to 10 MB each
- Add images through file selection, drag-and-drop, or clipboard paste
- Use the active Supabase `schedule-import` Edge Function and Google Gemini to extract classes, semesters, A/B days, periods, and teachers
- Resolve extracted names only against the approved course catalogue; the AI cannot create arbitrary course names
- Automatically apply a clean, conflict-free import and open an editable review when any row is unresolved, incomplete, ambiguous, duplicated, or conflicting
- Retry Gemini once in the same conversation when the first result leaves imported classes unresolved or incomplete, and report the retry only when it actually happened
- Replace the existing schedule atomically after validation so a failed import cannot leave a partially replaced schedule
- Keep uploaded images in request memory only; ScheduleShare does not store the screenshot files

Guests can use the importer before creating an account. A clean guest import becomes a local schedule preview, shows only an aggregate count of students who share classes, and remains in the browser during account creation. After onboarding, the draft is saved automatically when the new account does not already have a schedule.

### Students, privacy, and access requests

- A combined Students page for classmates and the full student directory
- Search by student name and filter by grade, course, or teacher
- Show shared class names for classmates without exposing schedules that the viewer cannot access
- Three schedule privacy settings:
  - **Anyone:** any signed-in student can view the schedule
  - **Classmates:** students sharing a class can view the full schedule
  - **Private:** only specifically approved students can view the full schedule, while shared-class status can still be shown
- Directly grant or remove another student's access
- Request access to a private schedule, cancel a pending request, and receive notifications when requests arrive or change status
- Database-enforced privacy for schedule pages, class rosters, directory results, and classmate discovery

### Sharing, profiles, and safety

- Create token-based schedule-share links with native mobile sharing support
- Serve bounded anonymous share pages and 1200 × 630 social preview images through Cloudflare
- Public share previews are available only when the owner's privacy setting permits public sharing; unavailable, private, suspended, disabled, and invalid links return the same generic response
- Disable caching on share responses so privacy changes take effect on the next request
- Sign in with Google or email and password, including email password recovery
- Edit the profile name and privacy setting, upload or remove a profile picture, sign out, or permanently delete the account
- Report suspicious users, inappropriate names, incorrect class information, duplicate classes, or other issues

### Administration

The protected admin dashboard supports:

- User search, grade corrections, suspension, restoration, profile-picture removal, and account deletion
- Report review, assignment, resolution, and dismissal
- Shared class-section editing, archiving, merging, and deletion with conflict protection
- Course catalogue management
- Homepage statistic controls
- Gemini importer model, thinking-level, output-limit, progress-duration, and diagnostic controls
- Administrator role management
- Super-admin-only event logs, activity summaries, diagnostic cleanup, and protected site-reset tools

Security, audit, import, and admin events are stored through protected database functions. Browser-supplied user IDs or roles are never treated as authority.

## Technology

- React 19
- TypeScript 6
- Vite 8
- React Router with a hash router for GitHub Pages compatibility
- Supabase Auth and PostgreSQL
- PostgreSQL Row Level Security and narrowly granted RPC functions
- Supabase Edge Functions and Google Gemini for the active screenshot importer
- Cloudflare Workers and `resvg` for secure share pages, social preview PNGs, and the legacy import endpoint
- GitHub Pages and GitHub Actions

## Project structure

```text
src/pages/                         Routed pages
src/components/                    Reusable interface components
src/components/schedule/           Schedule editor and screenshot import UI
src/components/layout/             Navigation and access-request notifications
src/features/auth/                 Authentication, recovery, profile, and account state
src/hooks/                         Shared React hooks
src/lib/                           Domain logic and Supabase calls
src/config/brand.ts                Site name, links, production URL, and logo settings
src/styles.css                     Global and responsive styling
src/mobile-layout-fixes.css        Targeted mobile viewport and safe-area fixes
supabase/migrations/               Database schema, RLS, indexes, RPCs, and policy changes
supabase/functions/schedule-import Active Gemini screenshot importer
supabase/functions/delete-account  Auth and account deletion function
supabase/functions/site-reset      Protected super-admin reset function
supabase/tests/database/           Database privacy and authorization tests
cloudflare/schedule-import-worker/ Share Worker and legacy Cloudflare-AI importer
docs/                              Deployment and design references
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

Start `pnpm worker:dev` when testing schedule-share pages or images locally. The website's active screenshot importer does not use the Worker; it invokes the Supabase Edge Function.

## Screenshot importer deployment

Set `GEMINI_API_KEY` as a Supabase Function secret and deploy the active importer with:

```bash
supabase functions deploy schedule-import
```

The Edge Function validates requests, rate-limits guest use, sends images to Gemini, checks the structured response, and resolves it against the approved catalogue. New importer behavior belongs in `supabase/functions/schedule-import/`, not in the legacy Cloudflare importer.

## Common commands

```bash
pnpm dev                 # Start the frontend
pnpm typecheck           # Check TypeScript
pnpm lint                # Run ESLint
pnpm test                # Run frontend tests
pnpm test:function       # Test Supabase Edge Functions
pnpm worker:typecheck    # Check Worker TypeScript
pnpm test:worker         # Run Worker tests
pnpm worker:dev          # Run the share Worker locally
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
- `class_meeting_slots`: a section's default A/B-day and period rows
- `class_enrollments`: each student's membership and academic term
- `class_enrollment_meeting_slots`: the student's actual attendance pattern for that shared section
- `course_names.term_policy`: the authoritative full-year, semester, flexible-attendance, lunch, variable-credit, or versioned format

Full-year enrollments appear in both semester views. Semester enrollments appear only in their selected semester. Full-year Lunch is the intentional exception at the roster layer: one user choice expands into separate Semester 1 and Semester 2 enrollments.

Removing a student's enrollment does not delete the shared class. Editing or deleting a shared class is an administrative operation because it can affect every enrolled student.

Supabase Auth identifies the signed-in user. PostgreSQL RLS and security-definer RPC functions enforce privacy, permissions, suspension rules, special-course normalization, schedule conflicts, and administrative access. Frontend route guards control the interface but are not security boundaries.

The browser receives only the public Supabase URL and publishable key. Service-role keys, Gemini keys, OAuth secrets, and other private credentials must never be placed in frontend code or `VITE_*` environment variables.

Never edit a migration that has already been applied to production. Add a new ordered migration instead.

## Deployment

The frontend workflow is `.github/workflows/deploy.yml`. Pull requests run type checking, Worker type checking, linting, frontend tests, Edge Function tests, Worker tests, and a production build. Pushing to `main` runs the same validation and deploys GitHub Pages.

Required GitHub Actions secrets:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

The production share origin is configured as `https://schedule-api.naclubs.net`. The Gemini API key belongs in Supabase Function secrets, never in a frontend or GitHub Pages variable.

GitHub Pages must use **GitHub Actions** as its deployment source. The Cloudflare share and legacy-import Worker uses the separate manually triggered workflow at `.github/workflows/deploy-worker.yml`.

## Brand changes

- Edit `src/config/brand.ts` for names, links, attribution, production URL, or the configured logo path.
- Replace `public/na-club-logo.png` to update the main logo and icons.
- Edit the design tokens near the top of `src/styles.css` for colors and shared layout values.
