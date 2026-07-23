begin;
select plan(11);

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
  $$select public.service_reset_site_data('97000000-0000-4000-8000-000000000003', 'RESET SCHEDULESHARE DELETE ALL ACCOUNTS AND CLASSES')$$,
  '42501', 'permission denied for function service_reset_site_data',
  'the destructive reset implementation is callable only by the service role Edge Function'
);

select * from finish();
rollback;
