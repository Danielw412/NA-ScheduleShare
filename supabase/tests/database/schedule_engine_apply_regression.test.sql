begin;
select plan(3);

select ok(
  pg_get_functiondef('public.apply_schedule_engine_prediction(uuid,smallint)'::regprocedure)
    like '%pg_advisory_xact_lock%hashtext(actor_id::text)%',
  'Schedule Engine apply serializes concurrent requests for the same user before entering the private implementation'
);

select ok(
  pg_get_functiondef('public.apply_schedule_engine_prediction(uuid,smallint)'::regprocedure)
    like '%when serialization_failure%sqlerrm = ''schedule_engine_prediction_stale''%errcode = ''P0001''%',
  'the public apply wrapper translates the known stale-prediction serialization code to a non-retryable application error'
);

select ok(
  pg_get_functiondef('public.apply_schedule_engine_prediction(uuid,smallint)'::regprocedure)
    like '%if sqlerrm = ''schedule_engine_prediction_stale''%end if;%raise;%',
  'real serialization failures are re-raised instead of being mislabeled as stale predictions'
);

select * from finish();
rollback;
