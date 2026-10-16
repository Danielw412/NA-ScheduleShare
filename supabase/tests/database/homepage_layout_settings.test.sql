begin;
select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '96100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'layout-student@test.local', '', now(), '{}', '{"full_name":"Layout Student"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'layout-admin@test.local', '', now(), '{}', '{"full_name":"Layout Admin"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'school'
where id = '96100000-0000-4000-8000-000000000001';
update public.profiles
set grade = 12, onboarding_completed = true, privacy_setting = 'school'
where id = '96100000-0000-4000-8000-000000000002';
insert into private.user_roles (user_id, role, granted_by)
values ('96100000-0000-4000-8000-000000000002', 'administrator', '96100000-0000-4000-8000-000000000002');

select ok(
  not has_table_privilege('anon', 'private.homepage_layout_settings', 'select'),
  'anonymous visitors cannot read the homepage layout table directly'
);
select ok(
  not has_table_privilege('authenticated', 'private.homepage_layout_settings', 'select'),
  'students cannot read the homepage layout table directly'
);
select ok(
  has_function_privilege('anon', 'public.get_homepage_layout()', 'execute'),
  'anonymous visitors can read the public homepage layout'
);
select ok(
  not has_function_privilege('anon', 'public.admin_update_homepage_layout(text)', 'execute'),
  'anonymous visitors cannot change the homepage layout'
);
select ok(
  not has_function_privilege('anon', 'public.admin_get_homepage_layout()', 'execute'),
  'anonymous visitors cannot read the administrator homepage layout view'
);

set local role anon;
select is(
  public.get_homepage_layout(),
  'balanced',
  'the balanced homepage is the default for anonymous visitors'
);
reset role;

select set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  public.get_homepage_layout(),
  'balanced',
  'signed-in students read the same homepage layout'
);
select throws_ok(
  $$select * from public.admin_get_homepage_layout()$$,
  '42501',
  'administrator_access_required',
  'students cannot read the administrator homepage layout view'
);
select throws_ok(
  $$select public.admin_update_homepage_layout('bell_schedule')$$,
  '42501',
  'administrator_access_required',
  'students cannot change the homepage layout'
);

reset role;
select set_config('request.jwt.claim.sub', '96100000-0000-4000-8000-000000000002', true);
set local role authenticated;

select lives_ok(
  $$select public.admin_update_homepage_layout('bell_schedule')$$,
  'an administrator can make the bell schedule the homepage focus'
);
select throws_ok(
  $$select public.admin_update_homepage_layout('dashboard')$$,
  '22023',
  'invalid_homepage_layout',
  'administrators cannot store an unknown homepage layout'
);
select is(
  (select layout from public.admin_get_homepage_layout()),
  'bell_schedule',
  'administrators can read the updated homepage layout'
);

reset role;
set local role anon;
select is(
  public.get_homepage_layout(),
  'bell_schedule',
  'the administrator choice applies to every visitor'
);
reset role;

select ok(
  exists (
    select 1 from public.audit_logs
    where action_type = 'homepage_layout_changed'
      and administrator_id = '96100000-0000-4000-8000-000000000002'
  ),
  'homepage layout changes are audited with the acting administrator'
);
select is(
  (select layout || ':' || updated_by::text from private.homepage_layout_settings where singleton),
  'bell_schedule:96100000-0000-4000-8000-000000000002',
  'the layout and the administrator who set it are stored'
);

select * from finish();
rollback;
