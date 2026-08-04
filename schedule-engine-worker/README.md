# Schedule Engine laptop worker

This worker claims Schedule Engine jobs from Supabase, builds a typed prediction input, searches existing sections for up to three valid schedules, and writes the ranked outcome back to the queue.

The engine never creates a section or meeting pattern. It tries direct replacements first, then one collateral course move, then displacement chains in order of the fewest unrelated courses changed. The normal displacement limit is five courses.

## Setup

1. Copy `.env.example` to `.env` in this folder, or export the same values in your shell. The package scripts load that uncommitted file when it exists.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never use a `VITE_*` name for the service-role key and never commit it.
3. Optionally set a stable `SCHEDULE_ENGINE_WORKER_ID` for this laptop.
4. Optionally set `SCHEDULE_ENGINE_MAX_COLLATERAL_CHANGES`. It defaults to `5` and accepts `0` through `20`; increasing it permits a deeper rearrangement search.
5. Copy the SMTP settings already used by Supabase Auth into `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. Supabase does not expose those saved secrets to this program.
6. Open the web control panel with `pnpm schedule-engine:gui`, then visit `http://127.0.0.1:4174`. It shows queue details, worker state, configured search depth, errors, raw debug data, and buttons to process one job or the full queue.

The command-line alternatives remain `pnpm schedule-engine:one` for one job and `pnpm schedule-engine:queue` for the full queue.

The engine entrypoint is `src/prediction-engine.ts`. SMTP delivery is isolated in `src/notifier.ts`; notification failure is recorded without changing a successfully completed prediction job to failed. A request with no legal result is completed with a user-facing explanation and no fake schedule.
