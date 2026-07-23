begin;
select plan(14);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'danielruoqiao@gmail.com', '', now(), '{}', '{"full_name":"Term Admin"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'term-student@test.local', '', now(), '{}', '{"full_name":"Term Student"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11,
    onboarding_completed = true,
    privacy_setting = 'private',
    last_login_at = '2026-07-20 12:00:00+00',
    last_active_at = '2026-07-20 12:05:00+00'
where id::text like '98000000-%';

insert into private.user_roles (user_id, role, granted_by)
values ('98000000-0000-4000-8000-000000000001', 'administrator', '98000000-0000-4000-8000-000000000001');

insert into public.course_names (id, name, normalized_name, source)
values
  ('98100000-0000-4000-8000-000000000001', 'Term Locked Physics', 'term locked physics', 'admin'),
  ('98100000-0000-4000-8000-000000000002', 'Migration Check Gym', 'migration check gym', 'admin'),
  ('98100000-0000-4000-8000-000000000003', 'Lunch - Migration Check', 'lunch - migration check', 'admin');

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
values
  ('98200000-0000-4000-8000-000000000001', '98100000-0000-4000-8000-000000000001', 'Curie', 'full_year', false, '98000000-0000-4000-8000-000000000001'),
  ('98200000-0000-4000-8000-000000000002', '98100000-0000-4000-8000-000000000002', 'Coach', 'full_year', false, '98000000-0000-4000-8000-000000000001');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('98200000-0000-4000-8000-000000000001', 'A', 2),
  ('98200000-0000-4000-8000-000000000002', 'B', 3);

select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$insert into public.class_enrollments (student_id, class_id, academic_term)
    values ('98000000-0000-4000-8000-000000000002', '98200000-0000-4000-8000-000000000001', 'full_year')$$,
  'a student can join a class using its shared term'
);
select is(
  (select metadata->>'course_name' from public.event_logs where event_type = 'user_joined_class' and target_id = '98200000-0000-4000-8000-000000000001' order by created_at desc limit 1),
  'Term Locked Physics',
  'join logs include the course name'
);
select is(
  (select metadata->>'teacher_last_name' from public.event_logs where event_type = 'user_joined_class' and target_id = '98200000-0000-4000-8000-000000000001' order by created_at desc limit 1),
  'Curie',
  'join logs include the teacher'
);
select is(
  (select metadata #>> '{meeting_slots,0,period_number}' from public.event_logs where event_type = 'user_joined_class' and target_id = '98200000-0000-4000-8000-000000000001' order by created_at desc limit 1),
  '2',
  'join logs include period details'
);
select is(
  (select count(*) from public.event_logs where event_type in ('schedule_class_added', 'schedule_class_removed')),
  0::bigint,
  'exact duplicate schedule membership logs are not written'
);
select throws_ok(
  $$insert into public.class_enrollments (student_id, class_id, academic_term)
    values ('98000000-0000-4000-8000-000000000001', '98200000-0000-4000-8000-000000000001', 'semester_1')$$,
  '23514', 'class_term_locked',
  'ordinary classes use one shared term for every student'
);
select lives_ok(
  $$insert into public.class_enrollments (student_id, class_id, academic_term)
    values ('98000000-0000-4000-8000-000000000001', '98200000-0000-4000-8000-000000000002', 'semester_1')$$,
  'Gym may keep a student-specific semester term'
);
select throws_ok(
  $$update public.classes set default_academic_term = 'semester_1' where id = '98200000-0000-4000-8000-000000000001'$$,
  '23514', 'class_term_locked',
  'a class term cannot be changed after creation'
);
select throws_ok(
  $$insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
    values ('98200000-0000-4000-8000-000000000003', '98100000-0000-4000-8000-000000000003', 'Cafe', 'full_year', false, '98000000-0000-4000-8000-000000000001')$$,
  '23514', 'lunch_requires_semester',
  'Lunch cannot be created as full year'
);
select lives_ok(
  $$insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
    values ('98200000-0000-4000-8000-000000000004', '98100000-0000-4000-8000-000000000003', 'Cafe', 'semester_1', false, '98000000-0000-4000-8000-000000000001')$$,
  'Lunch can be created for a semester'
);

insert into public.schedule_access_requests (id, requester_id, owner_id)
values ('98300000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);
insert into public.schedule_access_grants (owner_id, viewer_id, granted_via)
values ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000002', 'request');
update public.schedule_access_requests
set status = 'approved', responded_at = now()
where id = '98300000-0000-4000-8000-000000000001';

select is(
  (select event_type from public.event_logs where target_id = '98000000-0000-4000-8000-000000000001:98000000-0000-4000-8000-000000000002' and event_type = 'schedule_access_allowed' order by created_at desc limit 1),
  'schedule_access_allowed',
  'approving a viewer writes an explicit access-allowed event'
);
select is(
  (select metadata->>'allowed' from public.event_logs where target_id = '98000000-0000-4000-8000-000000000001:98000000-0000-4000-8000-000000000002' and event_type = 'schedule_access_allowed' order by created_at desc limit 1),
  'true',
  'the access event records the allowed result'
);

set local role authenticated;
select is(
  (select last_login_at from public.admin_list_users('', null, null) where user_id = '98000000-0000-4000-8000-000000000002'),
  '2026-07-20 12:00:00+00'::timestamptz,
  'administrators can see the last login timestamp'
);
select is(
  (select last_active_at from public.admin_list_users('', null, null) where user_id = '98000000-0000-4000-8000-000000000002'),
  '2026-07-20 12:05:00+00'::timestamptz,
  'administrators can see the last online timestamp'
);

select * from finish();
rollback;
