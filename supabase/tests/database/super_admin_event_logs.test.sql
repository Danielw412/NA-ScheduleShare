begin;
select plan(22);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'danielruoqiao@gmail.com', '', now(), '{}', '{"full_name":"Daniel Super"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'normal-admin@test.local', '', now(), '{}', '{"full_name":"Normal Admin"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '97000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'elevated-target@test.local', '', now(), '{}', '{"full_name":"Elevated Target"}', now(), now(), '', '', '', '', '');

update public.profiles set grade = 11, onboarding_completed = true
where id in ('97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000003');
insert into private.user_roles (user_id, role, granted_by)
values ('97000000-0000-4000-8000-000000000002', 'administrator', '97000000-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(public.is_current_user_super_admin(), false, 'an ordinary administrator is not elevated');
select throws_ok(
  $$select * from public.super_admin_list_logs()$$,
  '42501', 'elevated_administrator_access_required',
  'ordinary administrators cannot view the protected logs'
);
select throws_ok(
  $$select count(*) from public.event_logs$$,
  '42501', 'permission denied for table event_logs',
  'event logs cannot be queried directly'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(public.is_current_user_super_admin(), true, 'the bootstrap email has elevated access without a browser-visible role');
select lives_ok(
  $$select public.super_admin_add('elevated-target@test.local')$$,
  'the bootstrap account can grant protected access by exact email'
);
select cmp_ok(
  (select count(*) from public.super_admin_list_logs(p_event => 'account_created')),
  '>=', 3::bigint,
  'account creation events are available in the protected log feed'
);
select cmp_ok(
  (select count(*) from public.super_admin_list_logs(p_user => 'Elevated Target')),
  '>=', 1::bigint,
  'logs can be filtered by user name'
);
select cmp_ok(
  (select count(*) from public.super_admin_list_logs(p_user => '97000000-0000-4000-8000-000000000003')),
  '>=', 1::bigint,
  'logs can be filtered by exact user ID'
);
select lives_ok(
  $$select * from public.super_admin_get_site_reset_preview()$$,
  'the protected reset preview is available without changing data'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(public.is_current_user_super_admin(), true, 'newly granted protected access is enforced by the database');
select throws_ok(
  $$select public.service_reset_site_data('97000000-0000-4000-8000-000000000003', 'RESET SCHEDULESHARE KEEP MY ADMIN ACCOUNT AND COURSE NAMES')$$,
  '42501', 'permission denied for function service_reset_site_data',
  'the destructive reset implementation is callable only by the service role Edge Function'
);

reset role;
insert into public.course_names (
  id, name, normalized_name, source, created_by
) values (
  '97000000-0000-4000-8000-000000000004',
  'Reset Preserved Course',
  'reset preserved course',
  'approved',
  '97000000-0000-4000-8000-000000000003'
);
create temporary table site_reset_expectations as
select
  (select count(*) from public.course_names)::bigint as course_name_count,
  (
    select count(*)
    from auth.users
    where id <> '97000000-0000-4000-8000-000000000003'
  )::bigint as account_deletion_count;
grant select on site_reset_expectations to authenticated;

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select accounts from public.super_admin_get_site_reset_preview()),
  (select account_deletion_count from site_reset_expectations),
  'the reset preview excludes the retained administrator account from account deletions'
);
select is(
  (select course_names from public.super_admin_get_site_reset_preview()),
  0::bigint,
  'the reset preview reports that no course names will be deleted'
);

reset role;
set local role service_role;
select lives_ok(
  $$select public.service_reset_site_data('97000000-0000-4000-8000-000000000003', 'RESET SCHEDULESHARE KEEP MY ADMIN ACCOUNT AND COURSE NAMES')$$,
  'the service role can complete the reset'
);
reset role;
select is((select count(*) from auth.users), 1::bigint, 'all other Auth accounts are deleted');
select ok(
  exists (select 1 from auth.users where id = '97000000-0000-4000-8000-000000000003'),
  'the resetting administrator Auth account remains'
);
select is(
  (select count(*) from public.course_names),
  (select course_name_count from site_reset_expectations),
  'the full course-name catalog remains'
);
select ok(
  exists (
    select 1
    from public.course_names
    where id = '97000000-0000-4000-8000-000000000004'
  ),
  'course names created before the reset remain available'
);
select is((select count(*) from public.classes), 0::bigint, 'class sections are removed');
select ok(
  exists (
    select 1
    from public.profiles
    where id = '97000000-0000-4000-8000-000000000003'
      and full_name = 'Elevated Target'
      and grade is null
      and privacy_setting = 'classmates'
      and not onboarding_completed
      and students_visited_at is null
      and last_login_at is null
      and last_active_at is null
  ),
  'the retained administrator profile returns to first-run state'
);
select ok(
  exists (
    select 1
    from private.user_roles
    where user_id = '97000000-0000-4000-8000-000000000003'
      and role = 'administrator'
  ),
  'the retained account remains an administrator'
);
select ok(
  exists (
    select 1
    from private.super_admins
    where user_id = '97000000-0000-4000-8000-000000000003'
  ),
  'the retained account keeps protected reset permissions'
);

select * from finish();
rollback;
