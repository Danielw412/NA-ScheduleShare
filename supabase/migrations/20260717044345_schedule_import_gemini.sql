-- Gemini schedule-import configuration, atomic rate limiting, and temporary
-- administrator diagnostics. Every table stays in the non-exposed private
-- schema; authenticated callers can reach only the narrow public wrappers.

create table private.schedule_import_models (
  model_id text primary key check (model_id ~ '^gemini-[a-z0-9.-]+$'),
  display_name text not null check (char_length(display_name) between 2 and 100),
  enabled boolean not null default false,
  supports_image_input boolean not null default false,
  supports_structured_output boolean not null default false,
  supported_thinking_levels text[] not null,
  max_output_tokens integer not null check (max_output_tokens between 256 and 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    cardinality(supported_thinking_levels) > 0
    and supported_thinking_levels <@ array['minimal', 'low', 'medium', 'high']::text[]
  )
);

insert into private.schedule_import_models (
  model_id,
  display_name,
  enabled,
  supports_image_input,
  supports_structured_output,
  supported_thinking_levels,
  max_output_tokens
)
values
  (
    'gemini-3.1-flash-lite',
    'Gemini 3.1 Flash-Lite',
    true,
    true,
    true,
    array['minimal', 'low', 'medium', 'high'],
    65536
  ),
  (
    'gemini-3.5-flash',
    'Gemini 3.5 Flash',
    true,
    true,
    true,
    array['minimal', 'low', 'medium', 'high'],
    65536
  );

create table private.schedule_import_settings (
  singleton boolean primary key default true check (singleton),
  active_model_id text not null references private.schedule_import_models(model_id),
  thinking_level text not null check (thinking_level in ('minimal', 'low', 'medium', 'high')),
  output_token_limit integer not null check (output_token_limit between 256 and 8192),
  rate_limit_max integer not null check (rate_limit_max between 1 and 100),
  rate_limit_window_seconds integer not null check (rate_limit_window_seconds between 60 and 86400),
  diagnostic_retention_seconds integer not null check (diagnostic_retention_seconds between 300 and 86400),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into private.schedule_import_settings (
  active_model_id,
  thinking_level,
  output_token_limit,
  rate_limit_max,
  rate_limit_window_seconds,
  diagnostic_retention_seconds
)
values ('gemini-3.1-flash-lite', 'low', 4096, 6, 3600, 86400);

create table private.schedule_import_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  primary key (user_id, window_started_at)
);

create index schedule_import_rate_limits_expiry_idx
on private.schedule_import_rate_limits(expires_at);

create table private.schedule_import_diagnostic_logs (
  id uuid primary key default gen_random_uuid(),
  administrator_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('success', 'validation_error', 'provider_error')),
  model_id text not null references private.schedule_import_models(model_id),
  thinking_level text not null check (thinking_level in ('minimal', 'low', 'medium', 'high')),
  output_token_limit integer not null check (output_token_limit between 256 and 8192),
  prompt text not null check (char_length(prompt) between 1 and 20000),
  raw_output text check (raw_output is null or char_length(raw_output) <= 200000),
  parsed_output jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  provider_error jsonb,
  timing_ms integer not null check (timing_ms >= 0),
  image_metadata jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (jsonb_typeof(validation_errors) = 'array'),
  check (jsonb_typeof(image_metadata) = 'array')
);

create index schedule_import_diagnostic_logs_expiry_idx
on private.schedule_import_diagnostic_logs(expires_at);

create trigger schedule_import_models_set_updated_at
before update on private.schedule_import_models
for each row execute function private.set_updated_at();

create trigger schedule_import_settings_set_updated_at
before update on private.schedule_import_settings
for each row execute function private.set_updated_at();

alter table private.schedule_import_models enable row level security;
alter table private.schedule_import_settings enable row level security;
alter table private.schedule_import_rate_limits enable row level security;
alter table private.schedule_import_diagnostic_logs enable row level security;

revoke all on table private.schedule_import_models from public, anon, authenticated;
revoke all on table private.schedule_import_settings from public, anon, authenticated;
revoke all on table private.schedule_import_rate_limits from public, anon, authenticated;
revoke all on table private.schedule_import_diagnostic_logs from public, anon, authenticated;

alter table public.audit_logs drop constraint if exists audit_logs_target_type_check;
alter table public.audit_logs add constraint audit_logs_target_type_check
check (target_type in (
  'user',
  'class',
  'course_name',
  'report',
  'role',
  'enrollment',
  'ai_model_config',
  'ai_diagnostic_log'
));

create or replace function private.consume_schedule_import_rate_limit(actor_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  maximum_requests integer;
  window_seconds integer;
  current_window timestamptz;
  consumed_count integer;
begin
  select settings.rate_limit_max, settings.rate_limit_window_seconds
    into maximum_requests, window_seconds
  from private.schedule_import_settings settings
  where settings.singleton;

  if maximum_requests is null or window_seconds is null then
    raise exception 'schedule_import_not_configured' using errcode = '55000';
  end if;

  current_window := to_timestamp((
    floor(extract(epoch from clock_timestamp()) / window_seconds) * window_seconds
  )::double precision);

  delete from private.schedule_import_rate_limits
  where expires_at < clock_timestamp();

  insert into private.schedule_import_rate_limits as rate_limit (
    user_id,
    window_started_at,
    request_count,
    expires_at
  )
  values (
    actor_id,
    current_window,
    1,
    current_window + make_interval(secs => window_seconds + 60)
  )
  on conflict (user_id, window_started_at) do update
    set request_count = rate_limit.request_count + 1
    where rate_limit.request_count < maximum_requests
  returning request_count into consumed_count;

  if consumed_count is null then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.schedule_import_prepare(
  developer_mode boolean default false,
  requested_model_id text default null,
  requested_thinking_level text default null
)
returns table (
  user_id uuid,
  is_admin boolean,
  bypassed_rate_limit boolean,
  model_id text,
  thinking_level text,
  output_token_limit integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  actor_is_admin boolean;
  selected_model_id text;
  selected_thinking_level text;
  selected_output_token_limit integer;
  model_enabled boolean;
  model_supports_images boolean;
  model_supports_structured_output boolean;
  model_thinking_levels text[];
  model_max_output_tokens integer;
begin
  actor_id := private.require_active_user();
  actor_is_admin := private.is_admin(actor_id);

  select
    settings.active_model_id,
    settings.thinking_level,
    settings.output_token_limit
  into
    selected_model_id,
    selected_thinking_level,
    selected_output_token_limit
  from private.schedule_import_settings settings
  where settings.singleton;

  if developer_mode then
    if not actor_is_admin then
      raise exception 'developer_mode_administrator_required' using errcode = '42501';
    end if;
    selected_model_id := coalesce(nullif(trim(requested_model_id), ''), selected_model_id);
    selected_thinking_level := coalesce(nullif(lower(trim(requested_thinking_level)), ''), selected_thinking_level);
  elsif requested_model_id is not null or requested_thinking_level is not null then
    raise exception 'developer_overrides_not_allowed' using errcode = '42501';
  else
    perform private.consume_schedule_import_rate_limit(actor_id);
  end if;

  select
    models.enabled,
    models.supports_image_input,
    models.supports_structured_output,
    models.supported_thinking_levels,
    models.max_output_tokens
  into
    model_enabled,
    model_supports_images,
    model_supports_structured_output,
    model_thinking_levels,
    model_max_output_tokens
  from private.schedule_import_models models
  where models.model_id = selected_model_id;

  if model_enabled is distinct from true then
    raise exception 'schedule_import_model_not_enabled' using errcode = '23514';
  end if;
  if model_supports_images is distinct from true or model_supports_structured_output is distinct from true then
    raise exception 'schedule_import_model_incompatible' using errcode = '23514';
  end if;
  if not selected_thinking_level = any(model_thinking_levels) then
    raise exception 'schedule_import_thinking_level_unsupported' using errcode = '23514';
  end if;
  if selected_output_token_limit > model_max_output_tokens then
    raise exception 'schedule_import_output_limit_unsupported' using errcode = '23514';
  end if;

  return query select
    actor_id,
    actor_is_admin,
    developer_mode,
    selected_model_id,
    selected_thinking_level,
    selected_output_token_limit;
end;
$$;

create or replace function public.schedule_import_prepare(
  p_developer_mode boolean default false,
  p_model_id text default null,
  p_thinking_level text default null
)
returns table (
  user_id uuid,
  is_admin boolean,
  bypassed_rate_limit boolean,
  model_id text,
  thinking_level text,
  output_token_limit integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.schedule_import_prepare(p_developer_mode, p_model_id, p_thinking_level);
$$;

create or replace function private.admin_list_schedule_import_models()
returns table (
  model_id text,
  display_name text,
  enabled boolean,
  supports_image_input boolean,
  supports_structured_output boolean,
  supported_thinking_levels text[],
  max_output_tokens integer,
  is_active boolean,
  production_thinking_level text,
  production_output_token_limit integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select
    models.model_id,
    models.display_name,
    models.enabled,
    models.supports_image_input,
    models.supports_structured_output,
    models.supported_thinking_levels,
    models.max_output_tokens,
    models.model_id = settings.active_model_id,
    settings.thinking_level,
    settings.output_token_limit
  from private.schedule_import_models models
  cross join private.schedule_import_settings settings
  where settings.singleton
  order by models.display_name;
end;
$$;

create or replace function public.admin_list_schedule_import_models()
returns table (
  model_id text,
  display_name text,
  enabled boolean,
  supports_image_input boolean,
  supports_structured_output boolean,
  supported_thinking_levels text[],
  max_output_tokens integer,
  is_active boolean,
  production_thinking_level text,
  production_output_token_limit integer
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_list_schedule_import_models(); $$;

create or replace function private.admin_update_schedule_import_settings(
  next_model_id text,
  next_thinking_level text,
  next_output_token_limit integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  before_data jsonb;
  after_data jsonb;
  selected_model private.schedule_import_models%rowtype;
begin
  actor_id := private.require_admin();
  select to_jsonb(settings) into before_data
  from private.schedule_import_settings settings
  where settings.singleton
  for update;

  select * into selected_model
  from private.schedule_import_models models
  where models.model_id = trim(next_model_id);

  if not found or not selected_model.enabled then
    raise exception 'schedule_import_model_not_enabled' using errcode = '23514';
  end if;
  if not selected_model.supports_image_input or not selected_model.supports_structured_output then
    raise exception 'schedule_import_model_incompatible' using errcode = '23514';
  end if;
  if not lower(trim(next_thinking_level)) = any(selected_model.supported_thinking_levels) then
    raise exception 'schedule_import_thinking_level_unsupported' using errcode = '23514';
  end if;
  if next_output_token_limit < 256
     or next_output_token_limit > 8192
     or next_output_token_limit > selected_model.max_output_tokens then
    raise exception 'schedule_import_output_limit_unsupported' using errcode = '23514';
  end if;

  update private.schedule_import_settings
  set active_model_id = selected_model.model_id,
      thinking_level = lower(trim(next_thinking_level)),
      output_token_limit = next_output_token_limit,
      updated_by = actor_id
  where singleton;

  select to_jsonb(settings) into after_data
  from private.schedule_import_settings settings
  where settings.singleton;

  perform private.write_audit(
    actor_id,
    'schedule_import_model_configuration_changed',
    'ai_model_config',
    selected_model.model_id,
    before_data,
    after_data,
    'Updated from the administrator AI settings panel'
  );
end;
$$;

create or replace function public.admin_update_schedule_import_settings(
  p_model_id text,
  p_thinking_level text,
  p_output_token_limit integer
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_update_schedule_import_settings(
    p_model_id,
    p_thinking_level,
    p_output_token_limit
  );
$$;

create or replace function private.record_schedule_import_diagnostic(
  diagnostic_status text,
  used_model_id text,
  used_thinking_level text,
  used_output_token_limit integer,
  exact_prompt text,
  gemini_raw_output text,
  parsed_result jsonb,
  result_validation_errors jsonb,
  sanitized_provider_error jsonb,
  elapsed_ms integer,
  safe_image_metadata jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  retention_seconds integer;
  diagnostic_id uuid;
  sensitive_text text;
begin
  actor_id := private.require_admin();

  if diagnostic_status not in ('success', 'validation_error', 'provider_error') then
    raise exception 'invalid_diagnostic_status' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from private.schedule_import_models models
    where models.model_id = used_model_id
      and models.enabled
      and used_thinking_level = any(models.supported_thinking_levels)
      and used_output_token_limit between 256 and least(8192, models.max_output_tokens)
  ) then
    raise exception 'invalid_diagnostic_model_configuration' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(result_validation_errors, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(safe_image_metadata) <> 'array' then
    raise exception 'invalid_diagnostic_metadata' using errcode = '23514';
  end if;
  if char_length(exact_prompt) > 20000
     or char_length(coalesce(gemini_raw_output, '')) > 200000
     or elapsed_ms < 0 then
    raise exception 'diagnostic_payload_too_large' using errcode = '23514';
  end if;

  sensitive_text := concat_ws(
    ' ',
    exact_prompt,
    gemini_raw_output,
    coalesce(parsed_result::text, ''),
    coalesce(result_validation_errors::text, ''),
    coalesce(sanitized_provider_error::text, ''),
    safe_image_metadata::text
  );
  if sensitive_text ~* '(authorization\s*:|bearer\s+[a-z0-9._-]+|x-goog-api-key|data:image/|"(data|base64|image_bytes|authorization|token|secret|api_key)"\s*:)' then
    raise exception 'sensitive_diagnostic_payload_rejected' using errcode = '23514';
  end if;

  select settings.diagnostic_retention_seconds into retention_seconds
  from private.schedule_import_settings settings
  where settings.singleton;

  delete from private.schedule_import_diagnostic_logs
  where expires_at <= clock_timestamp();

  insert into private.schedule_import_diagnostic_logs (
    administrator_id,
    status,
    model_id,
    thinking_level,
    output_token_limit,
    prompt,
    raw_output,
    parsed_output,
    validation_errors,
    provider_error,
    timing_ms,
    image_metadata,
    expires_at
  )
  values (
    actor_id,
    diagnostic_status,
    used_model_id,
    used_thinking_level,
    used_output_token_limit,
    exact_prompt,
    gemini_raw_output,
    parsed_result,
    coalesce(result_validation_errors, '[]'::jsonb),
    sanitized_provider_error,
    elapsed_ms,
    safe_image_metadata,
    clock_timestamp() + make_interval(secs => retention_seconds)
  )
  returning id into diagnostic_id;

  return diagnostic_id;
end;
$$;

create or replace function public.record_schedule_import_diagnostic(
  p_status text,
  p_model_id text,
  p_thinking_level text,
  p_output_token_limit integer,
  p_prompt text,
  p_raw_output text,
  p_parsed_output jsonb,
  p_validation_errors jsonb,
  p_provider_error jsonb,
  p_timing_ms integer,
  p_image_metadata jsonb
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_schedule_import_diagnostic(
    p_status,
    p_model_id,
    p_thinking_level,
    p_output_token_limit,
    p_prompt,
    p_raw_output,
    p_parsed_output,
    p_validation_errors,
    p_provider_error,
    p_timing_ms,
    p_image_metadata
  );
$$;

create or replace function private.admin_list_schedule_import_diagnostics()
returns table (
  diagnostic_id uuid,
  status text,
  model_id text,
  thinking_level text,
  output_token_limit integer,
  prompt text,
  raw_output text,
  parsed_output jsonb,
  validation_errors jsonb,
  provider_error jsonb,
  timing_ms integer,
  image_metadata jsonb,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  visible_count integer;
begin
  actor_id := private.require_admin();
  delete from private.schedule_import_diagnostic_logs logs
  where logs.expires_at <= clock_timestamp();

  select count(*) into visible_count
  from private.schedule_import_diagnostic_logs logs;

  perform private.write_audit(
    actor_id,
    'schedule_import_diagnostic_logs_accessed',
    'ai_diagnostic_log',
    null,
    null,
    jsonb_build_object('log_count', visible_count),
    'Viewed temporary AI diagnostic logs'
  );

  return query
  select
    logs.id,
    logs.status,
    logs.model_id,
    logs.thinking_level,
    logs.output_token_limit,
    logs.prompt,
    logs.raw_output,
    logs.parsed_output,
    logs.validation_errors,
    logs.provider_error,
    logs.timing_ms,
    logs.image_metadata,
    logs.created_at,
    logs.expires_at
  from private.schedule_import_diagnostic_logs logs
  order by logs.created_at desc
  limit 100;
end;
$$;

create or replace function public.admin_list_schedule_import_diagnostics()
returns table (
  diagnostic_id uuid,
  status text,
  model_id text,
  thinking_level text,
  output_token_limit integer,
  prompt text,
  raw_output text,
  parsed_output jsonb,
  validation_errors jsonb,
  provider_error jsonb,
  timing_ms integer,
  image_metadata jsonb,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$ select * from private.admin_list_schedule_import_diagnostics(); $$;

create or replace function private.admin_delete_schedule_import_diagnostic(target_diagnostic_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  diagnostic_summary jsonb;
begin
  actor_id := private.require_admin();
  select jsonb_build_object(
    'diagnostic_id', logs.id,
    'status', logs.status,
    'model_id', logs.model_id,
    'created_at', logs.created_at,
    'expires_at', logs.expires_at
  ) into diagnostic_summary
  from private.schedule_import_diagnostic_logs logs
  where logs.id = target_diagnostic_id
  for update;

  if not found then
    raise exception 'schedule_import_diagnostic_not_found' using errcode = 'P0002';
  end if;

  delete from private.schedule_import_diagnostic_logs
  where id = target_diagnostic_id;

  perform private.write_audit(
    actor_id,
    'schedule_import_diagnostic_log_deleted',
    'ai_diagnostic_log',
    target_diagnostic_id::text,
    diagnostic_summary,
    null,
    'Deleted from the administrator AI settings panel'
  );
end;
$$;

create or replace function public.admin_delete_schedule_import_diagnostic(p_diagnostic_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.admin_delete_schedule_import_diagnostic(p_diagnostic_id); $$;

revoke all on function private.consume_schedule_import_rate_limit(uuid) from public, anon, authenticated;
revoke all on function private.schedule_import_prepare(boolean, text, text) from public, anon, authenticated;
revoke all on function private.admin_list_schedule_import_models() from public, anon, authenticated;
revoke all on function private.admin_update_schedule_import_settings(text, text, integer) from public, anon, authenticated;
revoke all on function private.record_schedule_import_diagnostic(text, text, text, integer, text, text, jsonb, jsonb, jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function private.admin_list_schedule_import_diagnostics() from public, anon, authenticated;
revoke all on function private.admin_delete_schedule_import_diagnostic(uuid) from public, anon, authenticated;

grant execute on function private.schedule_import_prepare(boolean, text, text) to authenticated;
grant execute on function private.admin_list_schedule_import_models() to authenticated;
grant execute on function private.admin_update_schedule_import_settings(text, text, integer) to authenticated;
grant execute on function private.record_schedule_import_diagnostic(text, text, text, integer, text, text, jsonb, jsonb, jsonb, integer, jsonb) to authenticated;
grant execute on function private.admin_list_schedule_import_diagnostics() to authenticated;
grant execute on function private.admin_delete_schedule_import_diagnostic(uuid) to authenticated;

revoke all on function public.schedule_import_prepare(boolean, text, text) from public, anon;
revoke all on function public.admin_list_schedule_import_models() from public, anon;
revoke all on function public.admin_update_schedule_import_settings(text, text, integer) from public, anon;
revoke all on function public.record_schedule_import_diagnostic(text, text, text, integer, text, text, jsonb, jsonb, jsonb, integer, jsonb) from public, anon;
revoke all on function public.admin_list_schedule_import_diagnostics() from public, anon;
revoke all on function public.admin_delete_schedule_import_diagnostic(uuid) from public, anon;

grant execute on function public.schedule_import_prepare(boolean, text, text) to authenticated;
grant execute on function public.admin_list_schedule_import_models() to authenticated;
grant execute on function public.admin_update_schedule_import_settings(text, text, integer) to authenticated;
grant execute on function public.record_schedule_import_diagnostic(text, text, text, integer, text, text, jsonb, jsonb, jsonb, integer, jsonb) to authenticated;
grant execute on function public.admin_list_schedule_import_diagnostics() to authenticated;
grant execute on function public.admin_delete_schedule_import_diagnostic(uuid) to authenticated;

comment on table private.schedule_import_models is
  'Allowlisted Gemini models and capability metadata; arbitrary provider model IDs are never accepted.';
comment on table private.schedule_import_rate_limits is
  'Atomic fixed-window per-user schedule-import request counters.';
comment on table private.schedule_import_diagnostic_logs is
  'Admin-only, explicitly enabled AI diagnostics with no screenshots and a maximum 24-hour retention.';
