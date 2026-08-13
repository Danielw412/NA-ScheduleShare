-- Serialize Schedule Engine applies before the private implementation inserts
-- FK-backed rate-limit rows. The public wrapper is the only browser-facing entry
-- point, so a transaction-scoped advisory lock prevents concurrent applies for
-- the same user from reaching the lock-upgrade pattern that caused deadlocks.
--
-- The private implementation historically raises schedule_engine_prediction_stale
-- with SQLSTATE 40001. That code means serialization_failure and can invite retries,
-- even though a stale prediction can never become valid by retrying it. Translate
-- only that known application error to P0001 while preserving real 40001 failures.

create or replace function public.apply_schedule_engine_prediction(
  p_job_id uuid,
  p_rank smallint
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      1935764584,
      pg_catalog.hashtext(actor_id::text)
    );
  end if;

  begin
    return private.apply_schedule_engine_prediction(p_job_id, p_rank);
  exception
    when serialization_failure then
      if sqlerrm = 'schedule_engine_prediction_stale' then
        raise exception 'schedule_engine_prediction_stale' using errcode = 'P0001';
      end if;
      raise;
  end;
end;
$$;
