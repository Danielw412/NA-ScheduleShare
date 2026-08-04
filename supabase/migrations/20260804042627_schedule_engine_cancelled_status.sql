-- Keep cancellation as a first-class terminal state. This must be committed in
-- its own migration because PostgreSQL cannot safely use a newly-added enum
-- value elsewhere in the same transaction.
alter type public.schedule_engine_job_status
add value if not exists 'cancelled' after 'processing';
