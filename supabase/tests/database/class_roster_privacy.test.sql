begin;
select plan(35);

-- Identities cover each privacy value, shared/non-shared viewers, an admin,
-- a suspended caller, a suspended roster member, and a user with no schedule.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current,
  email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'roster-viewer@test.local', '', now(), '{}', '{"full_name":"Roster Viewer"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'roster-anyone@test.local', '', now(), '{}', '{"full_name":"Anyone Student"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'roster-shared@test.local', '', now(), '{}', '{"full_name":"Shared Classmate"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'roster-unshared@test.local', '', now(), '{}', '{"full_name":"Unshared Classmate"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'roster-private@test.local', '', now(), '{}', '{"full_name":"Private Student"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'roster-admin@test.local', '', now(), '{}', '{"full_name":"Roster Admin"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'roster-suspended-viewer@test.local', '', now(), '{}', '{"full_name":"Suspended Viewer"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'roster-suspended-member@test.local', '', now(), '{}', '{"full_name":"Suspended Member"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'roster-no-schedule@test.local', '', now(), '{}', '{"full_name":"No Schedule Viewer"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'school'
where id in (
  '93000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000002',
  '93000000-0000-4000-8000-000000000006',
  '93000000-0000-4000-8000-000000000007',
  '93000000-0000-4000-8000-000000000008',
  '93000000-0000-4000-8000-000000000009'
);

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'classmates'
where id in (
  '93000000-0000-4000-8000-000000000003',
  '93000000-0000-4000-8000-000000000004'
);

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'private'
where id = '93000000-0000-4000-8000-000000000005';

insert into private.user_roles (user_id, role, granted_by)
values (
  '93000000-0000-4000-8000-000000000006',
  'administrator',
  '93000000-0000-4000-8000-000000000006'
);

update private.account_moderation
set suspended_at = now(),
    suspended_by = '93000000-0000-4000-8000-000000000006',
    suspension_reason = 'Roster caller regression test'
where user_id = '93000000-0000-4000-8000-000000000007';

update private.account_moderation
set suspended_at = now(),
    suspended_by = '93000000-0000-4000-8000-000000000006',
    suspension_reason = 'Roster member regression test'
where user_id = '93000000-0000-4000-8000-000000000008';

insert into public.course_names (id, name, normalized_name, source)
values
  ('93100000-0000-4000-8000-000000000001', 'Roster Physics', 'roster physics', 'admin'),
  ('93100000-0000-4000-8000-000000000002', 'Roster Math', 'roster math', 'admin'),
  ('93100000-0000-4000-8000-000000000003', 'Roster English', 'roster english', 'admin'),
  ('93100000-0000-4000-8000-000000000004', 'Roster Chemistry', 'roster chemistry', 'admin');

insert into public.classes (
  id, course_name_id, teacher_last_name, default_academic_term,
  is_double_period, created_by
) values
  ('93200000-0000-4000-8000-000000000001', '93100000-0000-4000-8000-000000000001', 'Newton', 'full_year', false, '93000000-0000-4000-8000-000000000006'),
  ('93200000-0000-4000-8000-000000000002', '93100000-0000-4000-8000-000000000002', 'Noether', 'full_year', false, '93000000-0000-4000-8000-000000000006'),
  ('93200000-0000-4000-8000-000000000003', '93100000-0000-4000-8000-000000000003', 'Angelou', 'full_year', false, '93000000-0000-4000-8000-000000000006'),
  ('93200000-0000-4000-8000-000000000004', '93100000-0000-4000-8000-000000000004', 'Curie', 'full_year', false, '93000000-0000-4000-8000-000000000006');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('93200000-0000-4000-8000-000000000001', 'A', 1),
  ('93200000-0000-4000-8000-000000000002', 'A', 2),
  ('93200000-0000-4000-8000-000000000003', 'B', 3),
  ('93200000-0000-4000-8000-000000000004', 'B', 4);

insert into public.class_enrollments (student_id, class_id, academic_term)
values
  -- Physics creates the viewer/Classmates relationship. The Private student also
  -- shares Physics so the old same-class bypass is exercised directly.
  ('93000000-0000-4000-8000-000000000001', '93200000-0000-4000-8000-000000000001', 'full_year'),
  ('93000000-0000-4000-8000-000000000003', '93200000-0000-4000-8000-000000000001', 'full_year'),
  ('93000000-0000-4000-8000-000000000005', '93200000-0000-4000-8000-000000000001', 'full_year'),
  -- Math proves that sharing Physics authorizes the Classmates student here too.
  ('93000000-0000-4000-8000-000000000003', '93200000-0000-4000-8000-000000000002', 'full_year'),
  ('93000000-0000-4000-8000-000000000002', '93200000-0000-4000-8000-000000000002', 'full_year'),
  ('93000000-0000-4000-8000-000000000005', '93200000-0000-4000-8000-000000000002', 'full_year'),
  ('93000000-0000-4000-8000-000000000008', '93200000-0000-4000-8000-000000000002', 'full_year'),
  -- This Classmates student has no relationship with the main viewer.
  ('93000000-0000-4000-8000-000000000004', '93200000-0000-4000-8000-000000000003', 'full_year');

-- Inactive history is not part of a roster or visible schedule.
insert into public.class_enrollments (student_id, class_id, academic_term, active)
values
  ('93000000-0000-4000-8000-000000000002', '93200000-0000-4000-8000-000000000004', 'full_year', false);

-- A regular viewer who shares Physics with the Classmates student.
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000002')),
  2::bigint,
  'Math roster contains the shared Classmates student and the Anyone student'
);
select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000002') where student_id = '93000000-0000-4000-8000-000000000003'),
  1::bigint,
  'sharing Physics makes the Classmates student visible in their Math roster'
);
select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000002') where student_id = '93000000-0000-4000-8000-000000000005'),
  0::bigint,
  'Private students are hidden from a regular-user Math roster'
);
select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000002') where student_id = '93000000-0000-4000-8000-000000000008'),
  0::bigint,
  'suspended students are hidden from regular-user rosters'
);
select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000001')),
  3::bigint,
  'a shared-class roster identifies the viewer, Classmates student, and Private classmate'
);
select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000003')),
  0::bigint,
  'a non-shared Classmates student is hidden from their roster'
);
select is(
  (select count(*) from public.class_enrollments where student_id = '93000000-0000-4000-8000-000000000003'),
  2::bigint,
  'direct API reads expose every enrollment owned by a shared Classmates student'
);
select is(
  (select count(*) from public.class_enrollments where student_id = '93000000-0000-4000-8000-000000000005'),
  0::bigint,
  'direct API reads cannot use a shared class to expose Private enrollments'
);
select is(
  (select count(*) from public.class_enrollments where student_id = '93000000-0000-4000-8000-000000000002'),
  1::bigint,
  'direct API reads expose only active Anyone enrollment rows to regular users'
);
select is(
  (select count(*) from public.profiles where id = '93000000-0000-4000-8000-000000000005'),
  0::bigint,
  'direct profile reads hide a Private student even when a class is shared'
);
select is(
  (select count(*) from public.get_classmates() where student_id = '93000000-0000-4000-8000-000000000003'),
  1::bigint,
  'the Classmates endpoint includes a shared Classmates student'
);
select is(
  (select count(*) from public.get_classmates() where student_id = '93000000-0000-4000-8000-000000000005'),
  1::bigint,
  'the Classmates endpoint identifies a shared Private student without exposing their schedule'
);
select is(
  (select count(*) from public.search_student_directory('', null::smallint, null::text, null::text) where student_id = '93000000-0000-4000-8000-000000000003'),
  1::bigint,
  'student directory applies the same shared-Classmates relationship'
);
select is(
  (select count(*) from public.search_reportable_users('', '93000000-0000-4000-8000-000000000005', 20)),
  0::bigint,
  'reportable-user search cannot reveal a Private student'
);
select throws_ok(
  $$select public.create_report('suspicious_user', 'Hidden target probe', '93000000-0000-4000-8000-000000000005', null)$$,
  'P0002',
  'reported_user_not_found',
  'the report RPC rejects a directly supplied hidden Private user ID'
);
select throws_ok(
  $$select * from public.get_visible_schedule('93000000-0000-4000-8000-000000000005')$$,
  '42501',
  'schedule_not_visible',
  'the schedule RPC cannot expose a Private student to a classmate'
);
select is(
  (select count(*) from public.classes where id::text like '93200000-%'),
  4::bigint,
  'active regular users can read basic information for every active class'
);

-- An active regular user with no schedule shares no classes with anyone.
reset role;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000009', true);
set local role authenticated;

select is(
  (select count(*) from public.classes where id::text like '93200000-%'),
  4::bigint,
  'a user without a schedule can still read basic class definitions'
);
select is(
  (select count(*) from public.class_meeting_slots where class_id::text like '93200000-%'),
  4::bigint,
  'a user without a schedule can still read class meeting slots'
);
select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000002')),
  1::bigint,
  'a non-classmate sees only the Anyone member in the Math roster'
);
select is(
  (select count(*) from public.class_enrollments where student_id = '93000000-0000-4000-8000-000000000003'),
  0::bigint,
  'direct API reads hide Classmates enrollments from a non-classmate'
);
select is(
  (select count(*) from public.profiles where id = '93000000-0000-4000-8000-000000000003'),
  0::bigint,
  'direct profile reads hide a Classmates student from a non-classmate'
);
select throws_ok(
  $$select * from public.get_visible_schedule('93000000-0000-4000-8000-000000000003')$$,
  '42501',
  'schedule_not_visible',
  'the schedule RPC hides a Classmates schedule from a non-classmate'
);

-- Admins can inspect every active enrollment owner, including Private and
-- suspended members, through both the roster RPC and direct API.
reset role;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000006', true);
set local role authenticated;

select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000002')),
  4::bigint,
  'an admin sees every Math roster member'
);
select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000002') where student_id = '93000000-0000-4000-8000-000000000005'),
  1::bigint,
  'an admin sees Private roster members'
);
select is(
  (select count(*) from public.get_class_members('93200000-0000-4000-8000-000000000002') where student_id = '93000000-0000-4000-8000-000000000008'),
  1::bigint,
  'an admin sees suspended roster members'
);
select is(
  (select count(*) from public.class_enrollments where class_id::text like '93200000-%'),
  9::bigint,
  'an admin direct API read sees active enrollments and inactive history'
);
select is(
  (select count(*) from public.get_visible_schedule('93000000-0000-4000-8000-000000000005')),
  2::bigint,
  'an admin can view a Private member full schedule'
);
select is(
  (select count(*) from public.get_visible_schedule('93000000-0000-4000-8000-000000000008')),
  1::bigint,
  'an admin can view a suspended member full schedule'
);

-- Suspension is enforced for both RPC and direct Data API paths.
reset role;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000007', true);
set local role authenticated;

select throws_ok(
  $$select * from public.get_class_members('93200000-0000-4000-8000-000000000002')$$,
  '42501',
  'active_account_required',
  'a suspended caller cannot invoke the roster RPC'
);
select is(
  (select count(*) from public.classes),
  0::bigint,
  'a suspended caller cannot read classes directly'
);
select is(
  (select count(*) from public.class_enrollments),
  0::bigint,
  'a suspended caller cannot read enrollments directly'
);
select is(
  (select count(*) from public.profiles),
  0::bigint,
  'a suspended caller cannot read profiles directly'
);

-- Anonymous Data API and RPC access remains ungranted.
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select throws_ok(
  $$select * from public.get_class_members('93200000-0000-4000-8000-000000000002')$$,
  '42501',
  'permission denied for function get_class_members',
  'anonymous callers cannot invoke the roster RPC'
);
select throws_ok(
  $$select count(*) from public.classes$$,
  '42501',
  'permission denied for table classes',
  'anonymous callers cannot read class definitions directly'
);

select * from finish();
rollback;
