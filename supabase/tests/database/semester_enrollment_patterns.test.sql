begin;
select plan(42);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'semester-one@test.local', '', now(), '{}', '{"full_name":"Semester One"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'semester-two@test.local', '', now(), '{}', '{"full_name":"Semester Two"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'semester-three@test.local', '', now(), '{}', '{"full_name":"Semester Three"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'private'
where id::text like '96000000-%';

insert into public.course_names (id, name, normalized_name, source)
values ('96000000-0000-4000-8000-000000000010', 'Unlisted Semester Regression', 'unlisted semester regression', 'admin');
insert into public.course_names (id, name, normalized_name, source, term_policy)
values ('96000000-0000-4000-8000-000000000011', 'Half Credit Regression', 'half credit regression', 'admin', 'semester');

select is(
  (select term_policy::text from public.course_names where id = '96000000-0000-4000-8000-000000000010'),
  'full_year',
  'unlisted courses default to full year'
);
select is((select term_policy::text from public.course_names where normalized_name = 'creative writing'), 'semester', 'listed half-credit courses are semester-selectable');
select is((select term_policy::text from public.course_names where normalized_name = 'gym'), 'flexible_attendance', 'Gym uses flexible attendance policy');
select is((select term_policy::text from public.course_names where normalized_name = 'executive functioning'), 'variable_credit', 'Executive Functioning keeps explicit 0.5 or 1.0 format');
select is((select term_policy::text from public.course_names where normalized_name = '9th grade chorus'), 'versioned', 'special-format courses keep version-specific format');

select throws_ok(
  $$insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period)
    values ('96000000-0000-4000-8000-000000000090', '96000000-0000-4000-8000-000000000010', 'Invalid', 'semester_1', false)$$,
  '23514', 'full_year_course_requires_full_year',
  'an unlisted course cannot be silently changed to one semester'
);
select throws_ok(
  $$insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period)
    values ('96000000-0000-4000-8000-000000000091', '96000000-0000-4000-8000-000000000011', 'Invalid', 'full_year', false)$$,
  '23514', 'half_credit_course_requires_semester',
  'a half-credit course must select Semester 1 or Semester 2'
);

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
values
  ('96000000-0000-4000-8000-000000000020', '96000000-0000-4000-8000-000000000010', 'Full', 'full_year', false, '96000000-0000-4000-8000-000000000001'),
  ('96000000-0000-4000-8000-000000000021', '96000000-0000-4000-8000-000000000011', 'Fall', 'semester_1', false, '96000000-0000-4000-8000-000000000001'),
  ('96000000-0000-4000-8000-000000000022', '96000000-0000-4000-8000-000000000011', 'Spring', 'semester_2', false, '96000000-0000-4000-8000-000000000001'),
  ('96000000-0000-4000-8000-000000000023', '96000000-0000-4000-8000-000000000011', 'Aonly', 'semester_1', false, '96000000-0000-4000-8000-000000000001'),
  ('96000000-0000-4000-8000-000000000024', '96000000-0000-4000-8000-000000000011', 'Bonly', 'semester_1', false, '96000000-0000-4000-8000-000000000001'),
  ('96000000-0000-4000-8000-000000000025', '96000000-0000-4000-8000-000000000011', 'Conflict', 'semester_1', false, '96000000-0000-4000-8000-000000000001'),
  ('96000000-0000-4000-8000-000000000026', '96000000-0000-4000-8000-000000000010', 'Different', 'full_year', false, '96000000-0000-4000-8000-000000000001');

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
select '96000000-0000-4000-8000-000000000030', id, 'Coach', 'semester_1', false, '96000000-0000-4000-8000-000000000001'
from public.course_names where normalized_name = 'gym';
insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
select '96000000-0000-4000-8000-000000000031', id, 'Cafe', 'semester_1', false, '96000000-0000-4000-8000-000000000001'
from public.course_names where normalized_name = 'lunch - nash';
insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
select '96000000-0000-4000-8000-000000000032', id, 'Cafe', 'semester_2', false, '96000000-0000-4000-8000-000000000001'
from public.course_names where normalized_name = 'lunch - nash';

insert into public.class_meeting_slots (class_id, day_type, period_number) values
  ('96000000-0000-4000-8000-000000000020', 'A', 1),
  ('96000000-0000-4000-8000-000000000020', 'B', 1),
  ('96000000-0000-4000-8000-000000000021', 'A', 2),
  ('96000000-0000-4000-8000-000000000022', 'A', 2),
  ('96000000-0000-4000-8000-000000000023', 'A', 4),
  ('96000000-0000-4000-8000-000000000024', 'B', 4),
  ('96000000-0000-4000-8000-000000000025', 'A', 2),
  ('96000000-0000-4000-8000-000000000026', 'A', 3),
  ('96000000-0000-4000-8000-000000000026', 'B', 4),
  ('96000000-0000-4000-8000-000000000030', 'A', 5),
  ('96000000-0000-4000-8000-000000000030', 'B', 5),
  ('96000000-0000-4000-8000-000000000031', 'A', 7),
  ('96000000-0000-4000-8000-000000000031', 'B', 7),
  ('96000000-0000-4000-8000-000000000032', 'A', 8),
  ('96000000-0000-4000-8000-000000000032', 'B', 8);

select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000020', 'full_year')$$, 'a normal full-year class can be added');
select is((select academic_term::text from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000001' and class_id = '96000000-0000-4000-8000-000000000020'), 'full_year', 'the full-year enrollment stays full year');
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000021', 'semester_1')$$, 'a Semester 1 half-credit class can be added');
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000022', 'semester_2')$$, 'the same slot can be used by a Semester 2 class');
select is((select count(*)::integer from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000001' and class_id in ('96000000-0000-4000-8000-000000000021','96000000-0000-4000-8000-000000000022') and active), 2, 'semester conflict planes are independent');
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000023', 'semester_1')$$, 'an A-only class can be added');
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000024', 'semester_1')$$, 'a B-only class can use the same period');
select is((select count(*)::integer from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000001' and class_id in ('96000000-0000-4000-8000-000000000023','96000000-0000-4000-8000-000000000024') and active), 2, 'A-day and B-day conflict planes are independent');
select throws_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000025', 'semester_1')$$, '23514', 'schedule_conflict', 'a conflict in the same semester and day is rejected');
select throws_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000020', 'full_year', false, '[{"day_type":"A","period_number":9}]')$$, '23514', 'class_meeting_slots_locked', 'normal class meeting slots cannot be changed per student');
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000030', 'semester_1', false, '[{"day_type":"A","period_number":5},{"day_type":"B","period_number":5}]')$$, 'semester Gym can meet every day');

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000030', 'full_year', false, '[{"day_type":"B","period_number":5}]')$$, 'full-year Gym can meet only on B days');

reset role;
select is((select count(*)::integer from public.class_enrollments where class_id = '96000000-0000-4000-8000-000000000030' and active), 2, 'different attendance patterns share one Gym roster');
select is((select count(*)::integer from public.class_enrollment_meeting_slots slot join public.class_enrollments enrollment on enrollment.id = slot.enrollment_id where enrollment.student_id = '96000000-0000-4000-8000-000000000001' and enrollment.class_id = '96000000-0000-4000-8000-000000000030'), 2, 'semester Gym stores both daily meeting slots on the enrollment');
select is((select enrollment.academic_term::text || ':' || count(slot.*)::text from public.class_enrollments enrollment join public.class_enrollment_meeting_slots slot on slot.enrollment_id = enrollment.id where enrollment.student_id = '96000000-0000-4000-8000-000000000002' and enrollment.class_id = '96000000-0000-4000-8000-000000000030' group by enrollment.academic_term), 'full_year:1', 'the classmate stores a distinct full-year alternating-day pattern');

set local role authenticated;
select throws_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000030', 'full_year', false, '[{"day_type":"A","period_number":5},{"day_type":"B","period_number":5}]')$$, '23514', 'full_year_special_requires_one_day', 'full-year Gym cannot meet every day');
select throws_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000030', 'semester_2', false, '[{"day_type":"A","period_number":5}]')$$, '23514', 'semester_special_requires_every_day', 'semester Gym cannot meet on only one day');

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000031', 'semester_1')$$, 'a Semester 1 lunch can be added');
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000031', 'semester_2')$$, 'adding the same lunch for Semester 2 succeeds');

reset role;
select is((select count(*)::integer from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000001' and class_id = '96000000-0000-4000-8000-000000000031' and active), 1, 'identical lunch periods are stored as one enrollment');
select is((select academic_term::text from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000001' and class_id = '96000000-0000-4000-8000-000000000031'), 'full_year', 'identical semester lunches collapse to full year');
set local role authenticated;
select throws_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000032', 'semester_2')$$, '23514', 'lunch_schedule_conflict', 'a second lunch in the same semester is rejected');

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000031', 'semester_1')$$, 'lunch may use one period in Semester 1');
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000032', 'semester_2')$$, 'lunch may use another period in Semester 2');

reset role;
select is((select count(*)::integer from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000003' and class_id in ('96000000-0000-4000-8000-000000000031','96000000-0000-4000-8000-000000000032') and active), 2, 'different lunch periods remain separate semester entries');
select is((select string_agg(academic_term::text, ',' order by academic_term::text) from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000003' and class_id in ('96000000-0000-4000-8000-000000000031','96000000-0000-4000-8000-000000000032')), 'semester_1,semester_2', 'split lunch retains both selected semesters');
set local role authenticated;
select lives_ok($$select public.enroll_in_class('96000000-0000-4000-8000-000000000026', 'full_year')$$, 'a full-year class may use different A and B periods');

reset role;
select is((select string_agg(slot.day_type::text || slot.period_number::text, ',' order by slot.day_type) from public.class_enrollment_meeting_slots slot join public.class_enrollments enrollment on enrollment.id = slot.enrollment_id where enrollment.student_id = '96000000-0000-4000-8000-000000000003' and enrollment.class_id = '96000000-0000-4000-8000-000000000026'), 'A3,B4', 'different A/B periods are preserved on the enrollment');
select ok(private.terms_overlap('full_year', 'semester_1') and private.terms_overlap('full_year', 'semester_2'), 'full-year entries participate in both semesters');

select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.replace_schedule_from_import(jsonb_build_array(
      jsonb_build_object(
        'existing_class_id', '96000000-0000-4000-8000-000000000031',
        'course_name_id', (select course_name_id from public.classes where id = '96000000-0000-4000-8000-000000000031'),
        'teacher_last_name', 'N/A',
        'academic_term', 'semester_1',
        'meeting_slots', jsonb_build_array(jsonb_build_object('day_type', 'A', 'period_number', 7), jsonb_build_object('day_type', 'B', 'period_number', 7))
      ),
      jsonb_build_object(
        'existing_class_id', '96000000-0000-4000-8000-000000000032',
        'course_name_id', (select course_name_id from public.classes where id = '96000000-0000-4000-8000-000000000032'),
        'teacher_last_name', 'N/A',
        'academic_term', 'semester_1',
        'meeting_slots', jsonb_build_array(jsonb_build_object('day_type', 'A', 'period_number', 8), jsonb_build_object('day_type', 'B', 'period_number', 8))
      )
    ))$$,
  '23514', 'import_schedule_conflict',
  'the atomic importer rejects two lunches in the same semester even at different periods'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.replace_schedule_from_import(jsonb_build_array(
      jsonb_build_object(
        'existing_class_id', '96000000-0000-4000-8000-000000000031',
        'course_name_id', (select course_name_id from public.classes where id = '96000000-0000-4000-8000-000000000031'),
        'teacher_last_name', 'N/A',
        'academic_term', 'semester_1',
        'meeting_slots', jsonb_build_array(jsonb_build_object('day_type', 'A', 'period_number', 7), jsonb_build_object('day_type', 'B', 'period_number', 7))
      ),
      jsonb_build_object(
        'existing_class_id', '96000000-0000-4000-8000-000000000031',
        'course_name_id', (select course_name_id from public.classes where id = '96000000-0000-4000-8000-000000000031'),
        'teacher_last_name', 'N/A',
        'academic_term', 'semester_2',
        'meeting_slots', jsonb_build_array(jsonb_build_object('day_type', 'A', 'period_number', 7), jsonb_build_object('day_type', 'B', 'period_number', 7))
      )
    ))$$,
  'the atomic importer collapses matching Semester 1 and Semester 2 lunch rows'
);

reset role;
select is(
  (select count(*)::integer from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000002' and active),
  1,
  'the collapsed import stores one active lunch enrollment'
);
select is(
  (select academic_term::text from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000002' and active),
  'full_year',
  'the collapsed imported lunch is full year'
);

select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.create_class_and_replace_enrollment(
      (select id from public.class_enrollments where student_id = '96000000-0000-4000-8000-000000000002' and active),
      '96000000-0000-4000-8000-000000000010',
      null,
      'Replacement',
      'full_year',
      false,
      '[{"day_type":"A","period_number":6},{"day_type":"B","period_number":6}]'::jsonb,
      false
    )$$,
  'creating a new section can atomically replace the edited enrollment'
);

reset role;
select is(
  (select course_name.name from public.class_enrollments enrollment join public.classes class_record on class_record.id = enrollment.class_id join public.course_names course_name on course_name.id = class_record.course_name_id where enrollment.student_id = '96000000-0000-4000-8000-000000000002' and enrollment.active),
  'Unlisted Semester Regression',
  'the atomic create-and-replace leaves only the new enrollment active'
);

select * from finish();
rollback;
