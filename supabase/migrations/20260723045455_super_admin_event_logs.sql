-- Centralized, privacy-conscious event logging and hidden elevated administration.

alter table public.profiles
  add column if not exists last_login_at timestamptz,
  add column if not exists last_active_at timestamptz;

create table public.event_logs (
  id uuid primary key default gen_random_uuid(),
  log_category text not null check (log_category in ('security', 'audit', 'import', 'admin')),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  actor_user_id uuid,
  actor_name text,
  subject_user_id uuid,
  subject_name text,
  target_type text,
  target_id text,
  result text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index event_logs_created_at_idx on public.event_logs (created_at desc);
create index event_logs_category_created_at_idx on public.event_logs (log_category, created_at desc);
create index event_logs_event_type_created_at_idx on public.event_logs (event_type, created_at desc);
create index event_logs_actor_user_id_idx on public.event_logs (actor_user_id, created_at desc) where actor_user_id is not null;
create index event_logs_subject_user_id_idx on public.event_logs (subject_user_id, created_at desc) where subject_user_id is not null;
create index event_logs_target_id_idx on public.event_logs (target_id, created_at desc) where target_id is not null;

alter table public.event_logs enable row level security;
revoke all on table public.event_logs from public, anon, authenticated;
grant all on table public.event_logs to service_role;

create table private.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

create table private.user_activity_metrics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  share_button_press_count bigint not null default 0 check (share_button_press_count >= 0),
  schedule_import_count bigint not null default 0 check (schedule_import_count >= 0),
  schedule_access_request_count bigint not null default 0 check (schedule_access_request_count >= 0),
  updated_at timestamptz not null default now()
);

revoke all on table private.super_admins, private.user_activity_metrics from public, anon, authenticated;

insert into private.super_admins (user_id)
select id
from auth.users
where lower(email) = 'danielruoqiao@gmail.com'
on conflict (user_id) do nothing;

create or replace function private.is_super_admin(candidate_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select candidate_user_id is not null
    and private.is_active_user(candidate_user_id)
    and (
      exists (
        select 1
        from auth.users auth_user
        where auth_user.id = candidate_user_id
          and lower(auth_user.email) = 'danielruoqiao@gmail.com'
      )
      or exists (
        select 1
        from private.super_admins elevated
        where elevated.user_id = candidate_user_id
      )
    );
$$;

create or replace function private.require_super_admin(candidate_user_id uuid default auth.uid())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_super_admin(candidate_user_id) then
    raise exception 'elevated_administrator_access_required' using errcode = '42501';
  end if;
  return candidate_user_id;
end;
$$;

create or replace function private.safe_event_metadata(input_metadata jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare sanitized jsonb;
begin
  if input_metadata is null then return '{}'::jsonb; end if;
  if jsonb_typeof(input_metadata) = 'object' then
    select coalesce(jsonb_object_agg(item.key, private.safe_event_metadata(item.value)), '{}'::jsonb)
    into sanitized
    from jsonb_each(input_metadata) item
    where lower(item.key) not in (
      'image', 'image_contents', 'uploaded_image', 'schedule_image', 'image_url',
      'image_metadata', 'file_metadata', 'permanent_url', 'signed_url', 'url',
      'prompt', 'complete_prompt', 'response', 'raw_response', 'complete_response',
      'share_token', 'token', 'password'
    );
    return sanitized;
  end if;
  if jsonb_typeof(input_metadata) = 'array' then
    select coalesce(jsonb_agg(private.safe_event_metadata(item.value)), '[]'::jsonb)
    into sanitized
    from jsonb_array_elements(input_metadata) item(value);
    return sanitized;
  end if;
  return input_metadata;
end;
$$;

create or replace function private.write_event_log(
  event_category text,
  event_name text,
  actor_id uuid default null,
  subject_id uuid default null,
  event_target_type text default null,
  event_target_id text default null,
  event_result text default null,
  event_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
  actor_snapshot text;
  subject_snapshot text;
begin
  if current_setting('app.suppress_event_logs', true) = 'on' then
    return null;
  end if;
  if event_category not in ('security', 'audit', 'import', 'admin') then
    raise exception 'invalid_event_category' using errcode = '23514';
  end if;
  select profile.full_name into actor_snapshot from public.profiles profile where profile.id = actor_id;
  select profile.full_name into subject_snapshot from public.profiles profile where profile.id = subject_id;
  insert into public.event_logs (
    log_category, event_type, actor_user_id, actor_name, subject_user_id, subject_name,
    target_type, target_id, result, metadata
  ) values (
    event_category, event_name, actor_id, actor_snapshot, subject_id, subject_snapshot,
    event_target_type, event_target_id, event_result, private.safe_event_metadata(event_metadata)
  ) returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.is_current_user_super_admin()
returns boolean
language sql
stable
set search_path = ''
as $$ select private.is_super_admin(auth.uid()); $$;

revoke all on function public.is_current_user_super_admin() from public;
grant execute on function public.is_current_user_super_admin() to authenticated;

create or replace function private.add_super_admin(target_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_super_admin();
  target_user_id uuid;
begin
  select auth_user.id into target_user_id
  from auth.users auth_user
  where lower(auth_user.email) = lower(trim(target_email));
  if target_user_id is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  insert into private.super_admins (user_id, granted_by)
  values (target_user_id, actor_id)
  on conflict (user_id) do nothing;
  perform private.write_event_log(
    'admin', 'elevated_access_granted', actor_id, target_user_id, 'user', target_user_id::text,
    'succeeded', jsonb_build_object('grant_method', 'exact_email_lookup')
  );
  return target_user_id;
end;
$$;

create or replace function public.super_admin_add(p_email text)
returns uuid
language sql
set search_path = ''
as $$ select private.add_super_admin(p_email); $$;

revoke all on function public.super_admin_add(text) from public;
grant execute on function public.super_admin_add(text) to authenticated;

create or replace function private.list_event_logs(
  category_filter text default null,
  event_filter text default null,
  user_filter text default null,
  target_filter text default null,
  created_from timestamptz default null,
  created_to timestamptz default null,
  result_filter text default null,
  row_limit integer default 100,
  row_offset integer default 0
)
returns table (
  id uuid,
  log_category text,
  event_type text,
  actor_user_id uuid,
  actor_name text,
  subject_user_id uuid,
  subject_name text,
  target_type text,
  target_id text,
  result text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_super_admin();
  normalized_user_filter text := nullif(trim(user_filter), '');
begin
  perform private.write_event_log(
    'admin', 'audit_logs_accessed', actor_id, null, 'event_logs', null, 'succeeded',
    jsonb_build_object(
      'category_filter', category_filter,
      'event_filter', nullif(trim(event_filter), ''),
      'user_filter_used', normalized_user_filter is not null,
      'target_filter_used', nullif(trim(target_filter), '') is not null
    )
  );
  return query
  select log.id, log.log_category, log.event_type, log.actor_user_id, log.actor_name,
         log.subject_user_id, log.subject_name, log.target_type, log.target_id,
         log.result, log.metadata, log.created_at
  from public.event_logs log
  where (category_filter is null or category_filter = '' or log.log_category = category_filter)
    and (event_filter is null or trim(event_filter) = '' or log.event_type ilike '%' || trim(event_filter) || '%')
    and (
      normalized_user_filter is null
      or log.actor_name ilike '%' || normalized_user_filter || '%'
      or log.subject_name ilike '%' || normalized_user_filter || '%'
      or log.actor_user_id::text = normalized_user_filter
      or log.subject_user_id::text = normalized_user_filter
    )
    and (
      target_filter is null or trim(target_filter) = ''
      or log.target_id ilike '%' || trim(target_filter) || '%'
      or log.target_type ilike '%' || trim(target_filter) || '%'
    )
    and (created_from is null or log.created_at >= created_from)
    and (created_to is null or log.created_at <= created_to)
    and (result_filter is null or result_filter = '' or log.result = result_filter)
  order by log.created_at desc, log.id desc
  limit greatest(1, least(coalesce(row_limit, 100), 250))
  offset greatest(0, coalesce(row_offset, 0));
end;
$$;

create or replace function public.super_admin_list_logs(
  p_category text default null,
  p_event text default null,
  p_user text default null,
  p_target text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_result text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid, log_category text, event_type text, actor_user_id uuid, actor_name text,
  subject_user_id uuid, subject_name text, target_type text, target_id text,
  result text, metadata jsonb, created_at timestamptz
)
language sql
set search_path = ''
as $$
  select * from private.list_event_logs(
    p_category, p_event, p_user, p_target, p_created_from, p_created_to,
    p_result, p_limit, p_offset
  );
$$;

revoke all on function public.super_admin_list_logs(text, text, text, text, timestamptz, timestamptz, text, integer, integer) from public;
grant execute on function public.super_admin_list_logs(text, text, text, text, timestamptz, timestamptz, text, integer, integer) to authenticated;

create or replace function private.delete_event_log(log_id uuid, confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_super_admin();
  expected text := 'DELETE LOG ' || upper(left(replace(log_id::text, '-', ''), 8));
  deleted_type text;
begin
  if confirmation <> expected then
    raise exception 'log_deletion_confirmation_mismatch' using errcode = '22023';
  end if;
  delete from public.event_logs where id = log_id returning event_type into deleted_type;
  if deleted_type is null then raise exception 'log_not_found' using errcode = 'P0002'; end if;
  perform private.write_event_log(
    'admin', 'log_permanently_deleted', actor_id, null, 'event_log', log_id::text,
    'succeeded', jsonb_build_object('deleted_event_type', deleted_type)
  );
end;
$$;

create or replace function public.super_admin_delete_log(p_log_id uuid, p_confirmation text)
returns void
language sql
set search_path = ''
as $$ select private.delete_event_log(p_log_id, p_confirmation); $$;

revoke all on function public.super_admin_delete_log(uuid, text) from public;
grant execute on function public.super_admin_delete_log(uuid, text) to authenticated;

create or replace function private.delete_event_logs(
  category_filter text,
  event_filter text,
  user_filter text,
  target_filter text,
  created_from timestamptz,
  created_to timestamptz,
  result_filter text,
  confirmation text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_super_admin();
  normalized_user_filter text := nullif(trim(user_filter), '');
  removed_count integer;
begin
  if confirmation <> 'DELETE FILTERED LOGS PERMANENTLY' then
    raise exception 'log_deletion_confirmation_mismatch' using errcode = '22023';
  end if;
  delete from public.event_logs log
  where (category_filter is null or category_filter = '' or log.log_category = category_filter)
    and (event_filter is null or trim(event_filter) = '' or log.event_type ilike '%' || trim(event_filter) || '%')
    and (
      normalized_user_filter is null
      or log.actor_name ilike '%' || normalized_user_filter || '%'
      or log.subject_name ilike '%' || normalized_user_filter || '%'
      or log.actor_user_id::text = normalized_user_filter
      or log.subject_user_id::text = normalized_user_filter
    )
    and (
      target_filter is null or trim(target_filter) = ''
      or log.target_id ilike '%' || trim(target_filter) || '%'
      or log.target_type ilike '%' || trim(target_filter) || '%'
    )
    and (created_from is null or log.created_at >= created_from)
    and (created_to is null or log.created_at <= created_to)
    and (result_filter is null or result_filter = '' or log.result = result_filter);
  get diagnostics removed_count = row_count;
  perform private.write_event_log(
    'admin', 'logs_permanently_deleted', actor_id, null, 'event_logs', null,
    'succeeded', jsonb_build_object(
      'deleted_count', removed_count,
      'category_filter', category_filter,
      'event_filter_used', nullif(trim(event_filter), '') is not null,
      'user_filter_used', normalized_user_filter is not null,
      'target_filter_used', nullif(trim(target_filter), '') is not null,
      'created_from', created_from,
      'created_to', created_to,
      'result_filter', result_filter
    )
  );
  return removed_count;
end;
$$;

create or replace function public.super_admin_delete_logs(
  p_category text default null,
  p_event text default null,
  p_user text default null,
  p_target text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_result text default null,
  p_confirmation text default ''
)
returns integer
language sql
set search_path = ''
as $$ select private.delete_event_logs(p_category, p_event, p_user, p_target, p_created_from, p_created_to, p_result, p_confirmation); $$;

revoke all on function public.super_admin_delete_logs(text, text, text, text, timestamptz, timestamptz, text, text) from public;
grant execute on function public.super_admin_delete_logs(text, text, text, text, timestamptz, timestamptz, text, text) to authenticated;

create or replace function private.get_activity_summary()
returns table (
  total_users bigint,
  daily_active_users bigint,
  weekly_active_users bigint,
  schedule_imports bigint,
  schedules_shared bigint,
  access_requests bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  return query
  select
    (select count(*) from public.profiles)::bigint,
    (select count(*) from public.profiles where last_active_at >= now() - interval '1 day')::bigint,
    (select count(*) from public.profiles where last_active_at >= now() - interval '7 days')::bigint,
    coalesce((select sum(schedule_import_count) from private.user_activity_metrics), 0)::bigint,
    coalesce((select sum(share_button_press_count) from private.user_activity_metrics), 0)::bigint,
    coalesce((select sum(schedule_access_request_count) from private.user_activity_metrics), 0)::bigint;
end;
$$;

create or replace function public.super_admin_get_activity_summary()
returns table (
  total_users bigint, daily_active_users bigint, weekly_active_users bigint,
  schedule_imports bigint, schedules_shared bigint, access_requests bigint
)
language sql
set search_path = ''
as $$ select * from private.get_activity_summary(); $$;

revoke all on function public.super_admin_get_activity_summary() from public;
grant execute on function public.super_admin_get_activity_summary() to authenticated;

create or replace function private.mark_user_active()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then return; end if;
  update public.profiles
  set last_active_at = now()
  where id = actor_id
    and (last_active_at is null or last_active_at < now() - interval '10 minutes');
end;
$$;

create or replace function public.mark_user_active()
returns void
language sql
set search_path = ''
as $$ select private.mark_user_active(); $$;

revoke all on function public.mark_user_active() from public;
grant execute on function public.mark_user_active() to authenticated;

create or replace function private.record_share_button_pressed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := private.require_active_user();
begin
  insert into private.user_activity_metrics (user_id, share_button_press_count)
  values (actor_id, 1)
  on conflict (user_id) do update
    set share_button_press_count = private.user_activity_metrics.share_button_press_count + 1,
        updated_at = now();
end;
$$;

create or replace function public.record_share_button_pressed()
returns void
language sql
set search_path = ''
as $$ select private.record_share_button_pressed(); $$;

revoke all on function public.record_share_button_pressed() from public;
grant execute on function public.record_share_button_pressed() to authenticated;

create or replace function private.record_auth_attempt(event_name text, attempted_email text, event_result text, error_category text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  email_hash text;
begin
  if event_name not in ('login_failed', 'login_blocked_rate_limit', 'password_reset_requested', 'password_reset_failed') then
    raise exception 'unsupported_auth_event' using errcode = '22023';
  end if;
  email_hash := encode(extensions.digest(lower(trim(coalesce(attempted_email, ''))), 'sha256'), 'hex');
  select auth_user.id into target_user_id
  from auth.users auth_user
  where lower(auth_user.email) = lower(trim(attempted_email));
  if exists (
    select 1 from public.event_logs log
    where log.event_type = event_name
      and log.metadata ->> 'email_hash' = email_hash
      and log.created_at > now() - interval '1 minute'
  ) then return; end if;
  perform private.write_event_log(
    'security', event_name, null, target_user_id, 'authentication', null,
    nullif(event_result, ''), jsonb_build_object('email_hash', email_hash, 'error_category', nullif(error_category, ''))
  );
end;
$$;

create or replace function public.record_auth_attempt(
  p_event_type text,
  p_email text,
  p_result text default null,
  p_error_category text default null
)
returns void
language sql
set search_path = ''
as $$ select private.record_auth_attempt(p_event_type, p_email, p_result, p_error_category); $$;

revoke all on function public.record_auth_attempt(text, text, text, text) from public;
grant execute on function public.record_auth_attempt(text, text, text, text) to anon, authenticated;

create or replace function private.record_authenticated_event(event_name text, event_result text, event_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if event_name not in (
    'login_succeeded', 'login_blocked_suspended', 'logout_all_devices', 'password_reset_completed', 'password_reset_failed',
    'profile_picture_changed', 'profile_picture_removed', 'profile_picture_rejected',
    'schedule_cleared', 'schedule_replaced', 'authorization_denied', 'admin_action_denied'
  ) then raise exception 'unsupported_authenticated_event' using errcode = '22023'; end if;
  perform private.write_event_log(
    case when event_name like 'profile_%' or event_name like 'schedule_%' then 'audit' else 'security' end,
    event_name, actor_id, actor_id, 'user', actor_id::text, nullif(event_result, ''), event_metadata
  );
  if event_name = 'login_succeeded' then
    update public.profiles set last_login_at = now(), last_active_at = now() where id = actor_id;
  end if;
end;
$$;

create or replace function public.record_authenticated_event(
  p_event_type text,
  p_result text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$ select private.record_authenticated_event(p_event_type, p_result, p_metadata); $$;

revoke all on function public.record_authenticated_event(text, text, jsonb) from public;
grant execute on function public.record_authenticated_event(text, text, jsonb) to authenticated;

create or replace function private.record_schedule_import_event(
  event_name text,
  import_id uuid,
  event_result text,
  event_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if event_name not in (
    'schedule_import_started', 'schedule_import_succeeded', 'schedule_import_failed',
    'schedule_import_partially_succeeded', 'schedule_import_needs_review',
    'schedule_import_review_completed', 'schedule_import_review_skipped',
    'schedule_import_corrected', 'schedule_import_rejected', 'schedule_import_rate_limited',
    'schedule_import_invalid_image', 'schedule_import_no_schedule_detected',
    'schedule_import_course_unmatched', 'schedule_import_period_uncertain',
    'schedule_import_conflict_detected'
  ) then raise exception 'unsupported_import_event' using errcode = '22023'; end if;
  perform private.write_event_log(
    'import', event_name, actor_id, actor_id, 'schedule_import', import_id::text,
    nullif(event_result, ''), event_metadata || jsonb_build_object('import_id', import_id)
  );
  if event_name = 'schedule_import_started' then
    insert into private.user_activity_metrics (user_id, schedule_import_count)
    values (actor_id, 1)
    on conflict (user_id) do update
      set schedule_import_count = private.user_activity_metrics.schedule_import_count + 1,
          updated_at = now();
  end if;
end;
$$;

create or replace function public.record_schedule_import_event(
  p_event_type text,
  p_import_id uuid,
  p_result text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$ select private.record_schedule_import_event(p_event_type, p_import_id, p_result, p_metadata); $$;

revoke all on function public.record_schedule_import_event(text, uuid, text, jsonb) from public;
grant execute on function public.record_schedule_import_event(text, uuid, text, jsonb) to authenticated;

create or replace function private.admin_record_profile_picture_removed(target_user_id uuid, action_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := private.require_admin();
begin
  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  perform private.write_audit(
    actor_id, 'profile_picture_removed', 'user', target_user_id::text,
    jsonb_build_object('profile_picture', 'present_or_unknown'),
    jsonb_build_object('profile_picture', 'removed'), action_reason
  );
  perform private.write_event_log(
    'audit', 'profile_picture_removed', actor_id, target_user_id, 'user', target_user_id::text,
    'succeeded', jsonb_build_object('removed_by_administrator', true)
  );
end;
$$;

create or replace function public.admin_record_profile_picture_removed(p_user_id uuid, p_reason text)
returns void
language sql
set search_path = ''
as $$ select private.admin_record_profile_picture_removed(p_user_id, p_reason); $$;

revoke all on function public.admin_record_profile_picture_removed(uuid, text) from public;
grant execute on function public.admin_record_profile_picture_removed(uuid, text) to authenticated;

drop policy if exists profile_pictures_delete_admin on storage.objects;
create policy profile_pictures_delete_admin
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-pictures'
  and private.is_admin((select auth.uid()))
);

create or replace function private.capture_profile_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := coalesce(auth.uid(), new.id);
begin
  if tg_op = 'INSERT' then
    perform private.write_event_log('security', 'account_created', new.id, new.id, 'user', new.id::text, 'succeeded', '{}'::jsonb);
    return new;
  end if;
  if old.full_name is distinct from new.full_name then
    perform private.write_event_log('audit', 'profile_name_changed', actor_id, new.id, 'user', new.id::text, 'succeeded', jsonb_build_object('old_value', old.full_name, 'new_value', new.full_name));
  end if;
  if old.privacy_setting is distinct from new.privacy_setting then
    perform private.write_event_log('audit', 'schedule_privacy_changed', actor_id, new.id, 'user', new.id::text, 'succeeded', jsonb_build_object('old_value', old.privacy_setting, 'new_value', new.privacy_setting));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_capture_events on public.profiles;
create trigger profiles_capture_events after insert or update on public.profiles
for each row execute function private.capture_profile_events();

create or replace function private.capture_admin_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_event_log(
    'admin', new.action_type, new.administrator_id, null, new.target_type, new.target_id,
    'succeeded', jsonb_build_object('before', new.before_values, 'after', new.after_values, 'reason', new.reason)
  );
  return new;
end;
$$;

drop trigger if exists audit_logs_capture_event on public.audit_logs;
create trigger audit_logs_capture_event after insert on public.audit_logs
for each row execute function private.capture_admin_audit_event();

create or replace function private.capture_schedule_history_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare mapped_event text;
declare class_id text := coalesce(new.new_value ->> 'class_id', new.previous_value ->> 'class_id');
begin
  mapped_event := case new.action::text
    when 'class_added' then 'schedule_class_added'
    when 'class_removed' then 'schedule_class_removed'
    when 'class_replaced' then 'schedule_class_changed'
    when 'term_changed' then 'schedule_term_changed'
    when 'meeting_slots_changed' then 'schedule_period_changed'
    else 'schedule_manually_edited'
  end;
  perform private.write_event_log(
    'audit', mapped_event, new.changed_by, new.student_id, 'class', class_id,
    'succeeded', jsonb_build_object('old_value', new.previous_value, 'new_value', new.new_value)
  );
  if new.action::text = 'class_added' and not exists (
    select 1 from public.schedule_change_history earlier
    where earlier.student_id = new.student_id and earlier.id <> new.id and earlier.created_at <= new.created_at
  ) then
    perform private.write_event_log('audit', 'schedule_created', new.changed_by, new.student_id, 'schedule', new.student_id::text, 'succeeded', '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_history_capture_event on public.schedule_change_history;
create trigger schedule_history_capture_event after insert on public.schedule_change_history
for each row execute function private.capture_schedule_history_event();

create or replace function private.capture_class_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare event_name text;
declare row_id uuid;
declare actor_id uuid;
declare changed_fields jsonb := '[]'::jsonb;
begin
  if tg_op = 'DELETE' then
    row_id := old.id;
    actor_id := coalesce(auth.uid(), old.created_by);
    event_name := 'class_deleted';
  elsif tg_op = 'INSERT' then
    row_id := new.id;
    actor_id := coalesce(auth.uid(), new.created_by);
    event_name := 'class_created';
  else
    row_id := new.id;
    actor_id := coalesce(auth.uid(), new.created_by, old.created_by);
    if old.course_name_id is not distinct from new.course_name_id
       and old.teacher_last_name is not distinct from new.teacher_last_name
       and old.default_academic_term is not distinct from new.default_academic_term
       and old.is_double_period is not distinct from new.is_double_period
       and old.status is not distinct from new.status then return new; end if;
    event_name := case when new.status::text = 'merged' and old.status::text <> 'merged' then 'class_merged' else 'class_updated' end;
    changed_fields := jsonb_build_array(
      case when old.course_name_id is distinct from new.course_name_id then 'course_name_id' end,
      case when old.teacher_last_name is distinct from new.teacher_last_name then 'teacher_last_name' end,
      case when old.default_academic_term is distinct from new.default_academic_term then 'default_academic_term' end,
      case when old.is_double_period is distinct from new.is_double_period then 'is_double_period' end,
      case when old.status is distinct from new.status then 'status' end
    );
  end if;
  perform private.write_event_log(
    'audit', event_name, actor_id, null, 'class', row_id::text, 'succeeded',
    jsonb_build_object('changed_fields', changed_fields)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists classes_capture_event on public.classes;
create trigger classes_capture_event after insert or update or delete on public.classes
for each row execute function private.capture_class_event();

create or replace function private.capture_course_name_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare event_name text;
declare row_id uuid;
declare actor_id uuid;
begin
  if tg_op = 'DELETE' then
    row_id := old.id;
    actor_id := coalesce(auth.uid(), old.created_by);
  else
    row_id := new.id;
    actor_id := coalesce(auth.uid(), new.created_by);
  end if;
  event_name := case tg_op when 'INSERT' then 'course_catalog_entry_created' when 'DELETE' then 'course_catalog_entry_deleted' else 'course_catalog_entry_updated' end;
  if tg_op = 'UPDATE' and old.name is not distinct from new.name and old.status is not distinct from new.status then return new; end if;
  perform private.write_event_log(
    'audit', event_name, actor_id, null, 'course_name', row_id::text, 'succeeded',
    case when tg_op = 'UPDATE' then jsonb_build_object('old_name', old.name, 'new_name', new.name, 'old_status', old.status, 'new_status', new.status) else '{}'::jsonb end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists course_names_capture_event on public.course_names;
create trigger course_names_capture_event after insert or update or delete on public.course_names
for each row execute function private.capture_course_name_event();

create or replace function private.capture_meeting_slot_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare class_id uuid;
begin
  if tg_op = 'DELETE' then class_id := old.class_id; else class_id := new.class_id; end if;
  perform private.write_event_log(
    'audit', 'class_updated', auth.uid(), null, 'class', class_id::text, 'succeeded',
    jsonb_build_object(
      'changed_fields', jsonb_build_array('meeting_slots'), 'operation', lower(tg_op),
      'old_value', case when tg_op <> 'INSERT' then jsonb_build_object('day_type', old.day_type, 'period_number', old.period_number) end,
      'new_value', case when tg_op <> 'DELETE' then jsonb_build_object('day_type', new.day_type, 'period_number', new.period_number) end
    )
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists class_meeting_slots_capture_event on public.class_meeting_slots;
create trigger class_meeting_slots_capture_event after insert or update or delete on public.class_meeting_slots
for each row execute function private.capture_meeting_slot_event();

create or replace function private.capture_enrollment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare enrollment public.class_enrollments%rowtype;
declare actor_id uuid := auth.uid();
declare event_name text;
begin
  if tg_op = 'DELETE' then enrollment := old; else enrollment := new; end if;
  if tg_op = 'INSERT' and new.active then event_name := 'user_joined_class';
  elsif tg_op = 'DELETE' and old.active then event_name := case when actor_id = old.student_id then 'user_left_class' else 'user_removed_from_class' end;
  elsif tg_op = 'UPDATE' and old.active and not new.active then event_name := case when actor_id = new.student_id then 'user_left_class' else 'user_removed_from_class' end;
  elsif tg_op = 'UPDATE' and not old.active and new.active then event_name := 'user_joined_class';
  elsif tg_op = 'DELETE' then return old;
  else return new; end if;
  perform private.write_event_log(
    'audit', event_name, actor_id, enrollment.student_id, 'class', enrollment.class_id::text,
    'succeeded', jsonb_build_object('enrollment_id', enrollment.id, 'academic_term', enrollment.academic_term)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists class_enrollments_capture_event on public.class_enrollments;
create trigger class_enrollments_capture_event after insert or update or delete on public.class_enrollments
for each row execute function private.capture_enrollment_event();

create or replace function private.capture_access_request_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare event_name text;
declare actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    event_name := 'schedule_access_requested';
    insert into private.user_activity_metrics (user_id, schedule_access_request_count)
    values (new.requester_id, 1)
    on conflict (user_id) do update
      set schedule_access_request_count = private.user_activity_metrics.schedule_access_request_count + 1,
          updated_at = now();
  elsif old.status is distinct from new.status then
    event_name := case new.status::text when 'approved' then 'schedule_access_request_accepted' when 'declined' then 'schedule_access_request_rejected' else 'schedule_access_request_cancelled' end;
  else return new; end if;
  perform private.write_event_log(
    'audit', event_name, actor_id, new.owner_id, 'schedule_access_request', new.id::text,
    new.status::text, jsonb_build_object('requester_id', new.requester_id, 'owner_id', new.owner_id, 'access_type', 'full_schedule')
  );
  return new;
end;
$$;

drop trigger if exists schedule_access_requests_capture_event on public.schedule_access_requests;
create trigger schedule_access_requests_capture_event after insert or update on public.schedule_access_requests
for each row execute function private.capture_access_request_event();

create or replace function private.capture_access_grant_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.revoked_at is null and new.revoked_at is not null then
    perform private.write_event_log(
      'audit', 'schedule_access_revoked', auth.uid(), new.owner_id, 'schedule_access_grant', new.owner_id::text || ':' || new.viewer_id::text,
      'revoked', jsonb_build_object('viewer_id', new.viewer_id, 'owner_id', new.owner_id, 'access_type', 'full_schedule', 'granted_via', new.granted_via)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_access_grants_capture_event on public.schedule_access_grants;
create trigger schedule_access_grants_capture_event after update on public.schedule_access_grants
for each row execute function private.capture_access_grant_event();

create or replace function private.capture_share_link_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare event_name text;
begin
  if tg_op = 'INSERT' then event_name := 'share_link_created';
  elsif old.token is distinct from new.token then event_name := 'share_link_regenerated';
  elsif old.enabled and not new.enabled then event_name := 'share_link_revoked';
  else return new; end if;
  perform private.write_event_log(
    'audit', event_name, auth.uid(), new.owner_id, 'schedule_share_link', new.id::text,
    'succeeded', '{}'::jsonb
  );
  return new;
end;
$$;

drop trigger if exists schedule_share_links_capture_event on public.schedule_share_links;
create trigger schedule_share_links_capture_event after insert or update on public.schedule_share_links
for each row execute function private.capture_share_link_event();

create or replace function private.capture_moderation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.suspended_at is null and new.suspended_at is not null then
    perform private.write_event_log('security', 'account_suspended', coalesce(auth.uid(), new.suspended_by), new.user_id, 'user', new.user_id::text, 'succeeded', jsonb_build_object('reason', new.suspension_reason));
  elsif old.suspended_at is not null and new.suspended_at is null then
    perform private.write_event_log('security', 'account_unsuspended', auth.uid(), new.user_id, 'user', new.user_id::text, 'succeeded', '{}'::jsonb);
  end if;
  if old.deleted_at is null and new.deleted_at is not null then
    perform private.write_event_log('security', 'account_deletion_requested', coalesce(auth.uid(), new.suspended_by), new.user_id, 'user', new.user_id::text, 'succeeded', '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists account_moderation_capture_event on private.account_moderation;
create trigger account_moderation_capture_event after update on private.account_moderation
for each row execute function private.capture_moderation_event();

create or replace function private.service_record_account_event(target_user_id uuid, event_name text, event_result text, event_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if event_name not in ('account_deletion_requested', 'account_deleted', 'account_deletion_failed') then
    raise exception 'unsupported_account_event' using errcode = '22023';
  end if;
  perform private.write_event_log('security', event_name, target_user_id, target_user_id, 'user', target_user_id::text, event_result, event_metadata);
end;
$$;

create or replace function public.service_record_account_event(p_user_id uuid, p_event_type text, p_result text default null, p_metadata jsonb default '{}'::jsonb)
returns void
language sql
set search_path = ''
as $$ select private.service_record_account_event(p_user_id, p_event_type, p_result, p_metadata); $$;

revoke all on function public.service_record_account_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.service_record_account_event(uuid, text, text, jsonb) to service_role;

create or replace function private.get_site_reset_preview()
returns table (accounts bigint, profiles bigint, classes bigint, course_names bigint, enrollments bigint, reports bigint, profile_pictures bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  return query select
    (select count(*) from auth.users)::bigint,
    (select count(*) from public.profiles)::bigint,
    (select count(*) from public.classes)::bigint,
    (select count(*) from public.course_names)::bigint,
    (select count(*) from public.class_enrollments)::bigint,
    (select count(*) from public.reports)::bigint,
    (select count(*) from storage.objects where bucket_id = 'profile-pictures')::bigint;
end;
$$;

create or replace function public.super_admin_get_site_reset_preview()
returns table (accounts bigint, profiles bigint, classes bigint, course_names bigint, enrollments bigint, reports bigint, profile_pictures bigint)
language sql
set search_path = ''
as $$ select * from private.get_site_reset_preview(); $$;

revoke all on function public.super_admin_get_site_reset_preview() from public;
grant execute on function public.super_admin_get_site_reset_preview() to authenticated;

create or replace function private.reset_site_data(actor_id uuid, confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_snapshot text;
  reset_counts jsonb;
begin
  perform private.require_super_admin(actor_id);
  if confirmation <> 'RESET SCHEDULESHARE DELETE ALL ACCOUNTS AND CLASSES' then
    raise exception 'site_reset_confirmation_mismatch' using errcode = '22023';
  end if;
  select full_name into actor_snapshot from public.profiles where id = actor_id;
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'profiles', (select count(*) from public.profiles),
    'classes', (select count(*) from public.classes),
    'course_names', (select count(*) from public.course_names),
    'enrollments', (select count(*) from public.class_enrollments),
    'reports', (select count(*) from public.reports)
  ) into reset_counts;
  perform set_config('app.suppress_event_logs', 'on', true);
  delete from public.reports;
  delete from public.schedule_access_requests;
  delete from public.schedule_access_grants;
  delete from public.schedule_share_links;
  delete from public.classes;
  delete from public.course_names;
  delete from private.schedule_import_diagnostic_logs;
  delete from private.schedule_import_rate_limits;
  delete from private.schedule_import_guest_rate_limits;
  delete from private.rate_limit_events;
  delete from auth.users;
  perform set_config('app.suppress_event_logs', 'off', true);
  insert into public.event_logs (
    log_category, event_type, actor_user_id, actor_name, target_type, result, metadata
  ) values (
    'admin', 'site_reset_completed', actor_id, actor_snapshot, 'site', 'succeeded', reset_counts
  );
  return reset_counts;
end;
$$;

create or replace function public.service_reset_site_data(p_actor_id uuid, p_confirmation text)
returns jsonb
language sql
set search_path = ''
as $$ select private.reset_site_data(p_actor_id, p_confirmation); $$;

revoke all on function public.service_reset_site_data(uuid, text) from public, anon, authenticated;
grant execute on function public.service_reset_site_data(uuid, text) to service_role;

-- Existing audit/history records remain private to the selected elevated administrators.
drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_super_admin
on public.audit_logs for select to authenticated
using (private.is_super_admin((select auth.uid())));

drop policy if exists schedule_history_select_owner_or_admin on public.schedule_change_history;
create policy schedule_history_select_owner_or_super_admin
on public.schedule_change_history for select to authenticated
using (
  private.is_active_user((select auth.uid()))
  and (student_id = (select auth.uid()) or private.is_super_admin((select auth.uid())))
);

grant select on public.event_logs to service_role;

-- Bring forward existing immutable records without exposing additional private data.
insert into public.event_logs (
  log_category, event_type, actor_user_id, actor_name, target_type, target_id, result, metadata, created_at
)
select
  'admin', audit.action_type, audit.administrator_id, profile.full_name,
  audit.target_type, audit.target_id, 'succeeded',
  private.safe_event_metadata(jsonb_build_object('before', audit.before_values, 'after', audit.after_values, 'reason', audit.reason)),
  audit.created_at
from public.audit_logs audit
left join public.profiles profile on profile.id = audit.administrator_id;

insert into public.event_logs (
  log_category, event_type, actor_user_id, actor_name, subject_user_id, subject_name,
  target_type, target_id, result, metadata, created_at
)
select
  'audit',
  case history.action::text
    when 'class_added' then 'schedule_class_added'
    when 'class_removed' then 'schedule_class_removed'
    when 'class_replaced' then 'schedule_class_changed'
    when 'term_changed' then 'schedule_term_changed'
    when 'meeting_slots_changed' then 'schedule_period_changed'
    else 'schedule_manually_edited'
  end,
  history.changed_by, actor.full_name, history.student_id, subject.full_name,
  'class', coalesce(history.new_value ->> 'class_id', history.previous_value ->> 'class_id'),
  'succeeded', private.safe_event_metadata(jsonb_build_object('old_value', history.previous_value, 'new_value', history.new_value)),
  history.created_at
from public.schedule_change_history history
left join public.profiles actor on actor.id = history.changed_by
left join public.profiles subject on subject.id = history.student_id;
