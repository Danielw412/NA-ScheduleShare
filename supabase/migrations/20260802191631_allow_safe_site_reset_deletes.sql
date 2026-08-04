-- Supabase production enables the safeupdate guard for API sessions. Keep each
-- intentional whole-table delete explicit so the protected reset can run
-- without disabling that project-level safeguard.

create or replace function private.reset_site_data(actor_id uuid, confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_initial_name text;
  actor_snapshot text;
  reset_counts jsonb;
begin
  perform private.require_super_admin(actor_id);
  if confirmation <> 'RESET SCHEDULESHARE KEEP MY ADMIN ACCOUNT AND COURSE NAMES' then
    raise exception 'site_reset_confirmation_mismatch' using errcode = '22023';
  end if;

  select profile.full_name
    into actor_snapshot
  from public.profiles profile
  where profile.id = actor_id;

  select coalesce(
    nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
    nullif(auth_user.raw_user_meta_data ->> 'name', ''),
    'New Student'
  )
    into actor_initial_name
  from auth.users auth_user
  where auth_user.id = actor_id;

  if actor_initial_name is null then
    raise exception 'site_reset_actor_not_found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'accounts', (select count(*) from auth.users where id <> actor_id),
    'profiles', (select count(*) from public.profiles),
    'classes', (select count(*) from public.classes),
    'course_names', 0,
    'enrollments', (select count(*) from public.class_enrollments),
    'reports', (select count(*) from public.reports)
  ) into reset_counts;

  perform set_config('app.suppress_event_logs', 'on', true);
  delete from public.reports where true;
  delete from public.schedule_access_requests where true;
  delete from public.schedule_access_grants where true;
  delete from public.schedule_share_links where true;
  delete from public.classes where true;
  delete from public.schedule_change_history where true;
  delete from private.schedule_import_diagnostic_logs where true;
  delete from private.schedule_import_rate_limits where true;
  delete from private.schedule_import_guest_rate_limits where true;
  delete from private.rate_limit_events where true;
  delete from private.user_activity_metrics where true;
  delete from auth.users where id <> actor_id;

  update public.profiles
  set full_name = actor_initial_name,
      grade = null,
      privacy_setting = 'classmates',
      onboarding_completed = false,
      students_visited_at = null,
      last_login_at = null,
      last_active_at = null,
      created_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = actor_id;

  insert into private.account_moderation (user_id)
  values (actor_id)
  on conflict (user_id) do update
  set suspended_at = null,
      suspended_by = null,
      suspension_reason = null,
      deleted_at = null,
      updated_at = clock_timestamp();

  insert into private.user_roles (user_id, role, granted_by)
  values (actor_id, 'administrator', actor_id)
  on conflict (user_id) do nothing;

  perform set_config('app.suppress_event_logs', 'off', true);
  insert into public.event_logs (
    log_category, event_type, actor_user_id, actor_name, target_type, result, metadata
  ) values (
    'admin', 'site_reset_completed', actor_id, actor_snapshot, 'site', 'succeeded', reset_counts
  );
  return reset_counts;
end;
$$;

comment on function private.reset_site_data(uuid, text) is
  'Resets site/user content while preserving the initiator Auth account, administrator and protected-access grants, course catalog, configuration, and protected logs.';;
