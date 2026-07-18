begin;
select plan(20);

-- Test identities
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'private@test.local', '', now(), '{}', '{"full_name":"Private Student"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'viewer@test.local', '', now(), '{}', '{"full_name":"Classmate Viewer"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'outsider@test.local', '', now(), '{}', '{"full_name":"Outside Student"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'admin@test.local', '', now(), '{}', '{"full_name":"Test Admin"}', now(), now(), '', '', '', '', '');

update public.profiles set grade = 11, onboarding_completed = true, privacy_setting = 'private' where id = '90000000-0000-4000-8000-000000000001';
update public.profiles set grade = 11, onboarding_completed = true, privacy_setting = 'school' where id in ('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000004');
insert into private.user_roles (user_id, role, granted_by) values ('90000000-0000-4000-8000-000000000004', 'administrator', '90000000-0000-4000-8000-000000000004');

insert into public.course_names (id, name, normalized_name, source)
values
  ('91000000-0000-4000-8000-000000000011', 'Shared Biology', 'shared biology', 'admin'),
  ('91000000-0000-4000-8000-000000000012', 'Private Elective', 'private elective', 'admin'),
  ('91000000-0000-4000-8000-000000000013', 'Canonical Chemistry', 'canonical chemistry', 'admin'),
  ('91000000-0000-4000-8000-000000000014', 'Chemistry Duplicate', 'chemistry duplicate', 'admin');

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
values
  ('91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'Green', 'full_year', false, '90000000-0000-4000-8000-000000000004'),
  ('91000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000012', 'Blue', 'full_year', false, '90000000-0000-4000-8000-000000000004'),
  ('91000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000013', 'Gold', 'full_year', false, '90000000-0000-4000-8000-000000000004'),
  ('91000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000014', 'Gold', 'full_year', false, '90000000-0000-4000-8000-000000000004');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('91000000-0000-4000-8000-000000000001', 'A', 1),
  ('91000000-0000-4000-8000-000000000002', 'B', 2),
  ('91000000-0000-4000-8000-000000000003', 'A', 3),
  ('91000000-0000-4000-8000-000000000004', 'A', 3);

insert into public.class_enrollments (student_id, class_id, academic_term)
values
  ('90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'full_year'),
  ('90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'full_year'),
  ('90000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'full_year'),
  ('90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000003', 'full_year'),
  ('90000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000004', 'full_year');

-- Private full schedule RPC is denied.
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select * from public.get_visible_schedule('90000000-0000-4000-8000-000000000001')$$,
  '42501',
  'schedule_not_visible',
  'a private user full schedule cannot be read by a classmate'
);

-- Direct enrollment queries do not expose even a shared row for a Private owner.
select is(
  (select count(*) from public.class_enrollments where student_id = '90000000-0000-4000-8000-000000000001'),
  0::bigint,
  'direct enrollment queries do not reveal a shared class for a Private user'
);
select is(
  (select full_name from public.search_student_directory('Private', null, null, null) where student_id = '90000000-0000-4000-8000-000000000001'),
  'Private'::text,
  'the directory exposes only a Private student first name'
);
select is(
  (select can_view_schedule from public.search_student_directory('Private', null, null, null) where student_id = '90000000-0000-4000-8000-000000000001'),
  false,
  'the directory does not offer a Private student schedule'
);
select is(
  (select count(*) from public.search_student_directory('Student', null, null, null) where student_id = '90000000-0000-4000-8000-000000000001'),
  0::bigint,
  'a hidden last name cannot be used to find a Private student'
);
select is(
  (select count(*) from public.search_student_directory(null, null, 'Private Elective', null) where student_id = '90000000-0000-4000-8000-000000000001'),
  0::bigint,
  'course filters cannot reveal a Private student schedule'
);

reset role;
update public.profiles set privacy_setting = 'classmates' where id = '90000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(
  (select count(*) from public.class_enrollments where student_id = '90000000-0000-4000-8000-000000000001'),
  3::bigint,
  'a classmate can view a Classmates-visible full schedule'
);

reset role;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select count(*) from public.class_enrollments where student_id = '90000000-0000-4000-8000-000000000001'),
  0::bigint,
  'a non-classmate cannot view a Classmates-visible schedule'
);

reset role;
update public.profiles set privacy_setting = 'school' where id = '90000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(
  (select count(*) from public.class_enrollments where student_id = '90000000-0000-4000-8000-000000000001'),
  3::bigint,
  'any signed-in active user can view a School-visible schedule'
);

reset role;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.search_student_directory('Private Student', null, '', '') where student_id = '90000000-0000-4000-8000-000000000001'),
  1::bigint,
  'an Anyone privacy change is reflected immediately in student search'
);
select is(
  (select count(*) from public.get_classmates() where student_id = '90000000-0000-4000-8000-000000000001'),
  1::bigint,
  'an Anyone privacy change is reflected immediately in shared-class discovery'
);
select is(
  (select count(*) from public.get_class_members('91000000-0000-4000-8000-000000000001') where student_id = '90000000-0000-4000-8000-000000000001'),
  1::bigint,
  'an Anyone privacy change is reflected immediately in class rosters'
);

reset role;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', true);
update private.account_moderation set suspended_at = now(), suspended_by = '90000000-0000-4000-8000-000000000004', suspension_reason = 'Test suspension' where user_id = '90000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.profiles), 0::bigint, 'a suspended user cannot read protected profile data');
select is((select count(*) from public.classes), 0::bigint, 'a suspended user cannot read protected class data');

reset role;
update private.account_moderation set suspended_at = null, suspended_by = null, suspension_reason = null where user_id = '90000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok(
  $$select public.admin_suspend_user('90000000-0000-4000-8000-000000000002', 'Unauthorized attempt')$$,
  '42501',
  'administrator_access_required',
  'normal users cannot call administrative operations'
);
select throws_ok(
  $$select public.admin_promote_user('90000000-0000-4000-8000-000000000003', 'Self promotion')$$,
  '42501',
  'administrator_access_required',
  'users cannot promote themselves'
);
select throws_ok(
  $$insert into private.user_roles (user_id, role) values ('90000000-0000-4000-8000-000000000003', 'administrator')$$,
  '42501',
  'permission denied for table user_roles',
  'direct role-table writes are denied'
);

reset role;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select lives_ok(
  $$select public.admin_merge_classes('91000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000004', 'Privacy test merge')$$,
  'an administrator can run the transactional merge function'
);
reset role;
select is(
  (select count(*) from public.class_enrollments where class_id = '91000000-0000-4000-8000-000000000003'),
  2::bigint,
  'class merge preserves both students and avoids duplicate canonical enrollments'
);
select is(
  (select status::text from public.classes where id = '91000000-0000-4000-8000-000000000004'),
  'merged',
  'duplicate class is archived as merged'
);

select * from finish();
rollback;
