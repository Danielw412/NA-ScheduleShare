begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'guest-setting-user@test.local', '', now(), '{}', '{"full_name":"Guest Setting User"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'guest-setting-admin@test.local', '', now(), '{}', '{"full_name":"Guest Setting Admin"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'classmates'
where id in ('95000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000002');

insert into private.user_roles (user_id, role, granted_by)
values ('95000000-0000-4000-8000-000000000002', 'administrator', '95000000-0000-4000-8000-000000000002');

select ok(
  has_function_privilege('anon', 'public.get_guest_exploration_enabled()', 'execute'),
  'anonymous callers can read the shaped guest exploration flag'
);
select ok(
  not has_table_privilege('anon', 'private.guest_access_settings', 'select'),
  'anonymous callers cannot read the private settings table'
);
select ok(
  not has_function_privilege('anon', 'public.admin_update_guest_exploration_enabled(boolean)', 'execute'),
  'anonymous callers cannot update guest exploration'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.guest_access_settings'::regclass),
  'guest access settings keep RLS enabled'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;
select is(
  public.get_guest_exploration_enabled(),
  true,
  'guest exploration is enabled by default'
);

reset role;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_update_guest_exploration_enabled(false)$$,
  '42501',
  'administrator_access_required',
  'a normal user cannot change guest exploration'
);

reset role;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select lives_ok(
  $$select public.admin_update_guest_exploration_enabled(false)$$,
  'an administrator can disable guest exploration'
);
select is(
  public.get_guest_exploration_enabled(),
  false,
  'the disabled setting is returned immediately'
);
select ok(
  exists (
    select 1
    from public.audit_logs
    where action_type = 'guest_exploration_settings_changed'
      and target_id = 'guest-exploration'
  ),
  'guest exploration changes are audited'
);
select lives_ok(
  $$select public.admin_update_guest_exploration_enabled(true)$$,
  'an administrator can re-enable guest exploration'
);
select is(
  public.get_guest_exploration_enabled(),
  true,
  'the re-enabled setting is returned immediately'
);

select * from finish();
rollback;
