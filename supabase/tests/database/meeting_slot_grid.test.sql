begin;
select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '94000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'meeting-slots@test.local', '', now(), '{}',
  '{"full_name":"Meeting Slot Tester"}', now(), now(), '', '', '', '', ''
);

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'private'
where id = '94000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select public.create_class_and_enroll(null, 'Grid One Both', 'Grid', 'full_year', false,
    '[{"day_type":"A","period_number":4},{"day_type":"B","period_number":4}]'::jsonb, true)$$,
  'one period on both days can be created'
);
select is(
  (select string_agg(s.day_type::text || s.period_number::text, ',' order by s.day_type, s.period_number)
   from public.class_meeting_slots s join public.classes c on c.id = s.class_id join public.course_names cn on cn.id = c.course_name_id
   where cn.name = 'Grid One Both'),
  'A4,B4',
  'one period on both days is stored as two explicit slots'
);
select public.remove_enrollment((select e.id from public.class_enrollments e join public.classes c on c.id = e.class_id join public.course_names cn on cn.id = c.course_name_id where e.active and cn.name = 'Grid One Both'));

select lives_ok(
  $$select public.create_class_and_enroll(null, 'Grid Two Both', 'Grid', 'full_year', true,
    '[{"day_type":"A","period_number":3},{"day_type":"A","period_number":4},{"day_type":"B","period_number":3},{"day_type":"B","period_number":4}]'::jsonb, true)$$,
  'two periods on both days can be created'
);
select is(
  (select string_agg(s.day_type::text || s.period_number::text, ',' order by s.day_type, s.period_number)
   from public.class_meeting_slots s join public.classes c on c.id = s.class_id join public.course_names cn on cn.id = c.course_name_id
   where cn.name = 'Grid Two Both'),
  'A3,A4,B3,B4',
  'two periods on both days are stored explicitly'
);
select public.remove_enrollment((select e.id from public.class_enrollments e join public.classes c on c.id = e.class_id join public.course_names cn on cn.id = c.course_name_id where e.active and cn.name = 'Grid Two Both'));

select lives_ok(
  $$select public.create_class_and_enroll(null, 'Grid Asymmetric', 'Grid', 'full_year', true,
    '[{"day_type":"A","period_number":4},{"day_type":"B","period_number":3},{"day_type":"B","period_number":4}]'::jsonb, true)$$,
  'A-day period 4 and B-day periods 3 and 4 can be created'
);
select is(
  (select string_agg(s.day_type::text || s.period_number::text, ',' order by s.day_type, s.period_number)
   from public.class_meeting_slots s join public.classes c on c.id = s.class_id join public.course_names cn on cn.id = c.course_name_id
   where cn.name = 'Grid Asymmetric'),
  'A4,B3,B4',
  'different A-day and B-day periods remain independent'
);
select public.remove_enrollment((select e.id from public.class_enrollments e join public.classes c on c.id = e.class_id join public.course_names cn on cn.id = c.course_name_id where e.active and cn.name = 'Grid Asymmetric'));

select lives_ok(
  $$select public.create_class_and_enroll(null, 'Grid A Only', 'Grid', 'full_year', false,
    '[{"day_type":"A","period_number":6}]'::jsonb, true)$$,
  'an A-day-only class can be created'
);
select is(
  (select string_agg(s.day_type::text || s.period_number::text, ',' order by s.day_type, s.period_number)
   from public.class_meeting_slots s join public.classes c on c.id = s.class_id join public.course_names cn on cn.id = c.course_name_id
   where cn.name = 'Grid A Only'),
  'A6',
  'an A-day-only class stores only its selected A slot'
);
select public.remove_enrollment((select e.id from public.class_enrollments e join public.classes c on c.id = e.class_id join public.course_names cn on cn.id = c.course_name_id where e.active and cn.name = 'Grid A Only'));

select lives_ok(
  $$select public.create_class_and_enroll(null, 'Grid B Only', 'Grid', 'full_year', false,
    '[{"day_type":"B","period_number":7}]'::jsonb, true)$$,
  'a B-day-only class can be created'
);
select is(
  (select string_agg(s.day_type::text || s.period_number::text, ',' order by s.day_type, s.period_number)
   from public.class_meeting_slots s join public.classes c on c.id = s.class_id join public.course_names cn on cn.id = c.course_name_id
   where cn.name = 'Grid B Only'),
  'B7',
  'a B-day-only class stores only its selected B slot'
);
select public.remove_enrollment((select e.id from public.class_enrollments e join public.classes c on c.id = e.class_id join public.course_names cn on cn.id = c.course_name_id where e.active and cn.name = 'Grid B Only'));

select throws_ok(
  $$select public.create_class_and_enroll(null, 'Grid Nonconsecutive', 'Grid', 'full_year', true,
    '[{"day_type":"A","period_number":2},{"day_type":"A","period_number":5}]'::jsonb, true)$$,
  '23514',
  'double_period_slots_not_consecutive',
  'double-period slots must be consecutive on a day'
);
select throws_ok(
  $$select public.create_class_and_enroll(null, 'Grid Normal Multiple', 'Grid', 'full_year', false,
    '[{"day_type":"A","period_number":2},{"day_type":"A","period_number":3}]'::jsonb, true)$$,
  '23514',
  'normal_class_multiple_periods',
  'normal classes cannot use multiple periods on one day'
);

select throws_ok(
  $$select public.create_class_and_enroll(null, 'Grid Empty', 'Grid', 'full_year', false, '[]'::jsonb, true)$$,
  '23514',
  'meeting_slots_required',
  'at least one meeting slot is required'
);
reset role;
select is(
  (select c.is_double_period from public.classes c join public.course_names cn on cn.id = c.course_name_id where cn.name = 'Grid Two Both'),
  true,
  'legacy multiple-period metadata is derived from explicit slots'
);

insert into public.course_names (id, name, normalized_name, source)
values ('94000000-0000-4000-8000-000000000020', 'Grid Editable', 'grid editable', 'admin');
insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
values ('94000000-0000-4000-8000-000000000010', '94000000-0000-4000-8000-000000000020', 'Original', 'full_year', false, '10000000-0000-4000-8000-000000000001');
insert into public.class_meeting_slots (class_id, day_type, period_number)
values ('94000000-0000-4000-8000-000000000010', 'A', 1);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select jsonb_array_length(meeting_slots) from public.admin_list_classes() where class_id = '20000000-0000-4000-8000-000000000004'),
  4,
  'an existing double-period class loads all of its current slots for editing'
);
select is(
  (select is_double_period from public.admin_list_classes() where class_id = '20000000-0000-4000-8000-000000000004'),
  true,
  'existing double-period compatibility metadata remains available'
);
select lives_ok(
  $$select public.admin_update_class(
    '94000000-0000-4000-8000-000000000010',
    '94000000-0000-4000-8000-000000000020',
    'Updated',
    'full_year',
    true,
    '[{"day_type":"A","period_number":4},{"day_type":"B","period_number":3},{"day_type":"B","period_number":4}]'::jsonb,
    'Test explicit meeting-slot edit'
  )$$,
  'editing a class accepts independent per-day meeting slots'
);
select is(
  (select string_agg(day_type::text || period_number::text, ',' order by day_type, period_number)
   from public.class_meeting_slots where class_id = '94000000-0000-4000-8000-000000000010'),
  'A4,B3,B4',
  'editing replaces the existing class slots exactly'
);
select is(
  (select is_double_period from public.classes where id = '94000000-0000-4000-8000-000000000010'),
  true,
  'editing synchronizes double-period metadata with independent slots'
);
select throws_ok(
  $$select public.admin_update_class(
    '20000000-0000-4000-8000-000000000004',
    (select course_name_id from public.classes where id = '20000000-0000-4000-8000-000000000004'),
    'Johnson',
    'full_year',
    true,
    '[{"day_type":"A","period_number":4},{"day_type":"B","period_number":3},{"day_type":"B","period_number":4}]'::jsonb,
    'Test conflict detection'
  )$$,
  '23514',
  'class_edit_schedule_conflict',
  'editing rejects any newly selected slot that conflicts with an enrolled student schedule'
);

select * from finish();
rollback;
