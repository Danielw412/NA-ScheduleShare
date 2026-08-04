# Schedule Engine laptop worker

This worker claims Schedule Engine jobs from Supabase, builds a typed prediction input, calls the isolated prediction-engine boundary, and writes completed or failed status back to the queue.

The real prediction engine is intentionally not implemented. By default, processing a job marks it failed with a clear not-implemented error. A one-result placeholder can be enabled only against local Supabase (`localhost` or `127.0.0.1`) for development and tests; hosted projects never receive placeholder results.

## Setup

1. Copy `.env.example` to `.env` in this folder, or export the same values in your shell. The package scripts load that uncommitted file when it exists.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never use a `VITE_*` name for the service-role key and never commit it.
3. Optionally set a stable `SCHEDULE_ENGINE_WORKER_ID` for this laptop.
4. Copy the SMTP settings already used by Supabase Auth into `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. Supabase does not expose those saved secrets to this program.
5. Open the web control panel with `pnpm schedule-engine:gui`, then visit `http://127.0.0.1:4174`. It shows queue details, worker state, errors, raw debug data, and buttons to process one job or the full queue.

The command-line alternatives remain `pnpm schedule-engine:one` for one job and `pnpm schedule-engine:queue` for the full queue.

For local-only placeholder output, use the local Supabase URL and set `SCHEDULE_ENGINE_ENABLE_PLACEHOLDER=true` with a non-production `NODE_ENV`. Placeholder predictions are labeled in storage and hidden by production frontend builds.

The future engine entrypoint is `src/prediction-engine.ts`. SMTP delivery is isolated in `src/notifier.ts`; notification failure is recorded without changing a successfully completed prediction job to failed.
