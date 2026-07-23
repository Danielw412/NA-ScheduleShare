begin;
select plan(40);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current,
  email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'access-owner@test.local', '', now(), '{}', '{"full_name":"Private Owner"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'access-viewer@test.local', '', now(), '{}', '{"full_name":"Target Viewer"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'access-third@test.local', '', now(), '{}', '{"full_name":"Unrelated Student"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'access-admin@test.local', '', now(), '{}', '{"full_name":"Access Admin"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11,
    onboarding_completed = true,
    privacy_setting = 'private'
where id::text like '96000000-%';

insert into private.user_roles (user_id, role, granted_by)
values (
  '96000000-0000-4000-8000-000000000004',
  'administrator',
  '96000000-0000-4000-8000-000000000004'
);

insert into public.course_names (id, name, normalized_name, source)
values
  ('96100000-0000-4000-8000-000000000001', 'Targeted Biology', 'targeted biology', 'admin'),
  ('96100000-0000-4000-8000-000000000002', 'Viewer Mathematics', 'viewer mathematics', 'admin');

insert into public.classes (
  id, course_name_id, teacher_last_name, default_academic_term,
  is_double_period, created_by
) values
  ('96200000-0000-4000-8000-000000000001', '96100000-0000-4000-8000-000000000001', 'Darwin', 'full_year', false, '96000000-0000-4000-8000-000000000001'),
  ('96200000-0000-4000-8000-000000000002', '96100000-0000-4000-8000-000000000002', 'Noether', 'full_year', false, '96000000-0000-4000-8000-000000000002');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('96200000-0000-4000-8000-000000000001', 'A', 2),
  ('96200000-0000-4000-8000-000000000002', 'B', 3);

insert into public.class_enrollments (student_id, class_id, academic_term)
values
  ('96000000-0000-4000-8000-000000000001', '96200000-0000-4000-8000-000000000001', 'full_year'),
  ('96000000-0000-4000-8000-000000000002', '96200000-0000-4000-8000-000000000002', 'full_year');

select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select full_name from public.search_student_access_directory('', null, null, null) where student_id = '96000000-0000-4000-8000-000000000001'),
  'Private O.'::text,
  'a Private student is shown with a last initial in the student directory'
);

reset role;
update public.profiles
set privacy_setting = 'classmates'
where id = '96000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select full_name from public.search_student_access_directory('', null, null, null) where student_id = '96000000-0000-4000-8000-000000000001'),
  'Private O.'::text,
  'a Classmates student outside the shared-class relationship is shown with a last initial'
);

reset role;
update public.profiles
set privacy_setting = 'private'
where id = '96000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select throws_ok(
  $$select * from public.get_visible_schedule('96000000-0000-4000-8000-000000000001')$$,
  '42501',
  'schedule_not_visible',
  'a private schedule starts unavailable'
);
select lives_ok(
  $$select public.request_schedule_access('96000000-0000-4000-8000-000000000001')$$,
  'a student can request access'
);
select is(
  public.request_schedule_access('96000000-0000-4000-8000-000000000001'),
  public.request_schedule_access('96000000-0000-4000-8000-000000000001'),
  'repeating a pending request reuses it'
);
select is(
  (select outgoing_request_pending from public.search_student_access_directory('', null, null, null) where student_id = '96000000-0000-4000-8000-000000000001'),
  true,
  'the Students result marks an outgoing request pending'
);
select throws_ok(
  $$insert into public.schedule_access_requests (requester_id, owner_id) values ('96000000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000001')$$,
  '42501',
  'permission denied for table schedule_access_requests',
  'clients cannot bypass request RPCs with direct inserts'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  (select count(*) from public.schedule_access_requests),
  0::bigint,
  'unrelated students cannot inspect requests'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.get_schedule_access_notifications()->>'count',
  '1',
  'an incoming pending request increments the owner badge'
);
select is(
  public.get_schedule_access_notifications() #>> '{notifications,0,kind}',
  'incoming_request',
  'pending requests are listed first'
);
select lives_ok(
  $$select public.respond_schedule_access_request((select id from public.schedule_access_requests where requester_id = '96000000-0000-4000-8000-000000000002' and status = 'pending'), true)$$,
  'the owner can approve a request'
);
select is(
  (select they_can_view_yours from public.search_student_access_directory('', null, null, null) where student_id = '96000000-0000-4000-8000-000000000002'),
  'approved_by_you',
  'the owner sees Approved by you'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.get_visible_schedule('96000000-0000-4000-8000-000000000001')),
  1::bigint,
  'approval exposes the full target schedule'
);
select is(
  (select full_name from public.search_student_access_directory('', null, null, null) where student_id = '96000000-0000-4000-8000-000000000001'),
  'Private Owner'::text,
  'the directory keeps the full name when schedule access is available'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select * from public.get_visible_schedule('96000000-0000-4000-8000-000000000002')$$,
  '42501',
  'schedule_not_visible',
  'manual access is one-way'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select you_can_view_theirs from public.search_student_access_directory('', null, null, null) where student_id = '96000000-0000-4000-8000-000000000001'),
  'approved_by_them',
  'the viewer sees Approved by them'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.get_schedule_access_notifications()->'notifications') notification
    where notification->>'status' = 'approved'
  ),
  'the requester receives an approval update'
);
select is(
  public.get_schedule_access_notifications()->>'count',
  '1',
  'the unread approval increments the badge'
);
select lives_ok(
  $$select public.mark_schedule_access_notifications_read()$$,
  'request updates can be marked read'
);
select is(
  public.get_schedule_access_notifications()->>'count',
  '0',
  'read request updates leave the badge'
);

reset role;
update public.profiles
set privacy_setting = 'school'
where id = '96000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select they_can_view_yours from public.search_student_access_directory('', null, null, null) where student_id = '96000000-0000-4000-8000-000000000002'),
  'everyone_allowed',
  'privacy access takes precedence over a redundant manual action'
);

reset role;
update public.profiles
set privacy_setting = 'private'
where id = '96000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select they_can_view_yours from public.search_student_access_directory('', null, null, null) where student_id = '96000000-0000-4000-8000-000000000002'),
  'approved_by_you',
  'the stored grant remains after privacy changes'
);

reset role;
update public.class_enrollments
set active = false
where student_id = '96000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.get_visible_schedule('96000000-0000-4000-8000-000000000001')),
  1::bigint,
  'the grant remains after class enrollment changes'
);

reset role;
update public.class_enrollments
set active = true
where student_id = '96000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.remove_schedule_access('96000000-0000-4000-8000-000000000002')$$,
  'the owner can revoke access'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select * from public.get_visible_schedule('96000000-0000-4000-8000-000000000001')$$,
  '42501',
  'schedule_not_visible',
  'revocation takes effect immediately'
);
select lives_ok(
  $$select public.request_schedule_access('96000000-0000-4000-8000-000000000001')$$,
  'a new request can follow a revoked grant'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.respond_schedule_access_request((select id from public.schedule_access_requests where requester_id = '96000000-0000-4000-8000-000000000002' and status = 'pending'), false)$$,
  'the owner can decline a request'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.get_schedule_access_notifications()->'notifications') notification
    where notification->>'status' = 'declined'
  ),
  'the requester receives a decline update'
);
select is(
  public.get_schedule_access_notifications()->>'count',
  '1',
  'the unread decline increments the badge'
);
select lives_ok(
  $$select public.mark_schedule_access_notifications_read()$$,
  'the decline can be marked read'
);
select lives_ok(
  $$select public.request_schedule_access('96000000-0000-4000-8000-000000000001')$$,
  'another request can be created after a decline'
);
select lives_ok(
  $$select public.cancel_schedule_access_request('96000000-0000-4000-8000-000000000001')$$,
  'the requester can cancel a pending request'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.get_schedule_access_notifications()->>'count',
  '0',
  'canceled requests leave the owner notification queue'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.request_schedule_access('96000000-0000-4000-8000-000000000001')$$,
  'a request can be sent again after cancellation'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.allow_schedule_access('96000000-0000-4000-8000-000000000002')$$,
  'Allow access also approves that student pending request'
);
select is(
  (select status::text from public.schedule_access_requests where requester_id = '96000000-0000-4000-8000-000000000002' order by created_at desc limit 1),
  'approved',
  'the pending request is recorded as approved'
);
select is(
  (select they_can_view_yours from public.search_student_access_directory('', null, null, null) where student_id = '96000000-0000-4000-8000-000000000002'),
  'approved_by_you',
  'manual allow updates the Students status'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$insert into public.schedule_access_grants (owner_id, viewer_id) values ('96000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000002')$$,
  '42501',
  'permission denied for table schedule_access_grants',
  'clients cannot bypass grant RPCs with direct writes'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.remove_schedule_access('96000000-0000-4000-8000-000000000002')$$,
  'manual access can be revoked again'
);

reset role;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(
  (select count(*) from public.get_visible_schedule('96000000-0000-4000-8000-000000000001')),
  1::bigint,
  'existing administrator access still applies'
);

select * from finish();
rollback;
