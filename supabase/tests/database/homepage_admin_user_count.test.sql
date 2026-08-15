begin;
select plan(3);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '94100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'homepage-count-incomplete@test.local',
  '',
  now(),
  '{}',
  '{"full_name":"Homepage Count Test"}',
  now(),
  now(),
  '', '', '', '', ''
);

select is(
  (select onboarding_completed from public.profiles where id = '94100000-0000-4000-8000-000000000001'),
  false,
  'the fixture includes an account that has not completed onboarding'
);

update private.homepage_statistic_settings
set shown = true,
    statistic_key = 'students_joined',
    minimum_value = 0,
    activity_scope = 'total';

select is(
  (select statistic_value from public.get_homepage_statistic()),
  (select count(*) from public.profiles),
  'the homepage students-joined total matches the admin Users total source'
);

select cmp_ok(
  (select statistic_value from public.get_homepage_statistic()),
  '>',
  (select count(*)
   from public.profiles profile
   join private.account_moderation moderation on moderation.user_id = profile.id
   where profile.onboarding_completed
     and profile.grade is not null
     and moderation.suspended_at is null
     and moderation.deleted_at is null),
  'the homepage total no longer drops incomplete accounts that the admin Users total counts'
);

select * from finish();
rollback;
