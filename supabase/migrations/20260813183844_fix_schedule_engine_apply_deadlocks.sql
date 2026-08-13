-- Serialize Schedule Engine apply RPCs per user before entering the existing
-- private implementation, preventing concurrent same-user applies from reaching
-- the rate-limit/profile lock-upgrade deadlock. Translate only the known stale
-- prediction serialization error to a non-retryable application SQLSTATE.

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
    perform pg_catalog.pg_advisory_xact_lock(1935764584, pg_catalog.hashtext(actor_id::text));
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
