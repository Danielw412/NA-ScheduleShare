begin;
select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '99000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'lunch-removal@test.local',
  '',
  now(),
  '{}',
  '{"full_name":"Lunch Removal Student"}',
  now(),
  now(),
  '', '', '', '', ''
);

update public.profiles
set grade = 11,
    onboarding_completed = true
where id = '99000000-0000-4000-8000-000000000001';

insert into public.course_names (id, name, normalized_name, source, term_policy)
values (
  '99100000-0000-4000-8000-000000000001',
  'Lunch - Paired Removal Test',
  'lunch - paired removal test',
  'admin',
  'lunch'
);

insert into public.classes (
  id,
  course_name_id,
  teacher_last_name,
  default_academic_term,
  is_double_period,
  created_by
) values
  ('99200000-0000-4000-8000-000000000001', '99100000-0000-4000-8000-000000000001', 'N/A', 'semester_1', false, '99000000-0000-4000-8000-000000000001'),
  ('99200000-0000-4000-8000-000000000002', '99100000-0000-4000-8000-000000000001', 'N/A', 'semester_2', false, '99000000-0000-4000-8000-000000000001'),
  ('99200000-0000-4000-8000-000000000003', '99100000-0000-4000-8000-000000000001', 'N/A', 'semester_1', false, '99000000-0000-4000-8000-000000000001'),
  ('99200000-0000-4000-8000-000000000004', '99100000-0000-4000-8000-000000000001', 'N/A', 'semester_2', false, '99000000-0000-4000-8000-000000000001');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('99200000-0000-4000-8000-000000000001', 'A', 3),
  ('99200000-0000-4000-8000-000000000001', 'B', 3),
  ('99200000-0000-4000-8000-000000000002', 'A', 3),
  ('99200000-0000-4000-8000-000000000002', 'B', 3),
  ('99200000-0000-4000-8000-000000000003', 'A', 5),
  ('99200000-0000-4000-8000-000000000003', 'B', 5),
  ('99200000-0000-4000-8000-000000000004', 'A', 6),
  ('99200000-0000-4000-8000-000000000004', 'B', 6);

insert into public.class_enrollments (id, student_id, class_id, academic_term)
values
  ('99300000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001', 'semester_1'),
  ('99300000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000002', 'semester_2'),
  ('99300000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000003', 'semester_1'),
  ('99300000-0000-4000-8000-000000000004', '99000000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000004', 'semester_2');

select set_config('request.jwt.claim.sub', '99000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$select public.remove_enrollment('99300000-0000-4000-8000-000000000001')$$,
  'removing one lunch succeeds'
);

select is(
  (
    select count(*)
    from public.class_enrollments
    where id in (
      '99300000-0000-4000-8000-000000000001',
      '99300000-0000-4000-8000-000000000002'
    )
      and not active
  ),
  2::bigint,
  'matching Semester 1 and Semester 2 lunches at the same period are both removed'
);

select is(
  (
    select count(*)
    from public.schedule_change_history
    where action = 'class_removed'
      and previous_value->>'enrollment_id' in (
        '99300000-0000-4000-8000-000000000001',
        '99300000-0000-4000-8000-000000000002'
      )
  ),
  2::bigint,
  'both paired removals are recorded in schedule history'
);

select lives_ok(
  $$select public.remove_enrollment('99300000-0000-4000-8000-000000000003')$$,
  'removing a semester-specific lunch succeeds'
);

select is(
  (
    select active
    from public.class_enrollments
    where id = '99300000-0000-4000-8000-000000000004'
  ),
  true,
  'the other semester lunch remains when its period is different'
);

select * from finish();
rollback;
