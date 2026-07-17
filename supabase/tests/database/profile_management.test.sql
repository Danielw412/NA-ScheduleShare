begin;
select plan(14);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'profile-owner@test.local', '', now(), '{}', '{"full_name":"Profile Owner"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'profile-other@test.local', '', now(), '{}', '{"full_name":"Other Student"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'classmates'
where id in ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000002');

insert into public.course_names (id, name, normalized_name, source)
values ('98000000-0000-4000-8000-000000000010', 'Profile Cleanup Course', 'profile cleanup course', 'admin');
insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
values ('98000000-0000-4000-8000-000000000011', '98000000-0000-4000-8000-000000000010', 'Cleanup', 'full_year', false, '98000000-0000-4000-8000-000000000001');
insert into public.class_meeting_slots (class_id, day_type, period_number)
values ('98000000-0000-4000-8000-000000000011', 'A', 1);
insert into public.class_enrollments (student_id, class_id, academic_term)
values ('98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000011', 'full_year');
insert into public.schedule_change_history (student_id, action, changed_by)
values ('98000000-0000-4000-8000-000000000001', 'class_added', '98000000-0000-4000-8000-000000000001');
insert into public.reports (reporter_id, reason_category, explanation)
values ('98000000-0000-4000-8000-000000000001', 'other', 'Account deletion anonymization test');

insert into storage.objects (bucket_id, name)
values ('profile-pictures', '98000000-0000-4000-8000-000000000002/avatar');

select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

update public.profiles
set full_name = 'Updated Profile Owner', privacy_setting = 'school'
where id = '98000000-0000-4000-8000-000000000001';

select is(
  (select full_name from public.profiles where id = '98000000-0000-4000-8000-000000000001'),
  'Updated Profile Owner',
  'a user can update their own full name'
);
select is(
  (select privacy_setting::text from public.profiles where id = '98000000-0000-4000-8000-000000000001'),
  'school',
  'a user can update their own existing privacy setting'
);

update public.profiles
set full_name = 'Forged Name', privacy_setting = 'private'
where id = '98000000-0000-4000-8000-000000000002';

reset role;
select is(
  (select full_name from public.profiles where id = '98000000-0000-4000-8000-000000000002'),
  'Other Student',
  'a user cannot edit another profile'
);

set local role authenticated;
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('profile-pictures', '98000000-0000-4000-8000-000000000001/avatar')$$,
  'a user can create their own fixed avatar object'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'profile-pictures' and name = '98000000-0000-4000-8000-000000000001/avatar'),
  1::bigint,
  'the own avatar object is stored'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('profile-pictures', '98000000-0000-4000-8000-000000000009/avatar')$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a user cannot upload an avatar for another account'
);

delete from storage.objects
where bucket_id = 'profile-pictures'
  and name = '98000000-0000-4000-8000-000000000002/avatar';

reset role;
select is(
  (select count(*) from storage.objects where bucket_id = 'profile-pictures' and name = '98000000-0000-4000-8000-000000000002/avatar'),
  1::bigint,
  'a user cannot remove another profile picture'
);

set local role authenticated;
select lives_ok(
  $$delete from storage.objects where bucket_id = 'profile-pictures' and name = '98000000-0000-4000-8000-000000000001/avatar'$$,
  'a user can remove their own profile picture'
);
reset role;
select is(
  (select count(*) from storage.objects where bucket_id = 'profile-pictures' and name = '98000000-0000-4000-8000-000000000001/avatar'),
  0::bigint,
  'the removed avatar no longer has Storage metadata'
);

delete from auth.users where id = '98000000-0000-4000-8000-000000000001';
select is((select count(*) from auth.users where id = '98000000-0000-4000-8000-000000000001'), 0::bigint, 'Auth deletion removes the authentication account');
select is((select count(*) from public.profiles where id = '98000000-0000-4000-8000-000000000001'), 0::bigint, 'Auth deletion cascades to the profile');
select is((select count(*) from public.class_enrollments where student_id = '98000000-0000-4000-8000-000000000001'), 0::bigint, 'Auth deletion cascades to schedule enrollments');
select is((select count(*) from public.schedule_change_history where student_id is null and changed_by is null), 1::bigint, 'immutable schedule history is anonymized');
select is((select count(*) from public.reports where reporter_id is null and explanation = 'Account deletion anonymization test'), 1::bigint, 'reports are retained with the deleted reporter anonymized');

select * from finish();
rollback;
