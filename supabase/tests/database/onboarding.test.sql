begin;
select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '92000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'onboarding-active@test.local', '', now(), '{}', '{}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '92000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'onboarding-other@test.local', '', now(), '{}', '{}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '92000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'onboarding-suspended@test.local', '', now(), '{}', '{}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '92000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'onboarding-deleted@test.local', '', now(), '{}', '{}', now(), now(), '', '', '', '', '');

update private.account_moderation
set suspended_at = now(), suspension_reason = 'Onboarding suspension test'
where user_id = '92000000-0000-4000-8000-000000000003';

update private.account_moderation
set deleted_at = now()
where user_id = '92000000-0000-4000-8000-000000000004';

select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$update public.profiles
    set full_name = '  tAYLOR   STUDENT  ',
        grade = 10,
        privacy_setting = 'private',
        onboarding_completed = true
    where id = '92000000-0000-4000-8000-000000000001'$$,
  'an active authenticated user can complete onboarding for their own profile'
);

select is(
  (select full_name from public.profiles where id = '92000000-0000-4000-8000-000000000001'),
  'Taylor Student',
  'successful onboarding stores the normalized full name'
);
select is(
  (select normalized_name from public.profiles where id = '92000000-0000-4000-8000-000000000001'),
  'taylor student',
  'successful onboarding updates the database-controlled normalized name'
);
select is(
  (select grade from public.profiles where id = '92000000-0000-4000-8000-000000000001'),
  10::smallint,
  'successful onboarding stores the selected grade'
);
select is(
  (select privacy_setting::text from public.profiles where id = '92000000-0000-4000-8000-000000000001'),
  'private',
  'successful onboarding stores the selected privacy setting'
);
select ok(
  (select onboarding_completed from public.profiles where id = '92000000-0000-4000-8000-000000000001'),
  'successful onboarding marks onboarding_completed true'
);

update public.profiles
set full_name = 'Attempted Other User Update'
where id = '92000000-0000-4000-8000-000000000002';
reset role;
select is(
  (select full_name from public.profiles where id = '92000000-0000-4000-8000-000000000002'),
  'New Student',
  'an authenticated user cannot update another user profile'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;
select throws_ok(
  $$update public.profiles
    set full_name = 'Anonymous Update'
    where id = '92000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table profiles',
  'an unauthenticated request cannot update a profile'
);

reset role;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
update public.profiles
set full_name = 'Suspended Update'
where id = '92000000-0000-4000-8000-000000000003';
reset role;
select is(
  (select full_name from public.profiles where id = '92000000-0000-4000-8000-000000000003'),
  'New Student',
  'a suspended user cannot complete onboarding'
);

select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000004', true);
set local role authenticated;
update public.profiles
set full_name = 'Deleted Update'
where id = '92000000-0000-4000-8000-000000000004';
reset role;
select is(
  (select full_name from public.profiles where id = '92000000-0000-4000-8000-000000000004'),
  'New Student',
  'a deleted user cannot complete onboarding'
);

select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$update public.profiles set grade = 8 where id = '92000000-0000-4000-8000-000000000001'$$,
  '42501',
  'grade_changes_require_administrator',
  'an onboarded student cannot change their own grade'
);
select throws_ok(
  $$update public.profiles set privacy_setting = 'friends' where id = '92000000-0000-4000-8000-000000000001'$$,
  '22P02',
  'invalid input value for enum privacy_setting: "friends"',
  'an invalid privacy setting is rejected'
);
select throws_ok(
  $$update public.profiles set full_name = '   ' where id = '92000000-0000-4000-8000-000000000001'$$,
  '23514',
  'new row for relation "profiles" violates check constraint "profiles_full_name_check"',
  'a blank name is rejected after trimming'
);
select throws_ok(
  $$update public.profiles set full_name = 'A' where id = '92000000-0000-4000-8000-000000000001'$$,
  '23514',
  'new row for relation "profiles" violates check constraint "profiles_full_name_check"',
  'a one-character name is rejected'
);
select throws_ok(
  $$update public.profiles set full_name = repeat('a', 101) where id = '92000000-0000-4000-8000-000000000001'$$,
  '23514',
  'new row for relation "profiles" violates check constraint "profiles_full_name_check"',
  'a name longer than 100 characters is rejected'
);

select throws_ok(
  $$update public.profiles set id = '92000000-0000-4000-8000-000000000099' where id = '92000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table profiles',
  'onboarding cannot change the profile id'
);
select throws_ok(
  $$update public.profiles set normalized_name = 'forged' where id = '92000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table profiles',
  'onboarding cannot directly change the normalized name'
);
select throws_ok(
  $$update public.profiles set created_at = now() where id = '92000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table profiles',
  'onboarding cannot change created_at'
);
select throws_ok(
  $$update public.profiles set updated_at = now() where id = '92000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table profiles',
  'onboarding cannot directly change updated_at'
);

select * from finish();
rollback;
