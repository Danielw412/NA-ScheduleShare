begin;
select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '97000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'schedule-import-replace@test.local', '', now(), '{}',
  '{"full_name":"Schedule Import Tester"}', now(), now(), '', '', '', '', ''
);

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'private'
where id = '97000000-0000-4000-8000-000000000001';

insert into public.course_names (id, name, normalized_name, source) values
  ('97000000-0000-4000-8000-000000000010', 'Import Old Course', 'import old course', 'admin'),
  ('97000000-0000-4000-8000-000000000011', 'Import New Course', 'import new course', 'admin');

insert into public.classes (
  id, course_name_id, teacher_last_name, normalized_teacher_last_name,
  default_academic_term, is_double_period, created_by
) values
  (
    '97000000-0000-4000-8000-000000000020',
    '97000000-0000-4000-8000-000000000010',
    'Old', 'old', 'full_year', false,
    '97000000-0000-4000-8000-000000000001'
  ),
  (
    '97000000-0000-4000-8000-000000000021',
    '97000000-0000-4000-8000-000000000011',
    'Smith', 'smith', 'full_year', false,
    '97000000-0000-4000-8000-000000000001'
  );

insert into public.class_meeting_slots (class_id, day_type, period_number) values
  ('97000000-0000-4000-8000-000000000020', 'A', 1),
  ('97000000-0000-4000-8000-000000000020', 'B', 1),
  ('97000000-0000-4000-8000-000000000021', 'A', 1),
  ('97000000-0000-4000-8000-000000000021', 'B', 1);

insert into public.class_enrollments (student_id, class_id, academic_term, active)
values (
  '97000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000020',
  'full_year',
  true
);

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (
    select jsonb_build_object('added_count', added_count, 'removed_count', removed_count)
    from public.replace_schedule_from_import('[{
      "existing_class_id":"97000000-0000-4000-8000-000000000021",
      "course_name_id":"97000000-0000-4000-8000-000000000011",
      "teacher_last_name":"Smith",
      "academic_term":"full_year",
      "meeting_slots":[
        {"day_type":"A","period_number":1},
        {"day_type":"B","period_number":1}
      ]
    }]'::jsonb)
  ),
  '{"added_count":1,"removed_count":1}'::jsonb,
  'import replacement reports the number of removed and added enrollments'
);
select is(
  (select class_id from public.class_enrollments where student_id = '97000000-0000-4000-8000-000000000001' and active),
  '97000000-0000-4000-8000-000000000021'::uuid,
  'an overlapping current schedule is replaced by the reviewed class'
);
select is(
  (select active from public.class_enrollments where student_id = '97000000-0000-4000-8000-000000000001' and class_id = '97000000-0000-4000-8000-000000000020'),
  false,
  'the previous enrollment is retained as inactive history'
);
select is(
  (select count(*)::integer from public.schedule_change_history where student_id = '97000000-0000-4000-8000-000000000001'),
  2,
  'the atomic replacement records one removal and one addition'
);

select throws_ok(
  $$select * from public.replace_schedule_from_import('[
    {
      "existing_class_id":null,
      "course_name_id":"97000000-0000-4000-8000-000000000011",
      "teacher_last_name":"Conflict One",
      "academic_term":"full_year",
      "meeting_slots":[{"day_type":"A","period_number":2}]
    },
    {
      "existing_class_id":null,
      "course_name_id":"97000000-0000-4000-8000-000000000011",
      "teacher_last_name":"Conflict Two",
      "academic_term":"semester_1",
      "meeting_slots":[{"day_type":"A","period_number":2}]
    }
  ]'::jsonb)$$,
  '23514',
  'import_schedule_conflict',
  'conflicts are checked between imported rows'
);
select is(
  (select class_id from public.class_enrollments where student_id = '97000000-0000-4000-8000-000000000001' and active),
  '97000000-0000-4000-8000-000000000021'::uuid,
  'a rejected import leaves the current schedule unchanged'
);
select is(
  (select count(*)::integer from public.classes where teacher_last_name in ('Conflict One', 'Conflict Two')),
  0,
  'classes created by a rejected import are rolled back'
);

select is(
  (
    select jsonb_build_object('added_count', added_count, 'removed_count', removed_count)
    from public.replace_schedule_from_import('[
      {
        "existing_class_id":null,
        "course_name_id":"97000000-0000-4000-8000-000000000011",
        "teacher_last_name":"Fall",
        "academic_term":"semester_1",
        "meeting_slots":[{"day_type":"B","period_number":3}]
      },
      {
        "existing_class_id":null,
        "course_name_id":"97000000-0000-4000-8000-000000000011",
        "teacher_last_name":"Spring",
        "academic_term":"semester_2",
        "meeting_slots":[{"day_type":"B","period_number":3}]
      }
    ]'::jsonb)
  ),
  '{"added_count":2,"removed_count":1}'::jsonb,
  'semester 1 and semester 2 may use the same meeting slot'
);
select is(
  (select count(*)::integer from public.class_enrollments where student_id = '97000000-0000-4000-8000-000000000001' and active),
  2,
  'both non-overlapping semester enrollments are active'
);

select throws_ok(
  $$select * from public.replace_schedule_from_import('[{
    "existing_class_id":"97000000-0000-4000-8000-000000000021",
    "course_name_id":"97000000-0000-4000-8000-000000000011",
    "teacher_last_name":"Wrong Teacher",
    "academic_term":"full_year",
    "meeting_slots":[
      {"day_type":"A","period_number":1},
      {"day_type":"B","period_number":1}
    ]
  }]'::jsonb)$$,
  '23514',
  'import_existing_class_mismatch',
  'a stale or manipulated existing-class selection is rejected'
);
select is(
  (select count(*)::integer from public.class_enrollments where student_id = '97000000-0000-4000-8000-000000000001' and active),
  2,
  'a stale existing-class selection does not partially replace the schedule'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.replace_schedule_from_import('[]'::jsonb)$$,
  '42501',
  'permission denied for function replace_schedule_from_import',
  'anonymous users cannot replace schedules'
);

select * from finish();
rollback;
