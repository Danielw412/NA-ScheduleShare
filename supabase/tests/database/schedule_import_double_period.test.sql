begin;
select plan(4);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '97100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'schedule-import-double@test.local', '', now(), '{}',
  '{"full_name":"Double Period Import Tester"}', now(), now(), '', '', '', '', ''
);

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'private'
where id = '97100000-0000-4000-8000-000000000001';

insert into public.course_names (id, name, normalized_name, source)
values (
  '97100000-0000-4000-8000-000000000010',
  'Import Double Period Course',
  'import double period course',
  'admin'
);

select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (
    select jsonb_build_object('added_count', added_count, 'removed_count', removed_count)
    from public.replace_schedule_from_import('[{
      "existing_class_id":null,
      "course_name_id":"97100000-0000-4000-8000-000000000010",
      "teacher_last_name":"Double",
      "academic_term":"full_year",
      "meeting_slots":[
        {"day_type":"A","period_number":2},
        {"day_type":"A","period_number":3},
        {"day_type":"B","period_number":2}
      ]
    }]'::jsonb)
  ),
  '{"added_count":1,"removed_count":0}'::jsonb,
  'a valid asymmetric double-period class can be imported'
);

select is(
  (
    select class_record.is_double_period
    from public.classes class_record
    where class_record.course_name_id = '97100000-0000-4000-8000-000000000010'
      and class_record.teacher_last_name = 'Double'
  ),
  true,
  'the imported class is stored as double-period'
);

select is(
  (
    select count(*)::integer
    from public.class_meeting_slots slot
    join public.classes class_record on class_record.id = slot.class_id
    where class_record.course_name_id = '97100000-0000-4000-8000-000000000010'
      and class_record.teacher_last_name = 'Double'
  ),
  3,
  'all submitted A/B meeting slots are retained'
);

select is(
  (
    select count(*)::integer
    from public.class_enrollments enrollment
    join public.classes class_record on class_record.id = enrollment.class_id
    where enrollment.student_id = '97100000-0000-4000-8000-000000000001'
      and enrollment.active
      and class_record.course_name_id = '97100000-0000-4000-8000-000000000010'
  ),
  1,
  'the student is enrolled in the imported double-period class'
);

select * from finish();
rollback;
