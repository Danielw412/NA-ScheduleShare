begin;
select plan(35);

select is(
  (select active_model_id from private.schedule_import_settings where singleton),
  'gemini-3.5-flash-lite',
  'Gemini Flash-Lite is the default production model'
);
select is(
  (select thinking_level from private.schedule_import_settings where singleton),
  'low',
  'production extraction defaults to low reasoning'
);
select is(
  (select output_token_limit from private.schedule_import_settings where singleton),
  4096,
  'the production output-token limit has a bounded default'
);
select is(
  (select count(*) from private.schedule_import_models),
  3::bigint,
  'only the explicitly supported Gemini models are allowlisted'
);
select ok(
  (select bool_and(enabled and supports_image_input and supports_structured_output)
   from private.schedule_import_models),
  'every enabled model supports image input and structured output'
);

update private.schedule_import_settings
set rate_limit_max = 3
where singleton;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select model_id from public.schedule_import_prepare(false, null, null)),
  'gemini-3.5-flash-lite',
  'a regular import receives the active production model'
);
select is(
  (select user_id from public.schedule_import_prepare(false, null, null)),
  '10000000-0000-4000-8000-000000000002'::uuid,
  'the importer derives the user from auth.uid instead of client input'
);
select is(
  (select bypassed_rate_limit from public.schedule_import_prepare(false, null, null)),
  false,
  'regular requests never bypass the application rate limit'
);
select throws_ok(
  $$select * from public.schedule_import_prepare(false, null, null)$$,
  'P0001',
  'rate_limit_exceeded',
  'the atomic counter rejects requests after the configured limit'
);
select throws_ok(
  $$select * from public.schedule_import_prepare(true, null, null)$$,
  '42501',
  'developer_mode_administrator_required',
  'regular users cannot enable AI developer mode'
);
select throws_ok(
  $$select * from public.schedule_import_prepare(false, 'gemini-3.5-flash', 'high')$$,
  '42501',
  'developer_overrides_not_allowed',
  'regular requests cannot manipulate model or reasoning overrides'
);
select throws_ok(
  $$select * from public.admin_list_schedule_import_models()$$,
  '42501',
  'administrator_access_required',
  'regular users cannot read model configuration'
);
select throws_ok(
  $$select public.record_schedule_import_diagnostic(
    'success', 'gemini-3.5-flash-lite', 'low', 4096, 'prompt', '{}', '{}'::jsonb,
    '[]'::jsonb, null, 1, '[{"index":1,"mime_type":"image/png","byte_size":10}]'::jsonb
  )$$,
  '42501',
  'administrator_access_required',
  'regular users cannot create diagnostic logs'
);
select throws_ok(
  $$select * from public.admin_list_schedule_import_diagnostics()$$,
  '42501',
  'administrator_access_required',
  'regular users cannot read diagnostic logs'
);
select throws_ok(
  $$select * from private.schedule_import_diagnostic_logs$$,
  '42501',
  'permission denied for table schedule_import_diagnostic_logs',
  'authenticated users cannot query the private diagnostic table directly'
);

reset role;
select is(
  (select request_count from private.schedule_import_rate_limits
   where user_id = '10000000-0000-4000-8000-000000000002'),
  3,
  'all successful regular preparations are recorded in one atomic counter'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select model_id from public.schedule_import_prepare(true, 'gemini-3.5-flash', 'high')),
  'gemini-3.5-flash',
  'an admin developer request may select another enabled compatible model'
);
select is(
  (select thinking_level from public.schedule_import_prepare(true, 'gemini-3.5-flash', 'high')),
  'high',
  'an admin developer request may select a supported reasoning level'
);
select is(
  (select bypassed_rate_limit from public.schedule_import_prepare(true, null, null)),
  true,
  'admin developer mode reports its narrow application-rate-limit bypass'
);
select throws_ok(
  $$select * from public.schedule_import_prepare(true, 'gemini-arbitrary', 'low')$$,
  '23514',
  'schedule_import_model_not_enabled',
  'arbitrary provider model IDs are rejected'
);
select is(
  (select count(*) from public.admin_list_schedule_import_models()),
  3::bigint,
  'administrators can inspect only the server allowlist'
);
select lives_ok(
  $$select public.admin_update_schedule_import_settings('gemini-3.5-flash', 'medium', 3072)$$,
  'an administrator can change production model settings without a deployment'
);
select is(
  (select production_thinking_level
   from public.admin_list_schedule_import_models()
   where is_active),
  'medium',
  'the production model change takes effect immediately'
);
select is(
  (select count(*) from public.audit_logs
   where action_type = 'schedule_import_model_configuration_changed'
     and administrator_id = '10000000-0000-4000-8000-000000000001'),
  1::bigint,
  'production model changes are audited'
);
select isnt(
  public.record_schedule_import_diagnostic(
    'success',
    'gemini-3.5-flash',
    'medium',
    3072,
    'exact safe prompt',
    '{"schedule":true,"rows":[]}',
    '{"schedule":true,"rows":[]}'::jsonb,
    '[]'::jsonb,
    null,
    125,
    '[{"index":1,"mime_type":"image/png","byte_size":1234}]'::jsonb
  ),
  null::uuid,
  'explicit admin developer mode can create a temporary diagnostic log'
);
select is(
  (select raw_output from public.admin_list_schedule_import_diagnostics()
   where prompt = 'exact safe prompt'),
  '{"schedule":true,"rows":[]}',
  'admin diagnostic inspection returns the exact raw provider output'
);
select throws_ok(
  $$select public.record_schedule_import_diagnostic(
    'provider_error', 'gemini-3.5-flash', 'medium', 3072,
    'prompt', null, null, '[]'::jsonb,
    '{"authorization":"Bearer stolen-token"}'::jsonb,
    1, '[{"index":1,"mime_type":"image/png","byte_size":10}]'::jsonb
  )$$,
  '23514',
  'sensitive_diagnostic_payload_rejected',
  'tokens and authorization data are rejected from diagnostic logs'
);

reset role;
update private.schedule_import_models
set supports_structured_output = false
where model_id = 'gemini-3.5-flash';
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select * from public.schedule_import_prepare(true, 'gemini-3.5-flash', 'low')$$,
  '23514',
  'schedule_import_model_incompatible',
  'enabled models lacking a required capability are rejected'
);

reset role;
update private.schedule_import_models
set supports_structured_output = true, enabled = false
where model_id = 'gemini-3.5-flash';
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select * from public.schedule_import_prepare(true, 'gemini-3.5-flash', 'low')$$,
  '23514',
  'schedule_import_model_not_enabled',
  'disabled allowlisted models cannot be selected'
);

reset role;
update private.schedule_import_models
set enabled = true
where model_id = 'gemini-3.5-flash';
insert into private.schedule_import_diagnostic_logs (
  id, administrator_id, status, model_id, thinking_level, output_token_limit,
  prompt, validation_errors, timing_ms, image_metadata, created_at, expires_at
) values (
  '95000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'success', 'gemini-3.5-flash', 'medium', 3072, 'expired prompt', '[]'::jsonb,
  1, '[]'::jsonb, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select count(*) from public.admin_list_schedule_import_diagnostics()
   where prompt = 'expired prompt'),
  0::bigint,
  'expired diagnostic logs are removed before admin inspection'
);
select ok(
  (select count(*) > 0 from public.audit_logs
   where action_type = 'schedule_import_diagnostic_logs_accessed'
     and administrator_id = '10000000-0000-4000-8000-000000000001'),
  'sensitive diagnostic-log access is audited'
);
select lives_ok(
  $$select public.admin_delete_schedule_import_diagnostic(
    (select diagnostic_id from public.admin_list_schedule_import_diagnostics()
     where prompt = 'exact safe prompt')
  )$$,
  'administrators can explicitly delete a diagnostic log'
);
select is(
  (select count(*) from public.admin_list_schedule_import_diagnostics()
   where prompt = 'exact safe prompt'),
  0::bigint,
  'deleted diagnostic contents are no longer available'
);
select is(
  (select count(*) from public.audit_logs
   where action_type = 'schedule_import_diagnostic_log_deleted'
     and administrator_id = '10000000-0000-4000-8000-000000000001'),
  1::bigint,
  'diagnostic deletion is audited without retaining the contents'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.schedule_import_prepare(false, null, null)$$,
  '42501',
  'permission denied for function schedule_import_prepare',
  'anonymous callers cannot prepare an import'
);

reset role;
select * from finish();
rollback;
