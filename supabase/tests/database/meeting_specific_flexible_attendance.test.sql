begin;
select plan(25);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current,
  email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'gym-a@test.local', '', now(), '{}', '{"full_name":"Gym A Full Year"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'gym-b@test.local', '', now(), '{}', '{"full_name":"Gym B Full Year"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'gym-s1@test.local', '', now(), '{}', '{"full_name":"Gym Semester One"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'gym-s2@test.local', '', now(), '{}', '{"full_name":"Gym Semester Two"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'gym-suspended@test.local', '', now(), '{}', '{"full_name":"Gym Suspended"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'gym-admin@test.local', '', now(), '{}', '{"full_name":"Gym Admin"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'school'
where id in (
  '97000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000002',
  '97000000-0000-4000-8000-000000000005',
  '97000000-0000-4000-8000-000000000006'
);
update public.profiles set grade = 11, onboarding_completed = true, privacy_setting = 'private'
where id = '97000000-0000-4000-8000-000000000003';
update public.profiles set grade = 11, onboarding_completed = true, privacy_setting = 'classmates'
where id = '97000000-0000-4000-8000-000000000004';

insert into private.user_roles (user_id, role, granted_by)
values ('97000000-0000-4000-8000-000000000006', 'administrator', '97000000-0000-4000-8000-000000000006');

insert into public.classes (
  id, course_name_id, teacher_last_name, default_academic_term,
  is_double_period, created_by
)
select
  '97100000-0000-4000-8000-000000000001', id, 'Coach', 'semester_1',
  false, '97000000-0000-4000-8000-000000000006'
from public.course_names where normalized_name = 'gym';

insert into public.class_meeting_slots (class_id, day_type, period_number) values
  ('97100000-0000-4000-8000-000000000001', 'A', 2),
  ('97100000-0000-4000-8000-000000000001', 'B', 2);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.enroll_in_class('97100000-0000-4000-8000-000000000001', 'full_year', false, '[{"day_type":"A","period_number":2}]')$$,
  'full-year A-only Gym enrolls in the shared class'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.enroll_in_class('97100000-0000-4000-8000-000000000001', 'full_year', false, '[{"day_type":"B","period_number":2}]')$$,
  'full-year B-only Gym enrolls in the shared class'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select lives_ok(
  $$select public.enroll_in_class('97100000-0000-4000-8000-000000000001', 'semester_1', false, '[{"day_type":"A","period_number":2},{"day_type":"B","period_number":2}]')$$,
  'Semester 1 Gym enrolls in both same-period meetings'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select lives_ok(
  $$select public.enroll_in_class('97100000-0000-4000-8000-000000000001', 'semester_2', false, '[{"day_type":"A","period_number":2},{"day_type":"B","period_number":2}]')$$,
  'Semester 2 Gym enrolls in both same-period meetings'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select lives_ok(
  $$select public.enroll_in_class('97100000-0000-4000-8000-000000000001', 'semester_1', false, '[{"day_type":"A","period_number":2},{"day_type":"B","period_number":2}]')$$,
  'the future suspended member is enrolled before suspension'
);

reset role;
update private.account_moderation
set suspended_at = now(),
    suspended_by = '97000000-0000-4000-8000-000000000006',
    suspension_reason = 'Meeting roster regression test'
where user_id = '97000000-0000-4000-8000-000000000005';

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select * from public.get_class_members('97100000-0000-4000-8000-000000000001')$$,
  '23514', 'meeting_context_required',
  'a flexible-attendance roster requires an explicit meeting'
);
select is(
  (select count(*) from public.get_class_members('97100000-0000-4000-8000-000000000001', 'A', 2::smallint)),
  3::bigint,
  'the A roster contains A-only plus both semester students and hides the suspended member'
);
select is(
  (select count(*) from public.get_class_members('97100000-0000-4000-8000-000000000001', 'A', 2::smallint) where student_id = '97000000-0000-4000-8000-000000000003'),
  1::bigint,
  'attending the A meeting reveals its private semester classmate'
);
select is(
  (select count(*) from public.get_class_members('97100000-0000-4000-8000-000000000001', 'B', 2::smallint) where student_id in ('97000000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000004')),
  0::bigint,
  'an A-only viewer gets no private or classmates-only bypass in the B roster'
);
select is(
  (select count(*) from public.get_classmates() where student_id = '97000000-0000-4000-8000-000000000002'),
  0::bigint,
  'A-only and B-only students are not classmates'
);
select is(
  (select count(*) from public.get_classmates() where student_id in ('97000000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000004')),
  2::bigint,
  'a full-year A-only student overlaps semester students from both terms'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select count(*) from public.get_classmates() where student_id = '97000000-0000-4000-8000-000000000004'),
  0::bigint,
  'Semester 1 and Semester 2 Gym students are not classmates'
);
select throws_ok(
  $$select * from public.get_visible_schedule('97000000-0000-4000-8000-000000000004')$$,
  '42501', 'schedule_not_visible',
  'classmates-only privacy does not treat non-overlapping semesters as classmates'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select is(
  (select count(*) from public.get_class_members('97100000-0000-4000-8000-000000000001', 'B', 2::smallint)),
  4::bigint,
  'an administrator sees every B-meeting member across terms'
);
select is(
  (select count(*) from public.get_class_members('97100000-0000-4000-8000-000000000001', 'B', 2::smallint) where student_id = '97000000-0000-4000-8000-000000000005'),
  1::bigint,
  'the administrator privacy exception includes a suspended meeting member'
);
select throws_ok(
  $$select public.enroll_in_class('97100000-0000-4000-8000-000000000001', 'semester_1', false, '[{"day_type":"A","period_number":2},{"day_type":"B","period_number":3}]')$$,
  '23514', 'semester_special_requires_same_period',
  'database enrollment validation rejects mismatched semester Gym periods'
);

reset role;
select is(
  (select term_policy::text from public.course_names where normalized_name = 'wellness for life'),
  'sectioned_attendance',
  'Wellness uses exact sectioned attendance'
);
select is(
  (select term_policy::text from public.course_names where normalized_name like 'study hall%' order by normalized_name limit 1),
  'flexible_attendance',
  'Study Hall retains shared flexible attendance'
);

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.create_class_and_enroll((select id from public.course_names where normalized_name = 'wellness for life'), null, 'Well', 'full_year', false, '[{"day_type":"A","period_number":6}]', false)$$,
  'Wellness creates a full-year A section'
);
reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.create_class_and_enroll((select id from public.course_names where normalized_name = 'wellness for life'), null, 'Well', 'full_year', false, '[{"day_type":"B","period_number":6}]', false)$$,
  'Wellness creates a separate full-year B section'
);
reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select lives_ok(
  $$select public.create_class_and_enroll((select id from public.course_names where normalized_name = 'wellness for life'), null, 'Well', 'semester_1', false, '[{"day_type":"A","period_number":6},{"day_type":"B","period_number":6}]', false)$$,
  'Wellness creates a Semester 1 every-day section'
);
reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select lives_ok(
  $$select public.create_class_and_enroll((select id from public.course_names where normalized_name = 'wellness for life'), null, 'Well', 'semester_2', false, '[{"day_type":"A","period_number":6},{"day_type":"B","period_number":6}]', false)$$,
  'Wellness creates a separate Semester 2 every-day section'
);

reset role;
select is(
  (select count(*) from public.classes class_record join public.course_names course_name on course_name.id = class_record.course_name_id where course_name.normalized_name = 'wellness for life' and class_record.normalized_teacher_last_name = 'well'),
  4::bigint,
  'all four Wellness term and attendance formats have distinct class IDs'
);

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select lives_ok(
  $$select public.create_class_and_enroll((select id from public.course_names where normalized_name = 'wellness for life'), null, 'Well', 'full_year', false, '[{"day_type":"A","period_number":6}]', false)$$,
  'an identical Wellness format reuses its exact section'
);
reset role;
select is(
  (select count(*) from public.classes class_record join public.course_names course_name on course_name.id = class_record.course_name_id where course_name.normalized_name = 'wellness for life' and class_record.normalized_teacher_last_name = 'well'),
  4::bigint,
  'reusing Wellness does not create a fifth class ID'
);

select * from finish();
rollback;
