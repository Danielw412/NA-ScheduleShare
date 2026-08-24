begin;
select plan(29);

select ok(
  has_function_privilege('anon', 'public.get_guest_bell_schedule_window(date,integer,text)', 'execute'),
  'anonymous visitors can execute the bounded public bell-window RPC'
);
select ok(
  not has_function_privilege('anon', 'private.get_bell_schedule_window(date,integer,text)', 'execute'),
  'anonymous visitors cannot bypass the shaped public bell-window wrapper'
);

select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select is(
  jsonb_array_length(public.get_guest_bell_schedule_window('2026-08-24', 21, 'NASH')),
  21,
  'the guest bell window returns the requested bounded number of days'
);
select is(
  public.get_guest_bell_schedule_window('2026-08-24', 1, 'NASH') -> 0 ->> 'campus',
  'NASH',
  'the guest bell window uses only the requested validated campus'
);
select is(
  public.get_guest_bell_schedule_window('2026-08-24', 1, 'NASH') -> 0 -> 'schedule' ->> 'schedule_key',
  'regular',
  'an anonymous visitor receives the real default bell schedule'
);
select throws_ok(
  $$select public.get_guest_bell_schedule_window('2026-08-24', 22, 'NASH')$$,
  '22023', 'bell_schedule_window_out_of_bounds',
  'guest bell windows are capped at 21 days'
);
select throws_ok(
  $$select public.get_guest_bell_schedule_window('2026-08-24', 1, 'OTHER')$$,
  '22023', 'invalid_bell_schedule_campus',
  'guest bell windows reject unknown campuses'
);

reset role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'b9000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'bell-student@test.local', '', now(), '{}', '{"full_name":"Bell Student"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b9000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'bell-admin@test.local', '', now(), '{}', '{"full_name":"Bell Admin"}', now(), now(), '', '', '', '', '');

update public.profiles set grade = 9, onboarding_completed = true where id = 'b9000000-0000-4000-8000-000000000001';
update public.profiles set grade = 11, onboarding_completed = true where id = 'b9000000-0000-4000-8000-000000000002';
insert into private.user_roles (user_id, role, granted_by)
values ('b9000000-0000-4000-8000-000000000002', 'administrator', 'b9000000-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  jsonb_array_length(public.get_my_bell_schedule_window('2026-08-24', 21)),
  21,
  'the student bell window returns the requested bounded number of days'
);
select is(
  public.get_my_bell_schedule_window('2026-08-24', 1) -> 0 ->> 'campus',
  'NAI',
  'grades 9 and 10 resolve to NAI on the server'
);
select is(
  public.get_my_bell_schedule_window('2026-08-24', 1) -> 0 -> 'schedule' ->> 'schedule_key',
  'regular',
  'an unassigned weekday resolves to the Regular schedule'
);
select throws_ok(
  $$select public.get_my_bell_schedule_window('2026-08-24', 22)$$,
  '22023', 'bell_schedule_window_out_of_bounds',
  'student bell windows are capped at 21 days'
);
select throws_ok(
  $$select count(*) from private.bell_schedule_definitions$$,
  '42501', 'permission denied for table bell_schedule_definitions',
  'students cannot query private bell definitions directly'
);
select throws_ok(
  $$select public.admin_list_bell_schedules()$$,
  '42501', 'administrator_access_required',
  'students cannot invoke bell-schedule admin RPCs'
);

reset role;
select set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(jsonb_array_length(public.admin_list_bell_schedules()), 10, 'all ten built-in schedules are seeded');
select is(
  (public.admin_list_bell_schedules() -> 0 -> 'blocks') is not null,
  true,
  'admin schedule results include ordered blocks'
);
select ok(
  (public.admin_get_bell_schedule_settings() ? 'newsletter_document_url')
    and not (public.admin_get_bell_schedule_settings() ? 'bell_schedule_document_url'),
  'admin detector settings expose only the newsletter Google Doc'
);
select throws_ok(
  $$select public.admin_save_bell_schedule('{"schedule_key":"overlap_test","display_name":"Overlap Test","campus_scope":"BOTH","warning_time":"07:24","blocks":[{"label":"Period 1","period_number":1,"start_time":"07:28","end_time":"08:08"},{"label":"Period 2","period_number":2,"start_time":"08:00","end_time":"08:40"}]}'::jsonb)$$,
  '23514', 'bell_schedule_blocks_overlap',
  'overlapping blocks are rejected transactionally'
);

create temporary table bell_test_schedule as
select public.admin_save_bell_schedule(
  '{"schedule_key":"custom_test","display_name":"Custom Test","campus_scope":"BOTH","warning_time":"08:00","blocks":[{"label":"Period 1","period_number":1,"start_time":"08:05","end_time":"08:45"},{"label":"Assembly","period_number":null,"start_time":"08:45","end_time":"09:00"}]}'::jsonb
) as id;
grant select on bell_test_schedule to authenticated, service_role;

select is(
  (select count(*) from jsonb_array_elements(public.admin_list_bell_schedules()) item where item ->> 'schedule_key' = 'custom_test'),
  1::bigint,
  'administrators can create a custom schedule'
);
select is(
  public.admin_bulk_assign_school_days(
    array['2026-08-24'::date], array['NAI', 'NASH'], 'A', false,
    (select id from bell_test_schedule)
  ),
  2,
  'bulk assignment targets both campuses atomically'
);
select is(
  (public.admin_list_school_days('2026-08-24', 1) -> 0 ->> 'manual_locked')::boolean,
  true,
  'manual date assignments are locked against automation'
);

reset role;
select set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.get_my_bell_schedule_window('2026-08-24', 1) -> 0 -> 'schedule' ->> 'schedule_key',
  'custom_test',
  'the student RPC resolves the campus-specific date override'
);

reset role;
set local role service_role;
create temporary table bell_sync_claim as
select public.service_claim_bell_schedule_sync(
  'b9000000-0000-4000-8000-000000000002', 'manual', false
) as payload;
grant select on bell_sync_claim to service_role;
select ok(
  (select (payload ? 'newsletter_document_url') and not (payload ? 'bell_schedule_document_url') from bell_sync_claim),
  'service sync claims include only the newsletter Google Doc'
);
select lives_ok(
  $$select public.service_finish_bell_schedule_sync(
    (select (payload ->> 'run_id')::uuid from bell_sync_claim),
    'succeeded', 'source-hash-one', 'Monday Regular Bell Schedule',
    '[]'::jsonb,
    '[{"date":"2026-08-24","day_type":"B","no_school":false,"schedule_key":"regular","campus":"NAI","evidence":"Monday Regular Bell Schedule"}]'::jsonb,
    null, 100
  )$$,
  'a service sync can finish without overwriting a manual lock'
);

reset role;
select set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  public.admin_list_school_days('2026-08-24', 1) -> 0 ->> 'source',
  'manual',
  'AI application preserves the existing manual source'
);
select is(
  public.admin_list_bell_schedule_sync_runs(1) -> 0 -> 'skipped_dates' -> 0 ->> 'reason',
  'manual_override',
  'preserved manual overrides appear in the run history'
);

reset role;
set local role service_role;
create temporary table bell_sync_claim_two as
select public.service_claim_bell_schedule_sync(
  'b9000000-0000-4000-8000-000000000002', 'manual', false
) as payload;
grant select on bell_sync_claim_two to service_role;
select is(
  public.service_finish_bell_schedule_sync(
    (select (payload ->> 'run_id')::uuid from bell_sync_claim_two),
    'succeeded', 'source-hash-one', 'Monday Regular Bell Schedule',
    '[]'::jsonb, '[]'::jsonb, null, 50
  ) ->> 'status',
  'skipped',
  'unchanged successful source sections are idempotent'
);

reset role;
select set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(public.admin_unlock_school_day_overrides(array['2026-08-24'::date], array['NAI']), 1, 'administrators can unlock a manual override for AI management');
select is(
  public.admin_list_school_days('2026-08-24', 1) -> 0 ->> 'source',
  'manual',
  'unlocking preserves manual provenance until an AI run actually replaces the row'
);
select is(public.admin_clear_school_day_overrides(array['2026-08-24'::date], array['NAI', 'NASH']), 2, 'administrators can clear selected date overrides');

select * from finish();
rollback;
