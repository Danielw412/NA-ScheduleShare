begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '98000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'clear-schedule@test.local', '', now(), '{}',
    '{"full_name":"Clear Schedule Tester"}', now(), now(), '', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '98000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'clear-schedule-classmate@test.local', '', now(), '{}',
    '{"full_name":"Clear Schedule Classmate"}', now(), now(), '', '', '', '', ''
  );

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'private'
where id in (
  '98000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000002'
);

insert into public.course_names (id, name, normalized_name, source) values
  ('98000000-0000-4000-8000-000000000010', 'Clear Schedule One', 'clear schedule one', 'admin'),
  ('98000000-0000-4000-8000-000000000011', 'Clear Schedule Two', 'clear schedule two', 'admin');

insert into public.classes (
  id, course_name_id, teacher_last_name, normalized_teacher_last_name,
  default_academic_term, is_double_period, created_by
) values
  (
    '98000000-0000-4000-8000-000000000020',
    '98000000-0000-4000-8000-000000000010',
    'One', 'one', 'full_year', false,
    '98000000-0000-4000-8000-000000000001'
  ),
  (
    '98000000-0000-4000-8000-000000000021',
    '98000000-0000-4000-8000-000000000011',
    'Two', 'two', 'full_year', false,
    '98000000-0000-4000-8000-000000000001'
  );

insert into public.class_meeting_slots (class_id, day_type, period_number) values
  ('98000000-0000-4000-8000-000000000020', 'A', 1),
  ('98000000-0000-4000-8000-000000000021', 'B', 2);

insert into public.class_enrollments (student_id, class_id, academic_term, active) values
  ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000020', 'full_year', true),
  ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000021', 'full_year', true),
  ('98000000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000020', 'full_year', true);

select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(public.clear_my_schedule(), 2, 'clear reports every removed class');
select is(
  (select count(*)::integer from public.class_enrollments where student_id = '98000000-0000-4000-8000-000000000001' and active),
  0,
  'the authenticated student has no active enrollments after clearing'
);
select is(
  (select count(*)::integer from public.class_enrollments where student_id = '98000000-0000-4000-8000-000000000001' and not active),
  2,
  'cleared enrollments remain as inactive history'
);
select is(
  (select count(*)::integer from public.class_enrollments where student_id = '98000000-0000-4000-8000-000000000002' and active),
  1,
  'clearing one schedule does not change a classmate schedule'
);
select is(
  (select count(*)::integer from public.classes where id in ('98000000-0000-4000-8000-000000000020', '98000000-0000-4000-8000-000000000021')),
  2,
  'clearing a schedule does not delete shared classes'
);
select is(
  (select count(*)::integer from public.schedule_change_history where student_id = '98000000-0000-4000-8000-000000000001' and action = 'class_removed'),
  2,
  'each cleared class receives an audit-history entry'
);
select is(public.clear_my_schedule(), 0, 'clearing an already empty schedule is safe');

reset role;
set local role anon;
select throws_ok(
  $$select public.clear_my_schedule()$$,
  '42501',
  'permission denied for function clear_my_schedule',
  'anonymous users cannot clear schedules'
);

select * from finish();
rollback;
