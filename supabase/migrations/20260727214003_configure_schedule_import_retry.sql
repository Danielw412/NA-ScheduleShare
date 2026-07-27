alter table private.schedule_import_settings
add column retry_incomplete_results boolean not null default true;

drop function public.get_schedule_import_ui_settings();

create function public.get_schedule_import_ui_settings()
returns table (
  progress_bar_duration_ms integer,
  retry_incomplete_results boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    settings.progress_bar_duration_ms,
    settings.retry_incomplete_results
  from private.schedule_import_settings settings
  where settings.singleton;
$$;

create function private.admin_update_schedule_import_retry_setting(
  next_retry_incomplete_results boolean
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
begin
  actor_id := private.require_admin();

  select to_jsonb(settings) into before_data
  from private.schedule_import_settings settings
  where settings.singleton
  for update;

  update private.schedule_import_settings
  set retry_incomplete_results = next_retry_incomplete_results,
      updated_by = actor_id
  where singleton;

  select to_jsonb(settings) into after_data
  from private.schedule_import_settings settings
  where settings.singleton;

  perform private.write_audit(
    actor_id,
    'schedule_import_retry_configuration_changed',
    'ai_model_config',
    'retry_incomplete_results',
    before_data,
    after_data,
    'Updated from the administrator AI settings panel'
  );
end;
$$;

create function public.admin_update_schedule_import_retry_setting(
  p_retry_incomplete_results boolean
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_update_schedule_import_retry_setting(p_retry_incomplete_results);
$$;

revoke all on function public.get_schedule_import_ui_settings() from public, anon, authenticated;
grant execute on function public.get_schedule_import_ui_settings() to anon, authenticated, service_role;

revoke all on function private.admin_update_schedule_import_retry_setting(boolean) from public, anon, authenticated;
grant execute on function private.admin_update_schedule_import_retry_setting(boolean) to authenticated;

revoke all on function public.admin_update_schedule_import_retry_setting(boolean) from public, anon;
grant execute on function public.admin_update_schedule_import_retry_setting(boolean) to authenticated;

comment on function public.get_schedule_import_ui_settings()
  is 'Returns non-sensitive screenshot importer presentation and retry settings.';

notify pgrst, 'reload schema';
