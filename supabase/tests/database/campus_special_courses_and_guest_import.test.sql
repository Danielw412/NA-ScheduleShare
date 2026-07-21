begin;
select plan(10);

select is(
  (select count(*)::integer from public.course_names where name in ('Lunch - NAI', 'Lunch - NASH', 'Study Hall - NAI', 'Study Hall - NASH') and status = 'active'),
  4,
  'all campus-specific lunch and study-hall course names are active'
);
select is(
  (select count(*)::integer from public.course_names where normalized_name in ('lunch', 'study hall') and status = 'disabled'),
  2,
  'legacy generic special-course names are disabled'
);

set local role anon;
select is(
  (select count(*)::integer from public.guest_search_course_names('Lunch', 20) where course_name like 'Lunch - %'),
  2,
  'guests can search the two campus-specific lunch names'
);
select is(
  (select count(*)::integer from public.guest_search_course_names('Lunch', 20) where course_name = 'Lunch'),
  0,
  'guest course search does not return the disabled generic lunch name'
);
select throws_ok(
  $$select * from public.schedule_import_prepare_guest(repeat('a', 64))$$,
  '42501',
  'permission denied for function schedule_import_prepare_guest',
  'anonymous clients cannot call the internal guest-import preparation function'
);
select throws_ok(
  $$select public.schedule_import_guest_match_count(array[]::uuid[])$$,
  '42501',
  'permission denied for function schedule_import_guest_match_count',
  'anonymous clients cannot call the aggregate match-count function directly'
);

reset role;
set local role service_role;
select ok(
  (select model_id is not null and output_token_limit between 256 and 8192 from public.schedule_import_prepare_guest(repeat('b', 64))),
  'the service role can prepare one rate-limited guest import'
);
reset role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'campus-one@test.local', '', now(), '{}', '{"full_name":"Campus One"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'campus-two@test.local', '', now(), '{}', '{"full_name":"Campus Two"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 10, onboarding_completed = true
where id in ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000002');

insert into public.classes (
  id, course_name_id, teacher_last_name, normalized_teacher_last_name,
  default_academic_term, is_double_period
) values
  ('98000000-0000-4000-8000-000000000011', (select id from public.course_names where normalized_name = private.normalize_search('Lunch - NAI')), 'N/A', 'n a', 'semester_1', false),
  ('98000000-0000-4000-8000-000000000012', (select id from public.course_names where normalized_name = private.normalize_search('Lunch - NAI')), 'N/A', 'n a', 'semester_2', false);

insert into public.class_meeting_slots (class_id, day_type, period_number) values
  ('98000000-0000-4000-8000-000000000011', 'A', 4),
  ('98000000-0000-4000-8000-000000000012', 'A', 4);

insert into public.class_enrollments (student_id, class_id, academic_term, active) values
  ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000011', 'semester_1', true),
  ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000012', 'semester_2', true),
  ('98000000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000011', 'semester_1', true);

set local role service_role;
select is(
  public.schedule_import_guest_match_count(array[
    '98000000-0000-4000-8000-000000000011'::uuid,
    '98000000-0000-4000-8000-000000000012'::uuid
  ]),
  2,
  'the guest match count deduplicates students across recognized classes'
);
select is(
  public.schedule_import_guest_match_count(array['98000000-0000-4000-8000-000000000012'::uuid]),
  1,
  'the guest match count is scoped to the exact recognized class IDs'
);
select is(
  public.schedule_import_guest_match_count(array[]::uuid[]),
  0,
  'an import without exact existing sections returns zero matches'
);

reset role;
select * from finish();
rollback;
