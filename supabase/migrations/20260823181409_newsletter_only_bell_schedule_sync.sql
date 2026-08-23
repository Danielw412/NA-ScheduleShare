-- Bell times are maintained in database definitions. The daily detector only
-- needs the newsletter source, so stop exposing, validating, and claiming the
-- legacy bell-schedule document URL without destructively dropping its column.

create or replace function private.admin_get_bell_schedule_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return (
    select jsonb_build_object(
      'school_year_start', settings.school_year_start,
      'semester_2_start', settings.semester_2_start,
      'school_year_end', settings.school_year_end,
      'default_schedule_id', settings.default_schedule_id,
      'school_timezone', settings.school_timezone,
      'sync_enabled', settings.sync_enabled,
      'sync_time', to_char(settings.sync_time, 'HH24:MI'),
      'newsletter_document_url', settings.newsletter_document_url,
      'updated_at', settings.updated_at
    ) from private.school_year_settings settings where singleton
  );
end;
$$;

create or replace function private.admin_update_bell_schedule_settings(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  first_day date := (payload ->> 'school_year_start')::date;
  semester_day date := (payload ->> 'semester_2_start')::date;
  last_day date := (payload ->> 'school_year_end')::date;
  default_id uuid := (payload ->> 'default_schedule_id')::uuid;
  daily_time text := trim(coalesce(payload ->> 'sync_time', ''));
  newsletter_url text := trim(coalesce(payload ->> 'newsletter_document_url', ''));
begin
  if not (first_day < semester_day and semester_day <= last_day) then
    raise exception 'invalid_school_year_dates' using errcode = '22023';
  end if;
  if daily_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_sync_time' using errcode = '22023';
  end if;
  if newsletter_url !~ '^https://docs[.]google[.]com/document/d/[A-Za-z0-9_-]+' then
    raise exception 'invalid_google_docs_url' using errcode = '22023';
  end if;
  if not exists (
    select 1 from private.bell_schedule_definitions schedule
    where schedule.id = default_id and schedule.archived_at is null and schedule.campus_scope = 'BOTH'
  ) then
    raise exception 'invalid_default_bell_schedule' using errcode = '22023';
  end if;
  update private.school_year_settings
  set school_year_start = first_day,
      semester_2_start = semester_day,
      school_year_end = last_day,
      default_schedule_id = default_id,
      sync_enabled = coalesce((payload ->> 'sync_enabled')::boolean, false),
      sync_time = daily_time::time,
      newsletter_document_url = newsletter_url,
      updated_by = actor_id,
      updated_at = clock_timestamp()
  where singleton;
  perform private.write_event_log(
    'admin',
    'bell_schedule_settings_updated',
    actor_id,
    null,
    'bell_schedule_settings',
    null,
    'succeeded',
    jsonb_build_object('sync_enabled', payload ->> 'sync_enabled', 'sync_time', daily_time)
  );
end;
$$;

create or replace function private.service_claim_bell_schedule_sync(
  actor_id uuid, requested_trigger text, preview_only boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings private.school_year_settings%rowtype;
  local_now timestamp without time zone := timezone('America/New_York', clock_timestamp());
  run_id uuid;
  run_trigger text;
  model_id text;
begin
  if requested_trigger not in ('scheduled', 'manual') then
    raise exception 'invalid_sync_trigger' using errcode = '22023';
  end if;
  if requested_trigger = 'manual' and not private.is_admin(actor_id) then
    raise exception 'administrator_access_required' using errcode = '42501';
  end if;
  if requested_trigger = 'scheduled' and actor_id is not null then
    raise exception 'scheduled_sync_actor_must_be_empty' using errcode = '22023';
  end if;
  select * into settings from private.school_year_settings where singleton for update;
  if requested_trigger = 'scheduled' then
    if not settings.sync_enabled
      or local_now::time < settings.sync_time
      or local_now::time >= settings.sync_time + interval '5 minutes' then
      return jsonb_build_object('claimed', false, 'reason', 'not_due');
    end if;
    if settings.last_scheduled_claim_date = local_now::date then
      return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
    end if;
    update private.school_year_settings
    set last_scheduled_claim_date = local_now::date
    where singleton;
  end if;

  run_trigger := case when preview_only then 'preview' else requested_trigger end;
  select import_settings.active_model_id into model_id
  from private.schedule_import_settings import_settings where singleton;
  insert into private.bell_schedule_sync_runs (
    trigger_type, status, actor_id, claimed_school_date, model_id
  ) values (
    run_trigger, 'running', actor_id,
    case when requested_trigger = 'scheduled' then local_now::date else null end,
    model_id
  ) returning id into run_id;

  return jsonb_build_object(
    'claimed', true,
    'run_id', run_id,
    'model_id', model_id,
    'preview', preview_only,
    'school_timezone', settings.school_timezone,
    'school_year_start', settings.school_year_start,
    'school_year_end', settings.school_year_end,
    'newsletter_document_url', settings.newsletter_document_url
  );
exception
  when unique_violation then
    return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
end;
$$;

notify pgrst, 'reload schema';
