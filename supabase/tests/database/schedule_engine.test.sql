begin;
select plan(46);

select ok(
  has_function_privilege('authenticated', 'public.create_schedule_engine_job(jsonb,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.create_schedule_engine_job(jsonb,boolean)', 'execute'),
  'only authenticated users can submit Schedule Engine requests'
);

select ok(
  has_function_privilege('authenticated', 'public.list_my_schedule_engine_jobs(integer)', 'execute')
  and has_function_privilege('authenticated', 'public.cancel_my_schedule_engine_job(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cancel_my_schedule_engine_job(uuid)', 'execute'),
  'signed-in users can list and cancel only through protected RPCs'
);

select ok(
  (
    select bool_and(
      has_function_privilege('service_role', function_name, 'execute')
      and not has_function_privilege('authenticated', function_name, 'execute')
      and not has_function_privilege('anon', function_name, 'execute')
    )
    from (values
      ('public.claim_next_schedule_engine_job(text)'),
      ('public.get_schedule_engine_worker_input(uuid,text)'),
      ('public.heartbeat_schedule_engine_job(uuid,text)'),
      ('public.complete_schedule_engine_job(uuid,text,jsonb)'),
      ('public.fail_schedule_engine_job(uuid,text,text)'),
      ('public.record_schedule_engine_notification(uuid,text,boolean,text)'),
      ('public.list_schedule_engine_jobs_for_worker(integer)')
    ) protected(function_name)
  ),
  'worker RPCs are service-role only'
);

select ok(
  has_table_privilege('authenticated', 'public.schedule_engine_jobs', 'select')
  and not has_table_privilege('authenticated', 'public.schedule_engine_jobs', 'insert,update,delete')
  and has_table_privilege('authenticated', 'public.schedule_engine_results', 'select')
  and not has_table_privilege('authenticated', 'public.schedule_engine_results', 'insert,update,delete'),
  'browser clients can read but cannot mutate queue or result tables'
);

select ok(
  (
    select bool_and(relation.relrowsecurity)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('schedule_engine_jobs', 'schedule_engine_replacements', 'schedule_engine_results')
  ),
  'all Schedule Engine public tables have RLS enabled'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current,
  email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'engine-owner@test.local', '', now(), '{}', '{"full_name":"Engine Owner"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'engine-other@test.local', '', now(), '{}', '{"full_name":"Engine Other"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11, onboarding_completed = true
where id in ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000002');

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
select '98100000-0000-4000-8000-000000000001', id, 'Carter', 'full_year', false, '98000000-0000-4000-8000-000000000001'
from public.course_names where normalized_name = 'ap language';

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
select '98100000-0000-4000-8000-000000000002', id, 'Patel', 'full_year', false, '98000000-0000-4000-8000-000000000001'
from public.course_names where normalized_name = 'algebra 1';

insert into public.class_meeting_slots (class_id, day_type, period_number) values
  ('98100000-0000-4000-8000-000000000001', 'A', 1),
  ('98100000-0000-4000-8000-000000000001', 'B', 1),
  ('98100000-0000-4000-8000-000000000002', 'A', 2),
  ('98100000-0000-4000-8000-000000000002', 'B', 2);

insert into public.class_enrollments (id, student_id, class_id, academic_term, active) values
  ('98200000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000001', 'full_year', true),
  ('98200000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000002', 'full_year', true);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.create_schedule_engine_job(
    jsonb_build_array(jsonb_build_object(
      'enrollment_id', '98200000-0000-4000-8000-000000000001',
      'replacement_course_id', (select id from public.course_names where normalized_name = 'ap literature')
    )),
    false
  )$$,
  'an owner can submit one valid replacement'
);

select is(
  (select count(*) from public.schedule_engine_jobs),
  1::bigint,
  'the owner sees their queued job through RLS'
);

select is(
  (select notification_status::text from public.schedule_engine_jobs limit 1),
  'not_requested',
  'the email preference initializes notification state'
);

select is(
  (
    select count(*)
    from public.schedule_engine_replacements replacement
    where replacement.enrollment_id = '98200000-0000-4000-8000-000000000001'
      and replacement.replacement_course_name_id = (select id from public.course_names where normalized_name = 'ap literature')
  ),
  1::bigint,
  'the request stores enrollment and catalog course IDs'
);

select throws_ok(
  $$select public.create_schedule_engine_job(
    jsonb_build_array(jsonb_build_object(
      'enrollment_id', '98200000-0000-4000-8000-000000000001',
      'replacement_course_id', (select id from public.course_names where normalized_name = 'ap language')
    )), true
  )$$,
  '23514', 'schedule_engine_same_course_replacement',
  'same-course replacements are rejected'
);

select throws_ok(
  $$select public.create_schedule_engine_job(
    jsonb_build_array(
      jsonb_build_object('enrollment_id', '98200000-0000-4000-8000-000000000001', 'replacement_course_id', (select id from public.course_names where normalized_name = 'ap literature')),
      jsonb_build_object('enrollment_id', '98200000-0000-4000-8000-000000000001', 'replacement_course_id', (select id from public.course_names where normalized_name = 'algebra 1'))
    ), true
  )$$,
  '23505', 'schedule_engine_duplicate_enrollment',
  'duplicate source enrollments are rejected'
);

select throws_ok(
  $$select public.create_schedule_engine_job(
    jsonb_build_array(
      jsonb_build_object('enrollment_id', '98200000-0000-4000-8000-000000000001', 'replacement_course_id', (select id from public.course_names where normalized_name = 'ap literature')),
      jsonb_build_object('enrollment_id', '98200000-0000-4000-8000-000000000002', 'replacement_course_id', (select id from public.course_names where normalized_name = 'ap literature'))
    ), true
  )$$,
  '23505', 'schedule_engine_duplicate_replacement_course',
  'duplicate replacement courses are rejected'
);

select throws_ok(
  $$select public.create_schedule_engine_job('[]'::jsonb, true)$$,
  '23514', 'schedule_engine_replacement_count_invalid',
  'empty requests are rejected'
);

select throws_ok(
  $$select public.create_schedule_engine_job(
    jsonb_build_array(
      jsonb_build_object('enrollment_id', gen_random_uuid(), 'replacement_course_id', gen_random_uuid()),
      jsonb_build_object('enrollment_id', gen_random_uuid(), 'replacement_course_id', gen_random_uuid()),
      jsonb_build_object('enrollment_id', gen_random_uuid(), 'replacement_course_id', gen_random_uuid())
    ), true
  )$$,
  '23514', 'schedule_engine_replacement_count_invalid',
  'requests with more than two replacements are rejected'
);

select throws_ok(
  $$insert into public.schedule_engine_results (job_id, rank, prediction)
    select id, 1, '{"schedule":[]}'::jsonb from public.schedule_engine_jobs limit 1$$,
  '42501', 'permission denied for table schedule_engine_results',
  'users cannot create prediction results'
);

select throws_ok(
  $$update public.schedule_engine_jobs set status = 'completed'$$,
  '42501', 'permission denied for table schedule_engine_jobs',
  'users cannot change job status or worker fields'
);

reset role;
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is((select count(*) from public.schedule_engine_jobs), 0::bigint, 'another user cannot view the owner job');

select throws_ok(
  $$select public.create_schedule_engine_job(
    jsonb_build_array(jsonb_build_object(
      'enrollment_id', '98200000-0000-4000-8000-000000000001',
      'replacement_course_id', (select id from public.course_names where normalized_name = 'ap literature')
    )), true
  )$$,
  '42501', 'schedule_engine_enrollment_not_owned',
  'a user cannot submit another user enrollment'
);

reset role;
select set_config('test.expected_engine_job', (select id::text from public.schedule_engine_jobs where status = 'queued' order by created_at, id limit 1), true);
set local role service_role;

select is(
  (select job_id::text from public.claim_next_schedule_engine_job('worker-one')),
  current_setting('test.expected_engine_job'),
  'the worker atomically claims the oldest queued job'
);

select is(
  (select count(*) from public.claim_next_schedule_engine_job('worker-two')),
  0::bigint,
  'a second worker cannot claim the processing job'
);

select is(
  jsonb_array_length(public.get_schedule_engine_worker_input(current_setting('test.expected_engine_job')::uuid, 'worker-one') -> 'current_schedule'),
  2,
  'worker input includes the complete active current schedule'
);

select is(
  jsonb_array_length(public.get_schedule_engine_worker_input(current_setting('test.expected_engine_job')::uuid, 'worker-one') -> 'replacements'),
  1,
  'worker input includes every requested replacement'
);

select is(
  public.get_schedule_engine_worker_input(current_setting('test.expected_engine_job')::uuid, 'worker-one') -> 'replacements' -> 0 -> 'current_course' ->> 'enrollment_id',
  '98200000-0000-4000-8000-000000000001',
  'worker replacement input identifies the current enrollment'
);

select is(
  jsonb_typeof(public.get_schedule_engine_worker_input(current_setting('test.expected_engine_job')::uuid, 'worker-one') -> 'replacements' -> 0 -> 'current_course' -> 'is_double_period'),
  'boolean',
  'worker replacement input includes typed double-period context'
);

select ok(
  jsonb_typeof(public.get_schedule_engine_worker_input(current_setting('test.expected_engine_job')::uuid, 'worker-one') -> 'replacement_course_sections') = 'array',
  'worker input includes relevant existing catalog section context'
);

select throws_ok(
  $$select public.complete_schedule_engine_job(
    current_setting('test.expected_engine_job')::uuid,
    'worker-two',
    '[{"schedule":[{"enrollment_id":"prediction-1"}]}]'::jsonb
  )$$,
  '42501', 'schedule_engine_job_not_claimed_by_worker',
  'a different worker cannot complete the claimed job'
);

select lives_ok(
  $$select public.complete_schedule_engine_job(
    current_setting('test.expected_engine_job')::uuid,
    'worker-one',
    '[{"schedule":[{"enrollment_id":"prediction-1","class_id":"predicted-class","course_id":"predicted-course","course_name":"AP Literature","teacher_last_name":"TBD","academic_term":"full_year","meeting_slots":[{"day_type":"A","period_number":1}]}]}]'::jsonb
  )$$,
  'the claiming worker can save ranked results and complete the job'
);

reset role;

select is(
  (select count(*) from public.schedule_engine_results where job_id = current_setting('test.expected_engine_job')::uuid and rank = 1),
  1::bigint,
  'the completed job stores its ranked prediction'
);

select is(
  (select status::text from public.schedule_engine_jobs where id = current_setting('test.expected_engine_job')::uuid),
  'completed',
  'completion updates the protected job status'
);

reset role;
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  public.get_my_latest_schedule_engine_job() ->> 'status',
  'completed',
  'the owner can read the completed status on the same page'
);

select is(
  jsonb_array_length(public.get_my_latest_schedule_engine_job() -> 'results'),
  1,
  'the owner can read completed prediction results'
);

select lives_ok(
  $$do $block$
  begin
    for request_number in 1..5 loop
      perform public.create_schedule_engine_job(
        jsonb_build_array(jsonb_build_object(
          'enrollment_id', '98200000-0000-4000-8000-000000000001',
          'replacement_course_id', (select id from public.course_names where normalized_name = 'ap literature')
        )), true
      );
    end loop;
  end
  $block$;$$,
  'an owner can keep up to five active requests in the queue'
);

select throws_ok(
  $$select public.create_schedule_engine_job(
    jsonb_build_array(jsonb_build_object(
      'enrollment_id', '98200000-0000-4000-8000-000000000001',
      'replacement_course_id', (select id from public.course_names where normalized_name = 'ap literature')
    )), true
  )$$,
  '23514', 'schedule_engine_too_many_active_jobs',
  'a sixth active request is rejected'
);

select is(jsonb_array_length(public.list_my_schedule_engine_jobs()), 6, 'the owner can inspect completed and queued request details');

select set_config('test.cancel_engine_job', (
  select id::text from public.schedule_engine_jobs where status = 'queued' order by created_at desc, id desc limit 1
), true);

select lives_ok(
  $$select public.cancel_my_schedule_engine_job(current_setting('test.cancel_engine_job')::uuid)$$,
  'the owner can cancel their queued request'
);

select is(
  (select status::text from public.schedule_engine_jobs where id = current_setting('test.cancel_engine_job')::uuid),
  'cancelled',
  'cancellation records a terminal cancelled status'
);

select is(
  (select count(*) from public.schedule_engine_jobs where status in ('queued', 'processing')),
  4::bigint,
  'a cancelled request frees one active request slot'
);

reset role;
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select is(public.get_my_latest_schedule_engine_job(), null, 'a user with no jobs receives no other user data');
select is((select count(*) from public.schedule_engine_results), 0::bigint, 'result RLS hides another user predictions');

select throws_ok(
  $$select public.cancel_my_schedule_engine_job(current_setting('test.cancel_engine_job')::uuid)$$,
  '42501', 'schedule_engine_job_not_cancellable',
  'another user cannot cancel the owner request'
);

select throws_ok(
  $$select public.admin_list_schedule_engine_jobs()$$,
  '42501', 'administrator_access_required',
  'non-administrators cannot inspect the administrative queue'
);

reset role;
insert into private.user_roles (user_id, role, granted_by)
values ('98000000-0000-4000-8000-000000000002', 'administrator', '98000000-0000-4000-8000-000000000002');
set local role authenticated;

select ok(
  jsonb_array_length(public.admin_list_schedule_engine_jobs()) >= 6,
  'administrators can inspect queue and worker details'
);

reset role;
set local role service_role;

select ok(
  jsonb_array_length(public.list_schedule_engine_jobs_for_worker()) >= 6,
  'the service-role worker control panel can inspect the queue'
);

reset role;
delete from public.class_enrollments where id = '98200000-0000-4000-8000-000000000001';

select is(
  (select count(*) from public.class_enrollments where id = '98200000-0000-4000-8000-000000000001'),
  0::bigint,
  'a historical Schedule Engine request does not block enrollment removal'
);

select is(
  (select count(*) from public.classes where id = '98100000-0000-4000-8000-000000000001'),
  1::bigint,
  'removing the enrollment still preserves the shared class'
);

select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  jsonb_array_length(public.get_my_latest_schedule_engine_job() -> 'replacements'),
  1,
  'validated replacement snapshots remain readable after the source enrollment is removed'
);

select * from finish();
rollback;
