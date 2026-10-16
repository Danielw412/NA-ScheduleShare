-- First-party issue tracking for application errors (docs/observability.md).
--
-- The browser, Edge Functions, and the Schedule Engine worker report errors
-- here, grouped into issues by fingerprint, until (and alongside) a Sentry
-- integration. Reports are untrusted input: every field is validated,
-- truncated, and sanitized; ingestion is rate limited per account, through a
-- shared anonymous budget, and by an hourly ceiling; storage is bounded per
-- issue and pruned daily; administrators can pause ingestion entirely.
-- Only administrators can read issues. Events store an opaque account id at
-- most — never names, emails, or schedule data.

create table private.app_issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (fingerprint ~ '^[a-z0-9_-]{8,64}$'),
  source text not null check (source in ('web', 'edge_function', 'worker', 'schedule_engine')),
  level text not null check (level in ('debug', 'info', 'warning', 'error', 'fatal')),
  title text not null check (char_length(title) between 1 and 300),
  culprit text check (culprit is null or char_length(culprit) <= 300),
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  event_count bigint not null default 0 check (event_count >= 0),
  user_count integer not null default 0 check (user_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  first_release text check (first_release is null or char_length(first_release) <= 64),
  last_release text check (last_release is null or char_length(last_release) <= 64),
  environment text check (environment is null or char_length(environment) <= 32),
  regressed_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

create index app_issues_status_last_seen_idx on private.app_issues (status, last_seen_at desc);

create table private.app_issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references private.app_issues(id) on delete cascade,
  event_id text not null unique check (event_id ~ '^[0-9a-f]{32}$'),
  user_id uuid references public.profiles(id) on delete set null,
  level text not null check (level in ('debug', 'info', 'warning', 'error', 'fatal')),
  message text not null check (char_length(message) between 1 and 500),
  exception_type text check (exception_type is null or char_length(exception_type) <= 120),
  stacktrace jsonb not null default '[]'::jsonb check (jsonb_typeof(stacktrace) = 'array'),
  breadcrumbs jsonb not null default '[]'::jsonb check (jsonb_typeof(breadcrumbs) = 'array'),
  tags jsonb not null default '{}'::jsonb check (jsonb_typeof(tags) = 'object'),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  created_at timestamptz not null default now()
);

create index app_issue_events_issue_created_idx on private.app_issue_events (issue_id, created_at desc);
create index app_issue_events_user_idx on private.app_issue_events (user_id) where user_id is not null;
create index app_issue_events_created_idx on private.app_issue_events (created_at);

create table private.app_issue_users (
  issue_id uuid not null references private.app_issues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (issue_id, user_id)
);

create index app_issue_users_user_idx on private.app_issue_users (user_id);

-- Per-minute ingestion counters: one row per account, one shared row for
-- anonymous visitors, and an hourly cap on brand-new fingerprints.
create table private.app_issue_ingest_windows (
  window_start timestamptz not null,
  scope text not null check (char_length(scope) between 3 and 64),
  event_count integer not null default 0,
  primary key (window_start, scope)
);

-- Administrator kill switch for ingestion (for example during abuse).
create table private.app_issue_settings (
  singleton boolean primary key default true check (singleton),
  ingest_enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into private.app_issue_settings (singleton) values (true) on conflict (singleton) do nothing;

alter table private.app_issue_settings enable row level security;
alter table private.app_issues enable row level security;
alter table private.app_issue_events enable row level security;
alter table private.app_issue_users enable row level security;
alter table private.app_issue_ingest_windows enable row level security;
revoke all on table private.app_issues, private.app_issue_events, private.app_issue_users, private.app_issue_ingest_windows, private.app_issue_settings
  from public, anon, authenticated;

-- Short, single-line text: trimmed, control characters removed, truncated.
create function private.issue_text(value jsonb, max_length integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(trim(regexp_replace(value #>> '{}', '[[:cntrl:]]+', ' ', 'g')), max_length), '')
  where value is not null and jsonb_typeof(value) in ('string', 'number', 'boolean');
$$;

-- Stack frames: at most 30, each reduced to known keys with bounded values.
create function private.issue_stacktrace(frames jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'function', private.issue_text(frame.value -> 'function', 120),
    'filename', private.issue_text(frame.value -> 'filename', 200),
    'lineno', case when jsonb_typeof(frame.value -> 'lineno') = 'number' then frame.value -> 'lineno' end,
    'colno', case when jsonb_typeof(frame.value -> 'colno') = 'number' then frame.value -> 'colno' end,
    'in_app', case when jsonb_typeof(frame.value -> 'in_app') = 'boolean' then frame.value -> 'in_app' end
  )) order by frame.ordinality), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(frames) = 'array' then frames else '[]'::jsonb end)
    with ordinality frame(value, ordinality)
  where frame.ordinality <= 30 and jsonb_typeof(frame.value) = 'object';
$$;

-- Breadcrumbs: at most 20, known keys only, data passed through the shared
-- event-log sanitizer that strips tokens, URLs, prompts, and images.
create function private.issue_breadcrumbs(crumbs jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'timestamp', case when jsonb_typeof(crumb.value -> 'timestamp') = 'number' then crumb.value -> 'timestamp' end,
    'category', private.issue_text(crumb.value -> 'category', 40),
    'message', private.issue_text(crumb.value -> 'message', 200),
    'level', private.issue_text(crumb.value -> 'level', 10),
    'data', case when jsonb_typeof(crumb.value -> 'data') = 'object'
      and pg_column_size(crumb.value -> 'data') <= 1024
      then private.safe_event_metadata(crumb.value -> 'data') end
  )) order by crumb.ordinality), '[]'::jsonb)
  from (
    select value, ordinality
    from jsonb_array_elements(case when jsonb_typeof(crumbs) = 'array' then crumbs else '[]'::jsonb end)
      with ordinality item(value, ordinality)
    where jsonb_typeof(value) = 'object'
    order by ordinality desc
    limit 20
  ) crumb;
$$;

-- Tags: at most 20 string pairs with short keys.
create function private.issue_tags(tags jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(tag.key, private.issue_text(tag.value, 120)), '{}'::jsonb)
  from (
    select key, value
    from jsonb_each(case when jsonb_typeof(tags) = 'object' then tags else '{}'::jsonb end)
    where key ~ '^[A-Za-z0-9_.:-]{1,40}$'
      and private.issue_text(value, 120) is not null
    order by key
    limit 20
  ) tag;
$$;

-- Context: an allowlist of descriptive keys only.
create function private.issue_context(context jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'route', private.issue_text(context -> 'route', 200),
    'release', private.issue_text(context -> 'release', 64),
    'environment', private.issue_text(context -> 'environment', 32),
    'viewport', private.issue_text(context -> 'viewport', 20),
    'user_agent', private.issue_text(context -> 'user_agent', 200),
    'request_id', private.issue_text(context -> 'request_id', 100),
    'function', private.issue_text(context -> 'function', 64),
    'job_id', private.issue_text(context -> 'job_id', 64),
    'extra', case when jsonb_typeof(context -> 'extra') = 'object' and pg_column_size(context -> 'extra') <= 4096
      then private.safe_event_metadata(context -> 'extra') end
  ))
  where jsonb_typeof(context) = 'object';
$$;

-- Atomically counts one event against a window; true while under the limit.
create function private.consume_issue_budget(budget_scope text, budget_window timestamptz, maximum_events integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  insert into private.app_issue_ingest_windows as windows (window_start, scope, event_count)
  values (budget_window, budget_scope, 1)
  on conflict (window_start, scope) do update set event_count = windows.event_count + 1
  returning windows.event_count into current_count;
  return current_count <= maximum_events;
end;
$$;

-- Validates and stores one event. Returns the issue id, or null when the
-- report was rejected. Never raises for malformed input: reporting must not
-- create new errors for the reporter.
create function private.ingest_app_issue(event jsonb, reporter_id uuid, event_source text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  event_fingerprint text;
  event_level text;
  event_title text;
  event_identifier text;
  event_context jsonb;
  event_release text;
  issue_row private.app_issues;
  is_new_issue boolean := false;
  added_user integer := 0;
  inserted_events integer := 0;
  maximum_bytes integer;
begin
  if event_source not in ('web', 'edge_function', 'worker', 'schedule_engine') then
    return null;
  end if;
  -- Browser reports are untrusted and anonymous-capable, so they get a
  -- smaller size limit than server reports.
  maximum_bytes := case when event_source = 'web' then 6144 else 16384 end;
  if event is null or jsonb_typeof(event) <> 'object' or pg_column_size(event) > maximum_bytes then
    return null;
  end if;
  if not coalesce((select settings.ingest_enabled from private.app_issue_settings settings where settings.singleton), true) then
    return null;
  end if;

  event_fingerprint := lower(private.issue_text(event -> 'fingerprint', 64));
  event_level := lower(private.issue_text(event -> 'level', 10));
  event_title := private.issue_text(event -> 'message', 300);
  event_identifier := lower(private.issue_text(event -> 'event_id', 32));
  if event_fingerprint is null or event_fingerprint !~ '^[a-z0-9_-]{8,64}$'
    or event_level is null or event_level not in ('warning', 'error', 'fatal')
    or event_title is null
    or event_identifier is null or event_identifier !~ '^[0-9a-f]{32}$' then
    return null;
  end if;

  event_context := coalesce(private.issue_context(event -> 'context'), '{}'::jsonb);
  event_release := event_context ->> 'release';

  select * into issue_row from private.app_issues where fingerprint = event_fingerprint for update;
  if not found then
    -- Separate budgets, so browser spam can never starve server reports.
    if not private.consume_issue_budget(
      case when event_source = 'web' then 'new_issue:web' else 'new_issue:server' end,
      date_trunc('hour', now()),
      case when event_source = 'web' then 40 else 60 end
    ) then
      return null;
    end if;
    insert into private.app_issues (fingerprint, source, level, title, culprit, first_release, last_release, environment)
    values (
      event_fingerprint,
      event_source,
      event_level,
      event_title,
      private.issue_text(event -> 'culprit', 300),
      event_release,
      event_release,
      event_context ->> 'environment'
    )
    on conflict (fingerprint) do nothing
    returning * into issue_row;
    if found then
      is_new_issue := true;
    else
      -- Another report created the same issue concurrently.
      select * into issue_row from private.app_issues where fingerprint = event_fingerprint for update;
    end if;
  end if;

  insert into private.app_issue_events (issue_id, event_id, user_id, level, message, exception_type, stacktrace, breadcrumbs, tags, context)
  values (
    issue_row.id,
    event_identifier,
    reporter_id,
    event_level,
    left(coalesce(private.issue_text(event -> 'message', 500), event_title), 500),
    private.issue_text(event -> 'exception_type', 120),
    private.issue_stacktrace(event -> 'stacktrace'),
    private.issue_breadcrumbs(event -> 'breadcrumbs'),
    private.issue_tags(event -> 'tags'),
    event_context
  )
  on conflict (event_id) do nothing;
  get diagnostics inserted_events = row_count;
  if inserted_events = 0 then
    -- A retried report: the event is already stored.
    return issue_row.id;
  end if;

  if reporter_id is not null then
    insert into private.app_issue_users (issue_id, user_id)
    values (issue_row.id, reporter_id)
    on conflict do nothing;
    get diagnostics added_user = row_count;
  end if;

  update private.app_issues
  set event_count = event_count + 1,
      user_count = user_count + added_user,
      last_seen_at = now(),
      last_release = coalesce(event_release, last_release),
      level = case when event_level = 'fatal' or (event_level = 'error' and level = 'warning') then event_level else level end,
      -- A new occurrence of a resolved issue is a regression: reopen it.
      status = case when status = 'resolved' then 'open' else status end,
      regressed_at = case when status = 'resolved' then now() else regressed_at end,
      resolved_at = case when status = 'resolved' then null else resolved_at end,
      resolved_by = case when status = 'resolved' then null else resolved_by end
  where id = issue_row.id;

  -- Keep the 25 most recent sample events per issue.
  delete from private.app_issue_events
  where id in (
    select sample.id
    from private.app_issue_events sample
    where sample.issue_id = issue_row.id
    order by sample.created_at desc, sample.id
    offset 25
  );

  -- Server-side issues are rare and worth an event-log line; browser issues
  -- are not logged there, so anonymous reports cannot flood the event log.
  if is_new_issue and event_source <> 'web' then
    perform private.write_event_log(
      'admin', 'app_issue_created', null, null, 'app_issue', issue_row.id::text, event_level,
      jsonb_build_object('source', event_source, 'fingerprint', event_fingerprint)
    );
  end if;

  return issue_row.id;
end;
$$;

-- Browser entry point: anyone may report, within tight budgets. Returns
-- nothing so the endpoint reveals no information about stored issues.
create function public.report_app_issue(p_event jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  minute_start timestamptz := date_trunc('minute', now());
begin
  -- Per-account and shared anonymous limits, then hourly and daily ceilings
  -- (anonymous and signed-in counted separately) so total storage stays
  -- bounded under abuse: at most 2,000 browser events a day.
  if actor_id is not null then
    if not private.is_active_user(actor_id) then return; end if;
    if not private.consume_issue_budget('user:' || actor_id::text, minute_start, 10) then return; end if;
    if not private.consume_issue_budget('web:signed_in:day', date_trunc('day', now()), 1500) then return; end if;
  else
    if not private.consume_issue_budget('anonymous', minute_start, 30) then return; end if;
    if not private.consume_issue_budget('web:anonymous:day', date_trunc('day', now()), 500) then return; end if;
  end if;
  if not private.consume_issue_budget('web', date_trunc('hour', now()), 300) then return; end if;
  perform private.ingest_app_issue(p_event, actor_id, 'web');
end;
$$;

-- Server entry point for Edge Functions and the Schedule Engine worker
-- (service role only). p_user_id, when known, must be a real profile.
create function public.service_report_app_issue(p_event jsonb, p_source text, p_user_id uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  reporter uuid := case
    when p_user_id is not null and exists (select 1 from public.profiles profile where profile.id = p_user_id) then p_user_id
  end;
begin
  if p_source not in ('edge_function', 'worker', 'schedule_engine') then
    raise exception 'invalid_issue_source' using errcode = '22023';
  end if;
  if not private.consume_issue_budget('service:' || p_source, date_trunc('minute', now()), 120) then
    return null;
  end if;
  return private.ingest_app_issue(p_event, reporter, p_source);
end;
$$;

create function public.admin_list_app_issues(
  p_status text default 'open',
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  fingerprint text,
  source text,
  level text,
  title text,
  culprit text,
  status text,
  event_count bigint,
  user_count integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  first_release text,
  last_release text,
  environment text,
  regressed_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_text text := nullif(left(trim(coalesce(p_search, '')), 100), '');
begin
  perform private.require_admin();
  if p_status not in ('open', 'resolved', 'ignored', 'all') then
    raise exception 'invalid_issue_status' using errcode = '22023';
  end if;
  return query
  select issue.id, issue.fingerprint, issue.source, issue.level, issue.title, issue.culprit, issue.status,
         issue.event_count, issue.user_count, issue.first_seen_at, issue.last_seen_at,
         issue.first_release, issue.last_release, issue.environment, issue.regressed_at,
         count(*) over () as total_count
  from private.app_issues issue
  where (p_status = 'all' or issue.status = p_status)
    and (search_text is null
      or issue.title ilike '%' || search_text || '%'
      or issue.culprit ilike '%' || search_text || '%'
      or issue.fingerprint = lower(search_text))
  order by issue.last_seen_at desc, issue.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- Account ids on sample events are visible to super administrators only,
-- matching who can see per-account activity elsewhere.
create function public.admin_get_app_issue(p_issue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  actor_id uuid := private.require_admin();
  show_accounts boolean := private.is_super_admin(actor_id);
begin
  select (to_jsonb(issue) - 'resolved_by') || jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id', sample.event_id,
        'level', sample.level,
        'message', sample.message,
        'exception_type', sample.exception_type,
        'user_id', case when show_accounts then sample.user_id end,
        'stacktrace', sample.stacktrace,
        'breadcrumbs', sample.breadcrumbs,
        'tags', sample.tags,
        'context', sample.context,
        'created_at', sample.created_at
      ) order by sample.created_at desc)
      from (
        select *
        from private.app_issue_events event_row
        where event_row.issue_id = issue.id
        order by event_row.created_at desc
        limit 10
      ) sample
    ), '[]'::jsonb)
  )
  into result
  from private.app_issues issue
  where issue.id = p_issue_id;
  if result is null then
    raise exception 'app_issue_not_found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- Students see the first 8 characters of an event id as their error reference.
create function public.admin_find_app_issue_by_reference(p_reference text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reference text := lower(trim(coalesce(p_reference, '')));
  found_issue uuid;
begin
  perform private.require_admin();
  if reference !~ '^[0-9a-f]{8,32}$' then
    raise exception 'invalid_error_reference' using errcode = '22023';
  end if;
  select sample.issue_id into found_issue
  from private.app_issue_events sample
  where sample.event_id like reference || '%'
  order by sample.created_at desc
  limit 1;
  return found_issue;
end;
$$;

create function public.admin_update_app_issue_status(p_issue_id uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  previous_status text;
begin
  if p_status not in ('open', 'resolved', 'ignored') then
    raise exception 'invalid_issue_status' using errcode = '22023';
  end if;
  select status into previous_status from private.app_issues where id = p_issue_id for update;
  if not found then
    raise exception 'app_issue_not_found' using errcode = 'P0002';
  end if;
  update private.app_issues
  set status = p_status,
      resolved_at = case when p_status = 'resolved' then now() end,
      resolved_by = case when p_status = 'resolved' then actor_id end,
      regressed_at = case when p_status = 'open' then regressed_at end
  where id = p_issue_id;
  perform private.write_event_log(
    'admin', 'app_issue_status_changed', actor_id, null, 'app_issue', p_issue_id::text, p_status,
    jsonb_build_object('previous_status', previous_status)
  );
end;
$$;

create function public.admin_delete_app_issue(p_issue_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  deleted_title text;
begin
  delete from private.app_issues where id = p_issue_id returning title into deleted_title;
  if deleted_title is null then
    raise exception 'app_issue_not_found' using errcode = 'P0002';
  end if;
  perform private.write_event_log(
    'admin', 'app_issue_deleted', actor_id, null, 'app_issue', p_issue_id::text, 'deleted', '{}'::jsonb
  );
end;
$$;

-- Administrator settings for the issue store.
create function public.admin_get_app_issue_settings()
returns table (ingest_enabled boolean, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select settings.ingest_enabled, settings.updated_at
  from private.app_issue_settings settings
  where settings.singleton;
end;
$$;

create function public.admin_set_app_issue_ingest(p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
begin
  if p_enabled is null then
    raise exception 'invalid_issue_setting' using errcode = '22023';
  end if;
  update private.app_issue_settings
  set ingest_enabled = p_enabled, updated_by = actor_id, updated_at = now()
  where singleton;
  perform private.write_event_log(
    'admin', 'app_issue_ingest_changed', actor_id, null, 'app_issue_settings', 'ingest', case when p_enabled then 'enabled' else 'disabled' end, '{}'::jsonb
  );
end;
$$;

-- Daily retention: anonymous browser samples for 7 days, other samples for
-- 30 days, issues nobody has hit in 90 days, ingestion counters for two days.
create function private.prune_app_issues()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from private.app_issue_events event_row
  using private.app_issues issue
  where issue.id = event_row.issue_id
    and issue.source = 'web'
    and event_row.user_id is null
    and event_row.created_at < now() - interval '7 days';
  delete from private.app_issue_events where created_at < now() - interval '30 days';
  delete from private.app_issues where last_seen_at < now() - interval '90 days';
  delete from private.app_issue_ingest_windows where window_start < now() - interval '2 days';
$$;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'app-issue-retention' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('app-issue-retention', '17 9 * * *', 'select private.prune_app_issues();');
end;
$$;

revoke all on function private.issue_text(jsonb, integer) from public, anon, authenticated;
revoke all on function private.issue_stacktrace(jsonb) from public, anon, authenticated;
revoke all on function private.issue_breadcrumbs(jsonb) from public, anon, authenticated;
revoke all on function private.issue_tags(jsonb) from public, anon, authenticated;
revoke all on function private.issue_context(jsonb) from public, anon, authenticated;
revoke all on function private.consume_issue_budget(text, timestamptz, integer) from public, anon, authenticated;
revoke all on function private.ingest_app_issue(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function private.prune_app_issues() from public, anon, authenticated;

revoke all on function public.report_app_issue(jsonb) from public, anon, authenticated;
grant execute on function public.report_app_issue(jsonb) to anon, authenticated;

revoke all on function public.service_report_app_issue(jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.service_report_app_issue(jsonb, text, uuid) to service_role;

revoke all on function public.admin_list_app_issues(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_get_app_issue(uuid) from public, anon, authenticated;
revoke all on function public.admin_find_app_issue_by_reference(text) from public, anon, authenticated;
revoke all on function public.admin_update_app_issue_status(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_delete_app_issue(uuid) from public, anon, authenticated;
revoke all on function public.admin_get_app_issue_settings() from public, anon, authenticated;
revoke all on function public.admin_set_app_issue_ingest(boolean) from public, anon, authenticated;
grant execute on function public.admin_get_app_issue_settings() to authenticated;
grant execute on function public.admin_set_app_issue_ingest(boolean) to authenticated;
grant execute on function public.admin_list_app_issues(text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_app_issue(uuid) to authenticated;
grant execute on function public.admin_find_app_issue_by_reference(text) to authenticated;
grant execute on function public.admin_update_app_issue_status(uuid, text) to authenticated;
grant execute on function public.admin_delete_app_issue(uuid) to authenticated;

comment on function public.report_app_issue(jsonb)
  is 'Accepts one scrubbed browser error report into the bounded, rate-limited first-party issue store.';
comment on function public.service_report_app_issue(jsonb, text, uuid)
  is 'Service-role error reporting for Edge Functions and the Schedule Engine worker.';

notify pgrst, 'reload schema';
