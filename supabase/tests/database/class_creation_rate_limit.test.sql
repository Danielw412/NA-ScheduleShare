begin;
select plan(2);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current,
  email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '99000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'class-rate@test.local', '', now(), '{}',
  '{"full_name":"Class Rate Test"}', now(), now(), '', '', '', '', ''
);

insert into private.rate_limit_events (user_id, action_key, created_at)
select '99000000-0000-4000-8000-000000000001', 'class_create', now()
from generate_series(1, 8);

select lives_ok(
  $$select private.consume_rate_limit(
    '99000000-0000-4000-8000-000000000001', 'class_create', 8, interval '1 hour'
  )$$,
  'building a normal full schedule is no longer blocked after eight new sections'
);

insert into private.rate_limit_events (user_id, action_key, created_at)
select '99000000-0000-4000-8000-000000000001', 'class_create', now()
from generate_series(1, 21);

select throws_ok(
  $$select private.consume_rate_limit(
    '99000000-0000-4000-8000-000000000001', 'class_create', 8, interval '1 hour'
  )$$,
  'P0001', 'rate_limit_exceeded',
  'the expanded class creation throttle still prevents abuse at thirty per hour'
);

select * from finish();
rollback;
