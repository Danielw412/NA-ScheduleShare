begin;
select plan(32);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'zephyra-public@test.local', '', now(), '{}', '{"full_name":"Zephyra Publicson"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'zephyra-private@test.local', '', now(), '{}', '{"full_name":"Zephyra Hiddenlast"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'grade-target@test.local', '', now(), '{}', '{"full_name":"Grade Target"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'homepage-admin@test.local', '', now(), '{}', '{"full_name":"Homepage Admin"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 10, onboarding_completed = true, privacy_setting = 'school'
where id = '94000000-0000-4000-8000-000000000001';
update public.profiles
set grade = 10, onboarding_completed = true, privacy_setting = 'private'
where id = '94000000-0000-4000-8000-000000000002';
update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'classmates'
where id = '94000000-0000-4000-8000-000000000003';
update public.profiles
set grade = 12, onboarding_completed = true, privacy_setting = 'school'
where id = '94000000-0000-4000-8000-000000000004';
insert into private.user_roles (user_id, role, granted_by)
values ('94000000-0000-4000-8000-000000000004', 'administrator', '94000000-0000-4000-8000-000000000004');

select ok(
  has_function_privilege('anon', 'public.guest_search_students(text,integer)', 'execute'),
  'anonymous callers can execute only the shaped guest search API'
);
select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anonymous callers have no usage privilege on the private schema'
);
select ok(
  not has_function_privilege('anon', 'private.guest_search_students(text,integer)', 'execute'),
  'anonymous callers cannot bypass the shaped public guest search API'
);
select ok(
  not has_table_privilege('anon', 'private.homepage_statistic_settings', 'select'),
  'anonymous callers cannot query private statistic settings'
);
select ok(
  strpos(pg_get_function_result('public.guest_search_students(text,integer)'::regprocedure), 'student_id') = 0,
  'guest search does not return a stable student identifier'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select is(
  (select count(*) from public.guest_search_students('Zephyra', 20)),
  1::bigint,
  'guest search returns only the matching Anyone profile'
);
select is(
  (select display_name from public.guest_search_students('Zephyra', 20) limit 1),
  'Zephyra P.',
  'guest search formats only first name and last initial'
);
select is(
  (select last_initial from public.guest_search_students('Zephyra', 20) limit 1),
  'P',
  'guest search never returns the full last name'
);
select is(
  (select count(*) from public.guest_search_students('Zeph', 20)),
  0::bigint,
  'partial prefixes cannot be used to enumerate public profiles'
);
select throws_ok(
  $$select * from public.guest_search_students('Z%', 20)$$,
  '22023',
  'guest_first_name_query_invalid',
  'wildcard guest searches are rejected'
);
select throws_ok(
  $$select * from public.profiles$$,
  '42501',
  'permission denied for table profiles',
  'anonymous callers cannot download the profiles table'
);
select throws_ok(
  $$select * from public.class_enrollments$$,
  '42501',
  'permission denied for table class_enrollments',
  'anonymous callers cannot infer class membership from enrollments'
);
select throws_ok(
  $$select * from public.classes$$,
  '42501',
  'permission denied for table classes',
  'anonymous callers cannot browse real classes directly'
);
select ok(
  not has_function_privilege('anon', 'public.get_visible_schedule(uuid)', 'execute'),
  'anonymous callers cannot execute the real schedule API'
);
select ok(
  not has_function_privilege('anon', 'public.get_class_members(uuid)', 'execute'),
  'anonymous callers cannot execute the class-roster API'
);
select ok(
  not has_function_privilege('anon', 'public.admin_get_homepage_statistic_settings()', 'execute'),
  'anonymous callers cannot read administrative statistic settings'
);
select lives_ok(
  $$select * from public.get_homepage_statistic()$$,
  'anonymous callers can read only the configured aggregate statistic'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profile RLS remains enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.class_enrollments'::regclass),
  'enrollment RLS remains enabled'
);

reset role;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select * from public.admin_get_homepage_statistic_settings()$$,
  '42501',
  'administrator_access_required',
  'a normal user cannot read homepage statistic settings'
);

reset role;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select lives_ok(
  $$select public.admin_update_homepage_statistic_settings(true, 'students_joined', 0, 'total')$$,
  'an administrator can configure the real homepage statistic'
);
select is(
  (select statistic_key || ':' || activity_scope || ':' || minimum_value::text
   from public.admin_get_homepage_statistic_settings()),
  'students_joined:total:0',
  'administrators can configure statistic type, activity scope, and threshold'
);
select ok(
  exists (select 1 from public.audit_logs where action_type = 'homepage_statistic_settings_changed'),
  'homepage statistic settings changes are audited'
);

reset role;
select is(
  (select statistic_value from public.get_homepage_statistic()),
  (select count(*)
   from public.profiles profile
   join private.account_moderation moderation on moderation.user_id = profile.id
   where profile.onboarding_completed and profile.grade is not null
     and moderation.suspended_at is null and moderation.deleted_at is null),
  'the joined-student statistic is calculated from real active profiles'
);

update private.homepage_statistic_settings
set minimum_value = (
  select count(*) + 1
  from public.profiles profile
  join private.account_moderation moderation on moderation.user_id = profile.id
  where profile.onboarding_completed and profile.grade is not null
    and moderation.suspended_at is null and moderation.deleted_at is null
);
select is(
  (select count(*) from public.get_homepage_statistic()),
  0::bigint,
  'the statistic is hidden when its real value is below the configured minimum'
);

update private.homepage_statistic_settings
set statistic_key = 'schedules_uploaded', minimum_value = 0, activity_scope = 'total';
select is(
  (select statistic_value from public.get_homepage_statistic()),
  (select count(distinct enrollment.student_id)
   from public.class_enrollments enrollment
   join public.profiles profile on profile.id = enrollment.student_id
   join private.account_moderation moderation on moderation.user_id = profile.id
   where enrollment.active and profile.onboarding_completed
     and moderation.suspended_at is null and moderation.deleted_at is null),
  'the schedules-uploaded statistic is calculated from real active schedules'
);

update private.homepage_statistic_settings
set statistic_key = 'class_connections', minimum_value = 0, activity_scope = 'total';
select is(
  (select statistic_value from public.get_homepage_statistic()),
  (select count(*) from (
    select first_enrollment.class_id, first_enrollment.student_id, second_enrollment.student_id
    from public.class_enrollments first_enrollment
    join public.class_enrollments second_enrollment
      on second_enrollment.class_id = first_enrollment.class_id
     and second_enrollment.student_id > first_enrollment.student_id
     and second_enrollment.active
    join public.classes class_record
      on class_record.id = first_enrollment.class_id and class_record.status = 'active'
    join public.profiles first_profile on first_profile.id = first_enrollment.student_id
    join public.profiles second_profile on second_profile.id = second_enrollment.student_id
    join private.account_moderation first_moderation on first_moderation.user_id = first_profile.id
    join private.account_moderation second_moderation on second_moderation.user_id = second_profile.id
    where first_enrollment.active
      and first_profile.onboarding_completed and second_profile.onboarding_completed
      and first_moderation.suspended_at is null and first_moderation.deleted_at is null
      and second_moderation.suspended_at is null and second_moderation.deleted_at is null
  ) connections),
  'the class-connections statistic is calculated from real shared-class pairs'
);

update private.homepage_statistic_settings
set activity_scope = 'recent';
select is(
  (select statistic_value from public.get_homepage_statistic()),
  (select count(*) from (
    select first_enrollment.class_id, first_enrollment.student_id, second_enrollment.student_id
    from public.class_enrollments first_enrollment
    join public.class_enrollments second_enrollment
      on second_enrollment.class_id = first_enrollment.class_id
     and second_enrollment.student_id > first_enrollment.student_id
     and second_enrollment.active
    join public.classes class_record
      on class_record.id = first_enrollment.class_id and class_record.status = 'active'
    join public.profiles first_profile on first_profile.id = first_enrollment.student_id
    join public.profiles second_profile on second_profile.id = second_enrollment.student_id
    join private.account_moderation first_moderation on first_moderation.user_id = first_profile.id
    join private.account_moderation second_moderation on second_moderation.user_id = second_profile.id
    where first_enrollment.active
      and first_profile.onboarding_completed and second_profile.onboarding_completed
      and first_moderation.suspended_at is null and first_moderation.deleted_at is null
      and second_moderation.suspended_at is null and second_moderation.deleted_at is null
      and greatest(first_enrollment.updated_at, second_enrollment.updated_at) >= now() - interval '30 days'
  ) connections),
  'recent activity uses the real last-30-day class connections'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$update public.profiles set grade = 12 where id = '94000000-0000-4000-8000-000000000003'$$,
  '42501',
  'grade_changes_require_administrator',
  'a student cannot change their grade after onboarding'
);

reset role;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select lives_ok(
  $$select public.admin_update_user(
    '94000000-0000-4000-8000-000000000003'::uuid,
    'Grade Target'::text,
    12::smallint,
    'classmates'::public.privacy_setting,
    'Verified grade correction'::text
  )$$,
  'an administrator can change another student grade through the audited RPC'
);
reset role;
select is(
  (select grade from public.profiles where id = '94000000-0000-4000-8000-000000000003'),
  12::smallint,
  'the administrator grade change is stored'
);
select throws_ok(
  $$select private.admin_update_homepage_statistic_settings(true, 'manual_number', 0, 'total')$$,
  '22023',
  'invalid_homepage_statistic',
  'administrators cannot configure a manual statistic value'
);

select * from finish();
rollback;
