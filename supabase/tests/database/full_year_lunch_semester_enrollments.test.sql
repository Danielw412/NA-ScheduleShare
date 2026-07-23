begin;
select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '97000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'full-year-lunch@test.local', '', now(),
  '{}', '{"full_name":"Full Year Lunch"}', now(), now(), '', '', '', '', ''
);

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'private'
where id = '97000000-0000-4000-8000-000000000001';

insert into public.course_names (id, name, normalized_name, source, term_policy)
values (
  '97000000-0000-4000-8000-000000000010',
  'Lunch Full Year Regression',
  'lunch full year regression',
  'admin',
  'lunch'
);

insert into public.classes (
  id, course_name_id, teacher_last_name, default_academic_term,
  is_double_period, created_by
) values (
  '97000000-0000-4000-8000-000000000020',
  '97000000-0000-4000-8000-000000000010',
  'Cafe',
  'semester_1',
  false,
  '97000000-0000-4000-8000-000000000001'
);

insert into public.class_meeting_slots (class_id, day_type, period_number) values
  ('97000000-0000-4000-8000-000000000020', 'A', 7),
  ('97000000-0000-4000-8000-000000000020', 'B', 7);

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select public.enroll_in_class(
      '97000000-0000-4000-8000-000000000020',
      'full_year',
      false,
      '[{"day_type":"A","period_number":7},{"day_type":"B","period_number":7}]'::jsonb
    )$$,
  'choosing Full Year lunch creates both semester enrollments atomically'
);

reset role;

select is(
  (select count(*)::integer
   from public.class_enrollments enrollment
   join public.classes class_record on class_record.id = enrollment.class_id
   where enrollment.student_id = '97000000-0000-4000-8000-000000000001'
     and class_record.course_name_id = '97000000-0000-4000-8000-000000000010'
     and enrollment.active),
  2,
  'the student has two active lunch enrollments'
);

select is(
  (select string_agg(enrollment.academic_term::text, ',' order by enrollment.academic_term::text)
   from public.class_enrollments enrollment
   join public.classes class_record on class_record.id = enrollment.class_id
   where enrollment.student_id = '97000000-0000-4000-8000-000000000001'
     and class_record.course_name_id = '97000000-0000-4000-8000-000000000010'
     and enrollment.active),
  'semester_1,semester_2',
  'the enrollments cover Semester 1 and Semester 2'
);

select is(
  (select count(distinct enrollment.class_id)::integer
   from public.class_enrollments enrollment
   join public.classes class_record on class_record.id = enrollment.class_id
   where enrollment.student_id = '97000000-0000-4000-8000-000000000001'
     and class_record.course_name_id = '97000000-0000-4000-8000-000000000010'
     and enrollment.active),
  2,
  'each semester uses its own lunch roster section'
);

select is(
  (select count(*)::integer
   from public.class_enrollment_meeting_slots slot
   join public.class_enrollments enrollment on enrollment.id = slot.enrollment_id
   join public.classes class_record on class_record.id = enrollment.class_id
   where enrollment.student_id = '97000000-0000-4000-8000-000000000001'
     and class_record.course_name_id = '97000000-0000-4000-8000-000000000010'
     and enrollment.active
     and slot.period_number = 7),
  4,
  'both semester enrollments meet on A and B day at the selected period'
);

select * from finish();
rollback;
