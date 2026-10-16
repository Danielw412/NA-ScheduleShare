begin;
select plan(37);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_current, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '96200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'issue-student@test.local', '', now(), '{}', '{"full_name":"Issue Student"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'issue-admin@test.local', '', now(), '{}', '{"full_name":"Issue Admin"}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96200000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'issue-second@test.local', '', now(), '{}', '{"full_name":"Second Student"}', now(), now(), '', '', '', '', '');

update public.profiles
set grade = 11, onboarding_completed = true, privacy_setting = 'school'
where id in ('96200000-0000-4000-8000-000000000001', '96200000-0000-4000-8000-000000000002', '96200000-0000-4000-8000-000000000003');
insert into private.user_roles (user_id, role, granted_by)
values ('96200000-0000-4000-8000-000000000002', 'administrator', '96200000-0000-4000-8000-000000000002');

-- Privileges: the store is closed except for the bounded entry points.
select ok(not has_table_privilege('anon', 'private.app_issues', 'select'), 'anonymous visitors cannot read issues');
select ok(not has_table_privilege('authenticated', 'private.app_issue_events', 'select'), 'students cannot read issue events');
select ok(not has_table_privilege('authenticated', 'private.app_issues', 'insert'), 'students cannot write issues directly');
select ok(has_function_privilege('anon', 'public.report_app_issue(jsonb)', 'execute'), 'anonymous visitors can report a browser error');
select ok(has_function_privilege('authenticated', 'public.report_app_issue(jsonb)', 'execute'), 'students can report a browser error');
select ok(not has_function_privilege('anon', 'public.service_report_app_issue(jsonb,text,uuid)', 'execute'), 'anonymous visitors cannot use the service entry point');
select ok(not has_function_privilege('authenticated', 'public.service_report_app_issue(jsonb,text,uuid)', 'execute'), 'students cannot use the service entry point');
select ok(not has_function_privilege('anon', 'public.admin_list_app_issues(text,text,integer,integer)', 'execute'), 'anonymous visitors cannot list issues');
select ok(not has_function_privilege('authenticated', 'private.ingest_app_issue(jsonb,uuid,text)', 'execute'), 'students cannot call the ingestion internals');

-- A signed-in student reports the same problem twice: one issue, two events, one affected user.
select set_config('request.jwt.claim.sub', '96200000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok($$select public.report_app_issue('{
  "event_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
  "fingerprint": "web-test-fingerprint-1",
  "level": "error",
  "message": "TypeError: Cannot read properties of undefined",
  "culprit": "render (assets/HomePage.js)",
  "exception_type": "TypeError",
  "stacktrace": [{"function": "render", "filename": "assets/HomePage.js", "lineno": 1, "colno": 2, "in_app": true, "secret": "drop me"}],
  "breadcrumbs": [{"timestamp": 1, "category": "navigation", "message": "/ to /schedule", "level": "info", "data": {"token": "should-be-removed", "status": 200}}],
  "tags": {"boundary": "route", "bad key!": "dropped"},
  "context": {"route": "/schedule", "release": "abc123", "environment": "production", "email": "student@example.com"}
}'::jsonb)$$, 'a student can report an error');
select lives_ok($$select public.report_app_issue('{
  "event_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2",
  "fingerprint": "web-test-fingerprint-1",
  "level": "error",
  "message": "TypeError: Cannot read properties of undefined",
  "context": {"release": "abc124"}
}'::jsonb)$$, 'a repeat of the same problem is accepted');
select lives_ok($$select public.report_app_issue('{
  "event_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2",
  "fingerprint": "web-test-fingerprint-1",
  "level": "error",
  "message": "TypeError: Cannot read properties of undefined"
}'::jsonb)$$, 'a retried report with the same event id is ignored without an error');
select lives_ok($$select public.report_app_issue('{"fingerprint": "x", "level": "error", "message": "bad"}'::jsonb)$$, 'malformed reports are dropped without an error');
select lives_ok($$select public.report_app_issue('{"event_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1", "fingerprint": "web-info-only", "level": "info", "message": "not an issue"}'::jsonb)$$, 'informational reports are dropped');

reset role;
select set_config('test.issue_id', (select id::text from private.app_issues where fingerprint = 'web-test-fingerprint-1'), true);
select is(
  (select event_count::text || ':' || user_count::text || ':' || first_release || ':' || last_release from private.app_issues where fingerprint = 'web-test-fingerprint-1'),
  '2:1:abc123:abc124',
  'repeat events group into one issue with one affected user and release tracking'
);
select is((select count(*)::integer from private.app_issues where fingerprint in ('x', 'web-info-only')), 0, 'rejected reports create nothing');
select ok(
  (select stacktrace -> 0 ? 'secret' from private.app_issue_events where event_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1') = false,
  'unknown stack frame keys are dropped'
);
select ok(
  (select not (breadcrumbs -> 0 -> 'data' ? 'token') and (breadcrumbs -> 0 -> 'data' ->> 'status') = '200' from private.app_issue_events where event_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'),
  'breadcrumb data is sanitized'
);
select ok(
  (select not (context ? 'email') and not (tags ? 'bad key!') and (tags ->> 'boundary') = 'route' from private.app_issue_events where event_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'),
  'context keys outside the allowlist and invalid tag keys are dropped'
);
select is(
  (select user_id from private.app_issue_events where event_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'),
  '96200000-0000-4000-8000-000000000001'::uuid,
  'events record only the reporting account id'
);

-- Anonymous visitors can report; their events carry no account.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select lives_ok($$select public.report_app_issue('{"event_id": "ccccccccccccccccccccccccccccccc1", "fingerprint": "web-guest-problem", "level": "warning", "message": "Guest import failed"}'::jsonb)$$, 'a guest can report an error');
reset role;
select is((select user_count from private.app_issues where fingerprint = 'web-guest-problem'), 0, 'guest reports do not count as affected accounts');

-- Per-account rate limit: at most 10 reports per minute.
select set_config('request.jwt.claim.sub', '96200000-0000-4000-8000-000000000003', true);
set local role authenticated;
select public.report_app_issue(jsonb_build_object(
  'event_id', lpad(to_hex(n), 32, 'd'),
  'fingerprint', 'web-rate-limited',
  'level', 'error',
  'message', 'Repeated failure'
)) from generate_series(1, 14) n;
reset role;
select is((select event_count from private.app_issues where fingerprint = 'web-rate-limited'), 10::bigint, 'one account can add at most ten events per minute');

-- Oversized browser reports are dropped.
set local role anon;
select public.report_app_issue(jsonb_build_object(
  'event_id', 'fffffffffffffffffffffffffffffff1',
  'fingerprint', 'web-oversized',
  'level', 'error',
  'message', 'Too big',
  'context', jsonb_build_object('extra', jsonb_build_object('blob', repeat('x', 7000)))
));
reset role;
select is((select count(*)::integer from private.app_issues where fingerprint = 'web-oversized'), 0, 'oversized browser reports are not stored');

-- Browser spam cannot use up the budget for server-side issues.
insert into private.app_issue_ingest_windows (window_start, scope, event_count)
values (date_trunc('hour', now()), 'new_issue:web', 1000)
on conflict (window_start, scope) do update set event_count = 1000;
set local role anon;
select public.report_app_issue('{"event_id": "fffffffffffffffffffffffffffffff2", "fingerprint": "web-over-budget", "level": "error", "message": "Spam"}'::jsonb);
reset role;
select is((select count(*)::integer from private.app_issues where fingerprint = 'web-over-budget'), 0, 'new browser issues stop at their hourly budget');
set local role service_role;
select ok(
  public.service_report_app_issue('{"event_id": "fffffffffffffffffffffffffffffff3", "fingerprint": "fn-server-crash-1", "level": "error", "message": "Error: real edge crash"}'::jsonb, 'edge_function') is not null,
  'server reports still create issues when the browser budget is used up'
);
reset role;

-- Students cannot triage.
select set_config('request.jwt.claim.sub', '96200000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok($$select * from public.admin_list_app_issues('open', null, 50, 0)$$, '42501', 'administrator_access_required', 'students cannot list issues');
select throws_ok(
  format('select public.admin_update_app_issue_status(%L, %L)', current_setting('test.issue_id'), 'resolved'),
  '42501', 'administrator_access_required', 'students cannot change issue status'
);

-- Administrators list, look up by reference, resolve, and see regressions.
reset role;
select set_config('request.jwt.claim.sub', '96200000-0000-4000-8000-000000000002', true);
set local role authenticated;
select ok((select count(*) >= 3 from public.admin_list_app_issues('open', null, 50, 0)), 'administrators see open issues');
select is(
  public.admin_find_app_issue_by_reference('AAAAAAAA'),
  current_setting('test.issue_id')::uuid,
  'an error reference finds its issue'
);
select lives_ok(
  format('select public.admin_update_app_issue_status(%L, %L)', current_setting('test.issue_id'), 'resolved'),
  'administrators can resolve an issue'
);
select is(
  jsonb_array_length(public.admin_get_app_issue(current_setting('test.issue_id')::uuid) -> 'events'),
  2,
  'issue details include sample events'
);
select ok(
  (public.admin_get_app_issue(current_setting('test.issue_id')::uuid) -> 'events' -> 0 ->> 'user_id') is null,
  'administrators who are not super administrators do not see account ids on events'
);
reset role;

select set_config('request.jwt.claim.sub', '96200000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.report_app_issue('{"event_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3", "fingerprint": "web-test-fingerprint-1", "level": "error", "message": "TypeError: Cannot read properties of undefined"}'::jsonb);
reset role;
select ok(
  (select status = 'open' and regressed_at is not null and resolved_at is null from private.app_issues where fingerprint = 'web-test-fingerprint-1'),
  'a resolved issue that happens again reopens as a regression'
);

-- Pausing ingestion stops new reports.
select set_config('request.jwt.claim.sub', '96200000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok($$select public.admin_set_app_issue_ingest(false)$$, 'administrators can pause issue reporting');
reset role;
select set_config('request.jwt.claim.sub', '96200000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.report_app_issue('{"event_id": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1", "fingerprint": "web-while-paused", "level": "error", "message": "Should not be stored"}'::jsonb);
reset role;
select is((select count(*)::integer from private.app_issues where fingerprint = 'web-while-paused'), 0, 'paused ingestion stores nothing');

select ok(
  exists (select 1 from public.event_logs where event_type = 'app_issue_status_changed' and actor_user_id = '96200000-0000-4000-8000-000000000002'),
  'issue triage is written to the event log'
);

select * from finish();
rollback;
