begin;
select plan(2);

select ok(
  position(
    'for update' in lower(pg_get_functiondef('private.apply_schedule_engine_prediction(uuid,smallint)'::regprocedure))
  ) < position(
    'consume_rate_limit' in lower(pg_get_functiondef('private.apply_schedule_engine_prediction(uuid,smallint)'::regprocedure))
  ),
  'Schedule Engine apply locks the profile before inserting a rate-limit event'
);

select ok(
  pg_get_functiondef('private.apply_schedule_engine_prediction(uuid,smallint)'::regprocedure)
    like '%schedule_engine_prediction_stale%errcode = ''P0001''%'
  and pg_get_functiondef('private.apply_schedule_engine_prediction(uuid,smallint)'::regprocedure)
    not like '%schedule_engine_prediction_stale%errcode = ''40001''%',
  'stale predictions use a non-retryable application SQLSTATE instead of serialization_failure'
);

select * from finish();
rollback;
