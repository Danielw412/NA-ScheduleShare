# Schedule Engine laptop worker

This worker claims Schedule Engine jobs from Supabase, builds a typed prediction input, calls the isolated prediction-engine boundary, and writes completed or failed status back to the queue.

The real prediction engine is intentionally not implemented. By default, processing a job marks it failed with a clear not-implemented error. A one-result placeholder can be enabled only against local Supabase (`localhost` or `127.0.0.1`) for development and tests; hosted projects never receive placeholder results.

## Setup

1. Copy `.env.example` to `.env` in this folder, or export the same values in your shell. The package scripts load that uncommitted file when it exists.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never use a `VITE_*` name for the service-role key and never commit it.
3. Optionally set a stable `SCHEDULE_ENGINE_WORKER_ID` for this laptop.
4. Build and process one job with `pnpm schedule-engine:one`, or drain the queue with `pnpm schedule-engine:queue`.

For local-only placeholder output, use the local Supabase URL and set `SCHEDULE_ENGINE_ENABLE_PLACEHOLDER=true` with a non-production `NODE_ENV`. Placeholder predictions are labeled in storage and hidden by production frontend builds.

The future engine entrypoint is `src/prediction-engine.ts`. Transactional email is not configured in this repository; `src/notifier.ts` is the clean integration point and leaves requested notifications pending until a sender is added.
