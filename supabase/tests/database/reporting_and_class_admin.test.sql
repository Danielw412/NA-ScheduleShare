begin;
select plan(24);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '93000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'hidden-report-target@test.local', '', now(), '{}',
  '{"full_name":"Hidden Report Target"}', now(), now(), '', '', '', '', ''
);

update public.profiles
set grade = 12, onboarding_completed = true, privacy_setting = 'private'
where id = '93000000-0000-4000-8000-000000000001';

insert into public.classes (id, class_name, teacher_name, default_academic_term, is_double_period, created_by)
values
  ('93000000-0000-4000-8000-000000000010', 'Editable Seminar', 'Ms. Original', 'full_year', false, '10000000-0000-4000-8000-000000000001'),
  ('93000000-0000-4000-8000-000000000011', 'Conflict Seminar', 'Mr. Conflict', 'full_year', false, '10000000-0000-4000-8000-000000000001');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('93000000-0000-4000-8000-000000000010', 'A', 3),
  ('93000000-0000-4000-8000-000000000010', 'B', 3),
  ('93000000-0000-4000-8000-000000000011', 'A', 7);

insert into public.class_enrollments (student_id, class_id, academic_term)
values
  ('10000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000010', 'full_year'),
  ('10000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000011', 'full_year');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*) from public.search_reportable_users('Alex Morgan', null, 20)),
  1::bigint,
  'a regular user can find a visible report target by name'
);
select is(
  (select count(*) from public.search_reportable_users('Hidden Report Target', null, 20)),
  0::bigint,
  'a private unrelated user is not exposed by the report selector'
);
select lives_ok(
  $$select public.create_report(
    'suspicious_user',
    'Full report explanation visible to administrators.',
    '10000000-0000-4000-8000-000000000003',
    null
  )$$,
  'a report can target a selected visible user'
);
select throws_ok(
  $$select public.create_report(
    'suspicious_user', 'Missing user', '93000000-0000-4000-8000-000000000099', null
  )$$,
  'P0002',
  'reported_user_not_found',
  'a nonexistent account cannot be reported'
);
select throws_ok(
  $$select public.create_report(
    'suspicious_user', 'Hidden user', '93000000-0000-4000-8000-000000000001', null
  )$$,
  'P0002',
  'reported_user_not_found',
  'a user whose name is not visible cannot be selected by ID'
);
select throws_ok(
  $$select public.create_report(
    'suspicious_user', 'Self report', '10000000-0000-4000-8000-000000000002', null
  )$$,
  '23514',
  'cannot_report_self',
  'users cannot report themselves'
);
select lives_ok(
  $$select public.create_class_and_enroll(
    'Period Nine Study',
    'Dr. Flexible',
    'full_year',
    false,
    '[{"day_type":"A","period_number":9},{"day_type":"B","period_number":9}]'::jsonb,
    true
  )$$,
  'a class can be created at period nine on both A and B days'
);
select is(
  (select count(*) from public.class_meeting_slots s join public.classes c on c.id = s.class_id where c.class_name = 'Period Nine Study'),
  2::bigint,
  'both default meeting-day slots are stored'
);
select is(
  (select count(*) from public.search_classes('Period Nine Study', 'A'::public.day_type, 9::smallint, 20)),
  1::bigint,
  'A-day search matches a class that meets on both days'
);
select is(
  (select count(*) from public.search_classes('Period Nine Study', 'B'::public.day_type, 9::smallint, 20)),
  1::bigint,
  'B-day search matches a class that meets on both days'
);
select throws_ok(
  $$select public.create_class_and_enroll(
    'Invalid Single Class',
    'Dr. Invalid',
    'full_year',
    false,
    '[{"day_type":"A","period_number":5},{"day_type":"A","period_number":6}]'::jsonb,
    true
  )$$,
  '23514',
  'single_period_requires_one_slot_per_day',
  'a single-period class cannot contain two slots on one day'
);
select throws_ok(
  $$select * from public.admin_list_reports()$$,
  '42501',
  'administrator_access_required',
  'regular users cannot read the administrative report details RPC'
);
select throws_ok(
  $$select public.admin_update_class(
    '93000000-0000-4000-8000-000000000010',
    'Unauthorized Edit',
    'Ms. Original',
    'full_year',
    false,
    '[{"day_type":"A","period_number":3},{"day_type":"B","period_number":3}]'::jsonb,
    'Unauthorized edit'
  )$$,
  '42501',
  'administrator_access_required',
  'regular users cannot execute class edits'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select count(*) from public.reports where explanation = 'Full report explanation visible to administrators.'),
  0::bigint,
  'the reported user cannot read the report contents'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select explanation from public.admin_list_reports() where reporter_name = 'Jordan Smith' limit 1),
  'Full report explanation visible to administrators.',
  'administrators receive the full submitted report text'
);
select is(
  (select reporter_name || ' -> ' || reported_user_name from public.admin_list_reports() where reporter_name = 'Jordan Smith' limit 1),
  'Jordan Smith -> Alex Morgan',
  'administrative report data includes human-readable reporter and target names'
);
select lives_ok(
  $$select public.admin_update_class(
    '93000000-0000-4000-8000-000000000010',
    'Edited Seminar',
    'Dr. Updated',
    'semester_1',
    false,
    '[{"day_type":"A","period_number":6},{"day_type":"B","period_number":6}]'::jsonb,
    'Corrected class details'
  )$$,
  'an administrator can atomically edit an active class'
);
select is(
  (select id from public.classes where class_name = 'Edited Seminar'),
  '93000000-0000-4000-8000-000000000010'::uuid,
  'class editing preserves the shared class ID'
);
select is(
  (select count(*) from public.class_meeting_slots where class_id = '93000000-0000-4000-8000-000000000010' and period_number = 6),
  2::bigint,
  'class editing replaces both A-day and B-day slots'
);
select ok(
  exists (select 1 from public.audit_logs where action_type = 'class_edited' and target_id = '93000000-0000-4000-8000-000000000010'),
  'class editing writes the immutable audit log'
);
select ok(
  exists (select 1 from public.schedule_change_history where student_id = '10000000-0000-4000-8000-000000000003' and action = 'meeting_slots_changed'),
  'class editing records history for affected active enrollments'
);
select throws_ok(
  $$select public.admin_update_class(
    '93000000-0000-4000-8000-000000000010',
    'Edited Seminar',
    'Dr. Updated',
    'semester_1',
    true,
    '[{"day_type":"A","period_number":6}]'::jsonb,
    'Invalid double-period edit'
  )$$,
  '23514',
  'double_period_requires_two_consecutive_slots_per_day',
  'invalid double-period combinations are rejected'
);
select throws_ok(
  $$select public.admin_update_class(
    '93000000-0000-4000-8000-000000000010',
    'Edited Seminar',
    'Dr. Updated',
    'semester_1',
    false,
    '[{"day_type":"A","period_number":7},{"day_type":"B","period_number":6}]'::jsonb,
    'Conflicting meeting-slot edit'
  )$$,
  '23514',
  'class_edit_schedule_conflict',
  'an edit that conflicts with an enrolled student schedule is rejected'
);
select is(
  (select jsonb_array_length(meeting_slots) from public.admin_list_classes() where class_id = '93000000-0000-4000-8000-000000000010'),
  2,
  'the admin class list returns the current meeting slots for form prefill'
);

select * from finish();
rollback;
