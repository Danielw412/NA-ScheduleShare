begin;
select plan(5);

select ok(
  not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.schedule_engine_replacement_courses'::regclass
      and conname = 'schedule_engine_replacement_courses_job_id_course_name_id_key'
  ),
  'replacement targets are no longer globally unique by course ID'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'schedule_engine_replacement_courses'
      and indexname = 'schedule_engine_replacement_courses_non_study_unique_idx'
      and indexdef ilike '%unique index%'
      and indexdef ilike '%study hall%'
  ),
  'database uniqueness remains enforced for non-Study Hall replacement courses'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current,
  email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '98400000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'engine-study-hall@test.local', '', now(),
  '{}', '{"full_name":"Study Hall Tester"}', now(), now(), '', '', '', '', ''
);

update public.profiles
set grade = 11, onboarding_completed = true
where id = '98400000-0000-4000-8000-000000000001';

insert into public.course_names (id, name, normalized_name, status, source, term_policy) values
  ('98410000-0000-4000-8000-000000000001', 'Schedule Engine Source One', 'schedule engine source one', 'active', 'user', 'full_year'),
  ('98410000-0000-4000-8000-000000000002', 'Schedule Engine Source Two', 'schedule engine source two', 'active', 'user', 'full_year'),
  ('98410000-0000-4000-8000-000000000003', 'Study Hall - Test', 'study hall - test', 'active', 'user', 'flexible_attendance'),
  ('98410000-0000-4000-8000-000000000004', 'Schedule Engine Normal Target', 'schedule engine normal target', 'active', 'user', 'full_year');

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by) values
  ('98420000-0000-4000-8000-000000000001', '98410000-0000-4000-8000-000000000001', 'One', 'full_year', false, '98400000-0000-4000-8000-000000000001'),
  ('98420000-0000-4000-8000-000000000002', '98410000-0000-4000-8000-000000000002', 'Two', 'full_year', false, '98400000-0000-4000-8000-000000000001');

insert into public.class_meeting_slots (class_id, day_type, period_number) values
  ('98420000-0000-4000-8000-000000000001', 'A', 1),
  ('98420000-0000-4000-8000-000000000001', 'B', 1),
  ('98420000-0000-4000-8000-000000000002', 'A', 2),
  ('98420000-0000-4000-8000-000000000002', 'B', 2);

insert into public.class_enrollments (id, student_id, class_id, academic_term, active) values
  ('98430000-0000-4000-8000-000000000001', '98400000-0000-4000-8000-000000000001', '98420000-0000-4000-8000-000000000001', 'full_year', true),
  ('98430000-0000-4000-8000-000000000002', '98400000-0000-4000-8000-000000000001', '98420000-0000-4000-8000-000000000002', 'full_year', true);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '98400000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select set_config(
    'test.study_hall_job',
    public.create_schedule_engine_job(
      jsonb_build_object(
        'enrollment_ids', jsonb_build_array(
          '98430000-0000-4000-8000-000000000001',
          '98430000-0000-4000-8000-000000000002'
        ),
        'replacement_course_ids', jsonb_build_array(
          '98410000-0000-4000-8000-000000000003',
          '98410000-0000-4000-8000-000000000003'
        )
      ),
      false
    )::text,
    true
  )$$,
  'the same Study Hall catalog course can be requested twice'
);

select is(
  (
    select count(*)
    from public.schedule_engine_replacement_courses target
    where target.job_id = current_setting('test.study_hall_job')::uuid
      and target.course_name_id = '98410000-0000-4000-8000-000000000003'
  ),
  2::bigint,
  'both Study Hall target positions are stored'
);

select throws_ok(
  $$select public.create_schedule_engine_job(
    jsonb_build_object(
      'enrollment_ids', jsonb_build_array(
        '98430000-0000-4000-8000-000000000001',
        '98430000-0000-4000-8000-000000000002'
      ),
      'replacement_course_ids', jsonb_build_array(
        '98410000-0000-4000-8000-000000000004',
        '98410000-0000-4000-8000-000000000004'
      )
    ),
    false
  )$$,
  '23505', 'schedule_engine_duplicate_replacement_course',
  'non-Study Hall replacement courses must still be unique'
);

select * from finish();
rollback;
