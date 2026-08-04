-- Keep privilege-elevated implementations outside the exposed API schema.
-- Public entrypoints are deliberately SECURITY INVOKER wrappers, matching the
-- project's established admin/RPC pattern.

alter function public.create_schedule_engine_job(jsonb, boolean) set schema private;
alter function public.list_my_schedule_engine_jobs(integer) set schema private;
alter function public.cancel_my_schedule_engine_job(uuid) set schema private;
alter function public.admin_list_schedule_engine_jobs(integer) set schema private;

revoke all on function private.create_schedule_engine_job(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.list_my_schedule_engine_jobs(integer) from public, anon, authenticated;
revoke all on function private.cancel_my_schedule_engine_job(uuid) from public, anon, authenticated;
revoke all on function private.admin_list_schedule_engine_jobs(integer) from public, anon, authenticated;
grant execute on function private.create_schedule_engine_job(jsonb, boolean) to authenticated;
grant execute on function private.list_my_schedule_engine_jobs(integer) to authenticated;
grant execute on function private.cancel_my_schedule_engine_job(uuid) to authenticated;
grant execute on function private.admin_list_schedule_engine_jobs(integer) to authenticated;

create function public.create_schedule_engine_job(
  p_replacements jsonb,
  p_email_notification boolean default true
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_schedule_engine_job(p_replacements, p_email_notification);
$$;

create function public.list_my_schedule_engine_jobs(p_limit integer default 25)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.list_my_schedule_engine_jobs(p_limit);
$$;

create function public.cancel_my_schedule_engine_job(p_job_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.cancel_my_schedule_engine_job(p_job_id);
$$;

create function public.admin_list_schedule_engine_jobs(p_limit integer default 100)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_list_schedule_engine_jobs(p_limit);
$$;

revoke all on function public.create_schedule_engine_job(jsonb, boolean) from public, anon;
revoke all on function public.list_my_schedule_engine_jobs(integer) from public, anon;
revoke all on function public.cancel_my_schedule_engine_job(uuid) from public, anon;
revoke all on function public.admin_list_schedule_engine_jobs(integer) from public, anon;
grant execute on function public.create_schedule_engine_job(jsonb, boolean) to authenticated;
grant execute on function public.list_my_schedule_engine_jobs(integer) to authenticated;
grant execute on function public.cancel_my_schedule_engine_job(uuid) to authenticated;
grant execute on function public.admin_list_schedule_engine_jobs(integer) to authenticated;
