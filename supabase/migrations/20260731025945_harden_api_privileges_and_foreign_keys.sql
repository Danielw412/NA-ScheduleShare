-- Keep the Data API surface explicit. Supabase projects created under the
-- 2026 defaults no longer expose new public objects automatically, while
-- older projects may still grant every new function directly to anon.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;

-- Guest schedule imports read these relations through a secret-key client.
-- Secret keys use the service_role database role and still require ordinary
-- table privileges even though that role bypasses RLS.
grant select on table
  public.course_names,
  public.classes,
  public.class_meeting_slots
to service_role;

-- These endpoints all enforce authenticated/admin access internally, but an
-- older project default also granted anon EXECUTE at function creation time.
-- Reconcile the effective grants rather than relying on the function body to
-- reject anonymous traffic.
revoke all on function public.is_current_user_super_admin() from public, anon, authenticated;
revoke all on function public.super_admin_add(text) from public, anon, authenticated;
revoke all on function public.super_admin_list_logs(text, text, text, text, timestamptz, timestamptz, text, integer, integer) from public, anon, authenticated;
revoke all on function public.super_admin_delete_log(uuid, text) from public, anon, authenticated;
revoke all on function public.super_admin_delete_logs(text, text, text, text, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.super_admin_get_activity_summary() from public, anon, authenticated;
revoke all on function public.super_admin_get_site_reset_preview() from public, anon, authenticated;
revoke all on function public.mark_user_active() from public, anon, authenticated;
revoke all on function public.record_share_button_pressed() from public, anon, authenticated;
revoke all on function public.record_authenticated_event(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_schedule_import_event(text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_record_profile_picture_removed(uuid, text) from public, anon, authenticated;

grant execute on function public.is_current_user_super_admin() to authenticated;
grant execute on function public.super_admin_add(text) to authenticated;
grant execute on function public.super_admin_list_logs(text, text, text, text, timestamptz, timestamptz, text, integer, integer) to authenticated;
grant execute on function public.super_admin_delete_log(uuid, text) to authenticated;
grant execute on function public.super_admin_delete_logs(text, text, text, text, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.super_admin_get_activity_summary() to authenticated;
grant execute on function public.super_admin_get_site_reset_preview() to authenticated;
grant execute on function public.mark_user_active() to authenticated;
grant execute on function public.record_share_button_pressed() to authenticated;
grant execute on function public.record_authenticated_event(text, text, jsonb) to authenticated;
grant execute on function public.record_schedule_import_event(text, uuid, text, jsonb) to authenticated;
grant execute on function public.admin_record_profile_picture_removed(uuid, text) to authenticated;

-- Foreign-key indexes keep account deletion, moderation, model changes, and
-- site reset operations from taking full-table locks/scans as data grows.
create index if not exists account_moderation_suspended_by_idx
  on private.account_moderation(suspended_by);
create index if not exists homepage_statistic_settings_updated_by_idx
  on private.homepage_statistic_settings(updated_by);
create index if not exists schedule_import_diagnostic_logs_administrator_id_idx
  on private.schedule_import_diagnostic_logs(administrator_id);
create index if not exists schedule_import_diagnostic_logs_model_id_idx
  on private.schedule_import_diagnostic_logs(model_id);
create index if not exists schedule_import_settings_active_model_id_idx
  on private.schedule_import_settings(active_model_id);
create index if not exists schedule_import_settings_updated_by_idx
  on private.schedule_import_settings(updated_by);
create index if not exists user_roles_granted_by_idx
  on private.user_roles(granted_by);
create index if not exists audit_logs_administrator_id_idx
  on public.audit_logs(administrator_id);
create index if not exists classes_created_by_idx
  on public.classes(created_by);
create index if not exists course_names_created_by_idx
  on public.course_names(created_by);
create index if not exists reports_assigned_admin_id_idx
  on public.reports(assigned_admin_id);
create index if not exists reports_reporter_id_idx
  on public.reports(reporter_id);
create index if not exists schedule_change_history_changed_by_idx
  on public.schedule_change_history(changed_by);
