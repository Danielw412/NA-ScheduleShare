-- Preserve the reset initiator's identity/elevated access and the reusable
-- course catalog while returning the rest of the site to first-run state.

create or replace function private.get_site_reset_preview()
returns table (accounts bigint, profiles bigint, classes bigint, course_names bigint, enrollments bigint, reports bigint, profile_pictures bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_super_admin();
begin
  return query select
    (select count(*) from auth.users where id <> actor_id)::bigint,
    (select count(*) from public.profiles)::bigint,
    (select count(*) from public.classes)::bigint,
    0::bigint,
    (select count(*) from public.class_enrollments)::bigint,
    (select count(*) from public.reports)::bigint,
    (select count(*) from storage.objects where bucket_id = 'profile-pictures')::bigint;
end;
$$;

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
  delete from public.reports;
  delete from public.schedule_access_requests;
  delete from public.schedule_access_grants;
  delete from public.schedule_share_links;
  delete from public.classes;
  delete from public.schedule_change_history;
  delete from private.schedule_import_diagnostic_logs;
  delete from private.schedule_import_rate_limits;
  delete from private.schedule_import_guest_rate_limits;
  delete from private.rate_limit_events;
  delete from private.user_activity_metrics;
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

create or replace function public.service_reset_site_data(p_actor_id uuid, p_confirmation text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.reset_site_data(p_actor_id, p_confirmation); $$;

revoke all on function public.service_reset_site_data(uuid, text) from public, anon, authenticated;
grant execute on function public.service_reset_site_data(uuid, text) to service_role;

comment on function private.reset_site_data(uuid, text) is
  'Resets site/user content while preserving the initiator Auth account, administrator and protected-access grants, course catalog, configuration, and protected logs.';

notify pgrst, 'reload schema';
