begin;
select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'club-student@test.local', '', now(), '{}', '{"full_name":"Club Student"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'club-admin@test.local', '', now(), '{}', '{"full_name":"Club Admin"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 10, onboarding_completed = true, privacy_setting = 'school'
where id = '95000000-0000-4000-8000-000000000001';
update public.profiles
set grade = 12, onboarding_completed = true, privacy_setting = 'school'
where id = '95000000-0000-4000-8000-000000000002';
insert into private.user_roles (user_id, role, granted_by)
values ('95000000-0000-4000-8000-000000000002', 'administrator', '95000000-0000-4000-8000-000000000002');

select ok(
  not has_table_privilege('authenticated', 'private.club_prompt_settings', 'select'),
  'students cannot read the club invitation settings table directly'
);
select ok(
  not has_function_privilege('anon', 'public.get_club_prompt_settings()', 'execute'),
  'anonymous visitors cannot read the club invitation settings'
);
select ok(
  has_function_privilege('anon', 'public.get_why_scheduleshare_enabled()', 'execute'),
  'anonymous visitors can read the public page visibility setting'
);
select ok(
  has_function_privilege('authenticated', 'public.get_club_prompt_settings()', 'execute'),
  'signed-in students can read the club invitation settings'
);
select ok(
  not has_function_privilege('anon', 'public.admin_update_club_prompt_settings(boolean,integer,boolean)', 'execute'),
  'anonymous visitors cannot change the club invitation or page visibility settings'
);

set local role anon;
select is(
  public.get_why_scheduleshare_enabled(),
  true,
  'the Why ScheduleShare page is published by default for anonymous visitors'
);
reset role;

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select enabled from public.get_club_prompt_settings()),
  true,
  'the timed club invitation is enabled by default'
);
select is(
  (select delay_seconds from public.get_club_prompt_settings()),
  180,
  'the default delay is three minutes'
);
select is(
  public.get_why_scheduleshare_enabled(),
  true,
  'signed-in students can read the public page visibility setting'
);
select throws_ok(
  $$select * from public.admin_get_club_prompt_settings()$$,
  '42501',
  'administrator_access_required',
  'students cannot read the administrator club invitation settings'
);
select throws_ok(
  $$select public.admin_update_club_prompt_settings(false, 600, false)$$,
  '42501',
  'administrator_access_required',
  'students cannot change the club invitation or page visibility settings'
);

reset role;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select lives_ok(
  $$select public.admin_update_club_prompt_settings(false, 600, false)$$,
  'an administrator can disable the invitation and Why ScheduleShare page'
);
select throws_ok(
  $$select public.admin_update_club_prompt_settings(true, 5, true)$$,
  '22023',
  'invalid_club_prompt_delay',
  'administrators cannot set a delay outside the allowed range'
);
select is(
  (select why_scheduleshare_enabled from public.admin_get_club_prompt_settings()),
  false,
  'administrators can read the updated Why ScheduleShare page setting'
);

reset role;
select ok(
  exists (select 1 from public.audit_logs where action_type = 'club_prompt_settings_changed'),
  'club invitation changes are audited'
);
select is(
  (select enabled::text || ':' || delay_seconds::text || ':' || why_scheduleshare_enabled::text from private.club_prompt_settings where singleton),
  'false:600:false',
  'the administrator toggles and delay are stored'
);

select * from finish();
rollback;
