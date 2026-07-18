begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current,
  email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '99000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'share-owner@test.local', '', now(), '{}', '{"full_name":"Share Owner"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'share-other@test.local', '', now(), '{}', '{"full_name":"Other Student"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'classmates'
where id in (
  '99000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000002'
);

insert into public.course_names (id, name, normalized_name, source)
values ('99100000-0000-4000-8000-000000000001', 'Preview Biology', 'preview biology', 'admin');

insert into public.classes (
  id, course_name_id, teacher_last_name, default_academic_term,
  is_double_period, created_by
) values (
  '99200000-0000-4000-8000-000000000001',
  '99100000-0000-4000-8000-000000000001',
  'Darwin', 'full_year', false,
  '99000000-0000-4000-8000-000000000001'
);

insert into public.class_meeting_slots (class_id, day_type, period_number)
values ('99200000-0000-4000-8000-000000000001', 'A', 2);

insert into public.class_enrollments (student_id, class_id, academic_term)
values (
  '99000000-0000-4000-8000-000000000001',
  '99200000-0000-4000-8000-000000000001',
  'full_year'
);

select set_config('request.jwt.claim.sub', '99000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select public.get_or_create_schedule_share()$$,
  'a schedule owner can create a share token'
);
select is(
  public.get_or_create_schedule_share(),
  public.get_or_create_schedule_share(),
  'the share token is stable and reused'
);

reset role;
update public.schedule_share_links
set token = '99300000-0000-4000-8000-000000000001'
where owner_id = '99000000-0000-4000-8000-000000000001';

set local role anon;
select is(
  public.get_public_schedule_share('99300000-0000-4000-8000-000000000001')->>'available',
  'false',
  'Classmates privacy does not expose a public preview'
);

reset role;
update public.profiles
set privacy_setting = 'school'
where id = '99000000-0000-4000-8000-000000000001';

set local role anon;
select is(
  public.get_public_schedule_share('99300000-0000-4000-8000-000000000001')->>'available',
  'true',
  'Anyone privacy permits the explicit public share token'
);
select is(
  public.get_public_schedule_share('99300000-0000-4000-8000-000000000001') #>> '{schedule,0,course_name}',
  'Preview Biology',
  'the public response includes a safe course name'
);
select is(
  public.get_public_schedule_share('99300000-0000-4000-8000-000000000001') #>> '{schedule,0,period_number}',
  '2',
  'the public response includes the schedule period'
);
select ok(
  public.get_public_schedule_share('99300000-0000-4000-8000-000000000001')::text !~ '(99000000|99200000|share-owner|Darwin)',
  'the public response omits user IDs, class IDs, emails, and teachers'
);
select is(
  public.get_public_schedule_share('99300000-0000-4000-8000-000000000099')->>'available',
  'false',
  'an invalid token returns the generic response'
);
select throws_ok(
  $$select count(*) from public.schedule_share_links$$,
  '42501',
  'permission denied for table schedule_share_links',
  'anonymous callers cannot inspect the token table'
);

reset role;
update public.schedule_share_links
set enabled = false
where owner_id = '99000000-0000-4000-8000-000000000001';
set local role anon;
select is(
  public.get_public_schedule_share('99300000-0000-4000-8000-000000000001')->>'available',
  'false',
  'a disabled link returns the generic response'
);

reset role;
update public.schedule_share_links
set enabled = true
where owner_id = '99000000-0000-4000-8000-000000000001';
update private.account_moderation
set suspended_at = now(),
    suspended_by = '99000000-0000-4000-8000-000000000002',
    suspension_reason = 'Preview privacy test'
where user_id = '99000000-0000-4000-8000-000000000001';
set local role anon;
select is(
  public.get_public_schedule_share('99300000-0000-4000-8000-000000000001')->>'available',
  'false',
  'a suspended owner returns the generic response'
);

select * from finish();
rollback;
