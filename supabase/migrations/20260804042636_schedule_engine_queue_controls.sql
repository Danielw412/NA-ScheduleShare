-- Queue visibility/cancellation, per-user active request limits, admin and
-- worker diagnostics, and a practical class-creation throttle.

alter table public.schedule_engine_jobs
add column cancelled_at timestamptz;

alter table public.schedule_engine_jobs
add constraint schedule_engine_jobs_cancelled_timestamp_check
check ((status = 'cancelled') = (cancelled_at is not null));

create index schedule_engine_jobs_active_user_idx
on public.schedule_engine_jobs(user_id, created_at, id)
where status in ('queued', 'processing');

create or replace function private.consume_rate_limit(
  actor_id uuid,
  action_name text,
  maximum_events integer,
  event_window interval
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recent_count integer;
  effective_maximum integer := case
    when action_name = 'class_create' then greatest(maximum_events, 30)
    else maximum_events
  end;
begin
  delete from private.rate_limit_events where created_at < now() - interval '8 days';
  select count(*) into recent_count
  from private.rate_limit_events
  where user_id = actor_id
    and action_key = action_name
    and created_at >= now() - event_window;
  if recent_count >= effective_maximum then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
  insert into private.rate_limit_events (user_id, action_key) values (actor_id, action_name);
end;
$$;

create or replace function public.create_schedule_engine_job(
  p_replacements jsonb,
  p_email_notification boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  replacement_count integer;
  created_job_id uuid;
begin
  actor_id := private.require_active_user();

  -- Serialize submissions for one user so concurrent tabs cannot exceed five.
  perform 1 from public.profiles profile where profile.id = actor_id for update;
  if (
    select count(*)
    from public.schedule_engine_jobs job
    where job.user_id = actor_id and job.status in ('queued', 'processing')
  ) >= 5 then
    raise exception 'schedule_engine_too_many_active_jobs' using errcode = '23514';
  end if;

  if jsonb_typeof(p_replacements) <> 'array' then
    raise exception 'schedule_engine_replacements_must_be_array' using errcode = '22023';
  end if;
  replacement_count := jsonb_array_length(p_replacements);
  if replacement_count not between 1 and 2 then
    raise exception 'schedule_engine_replacement_count_invalid' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_replacements) requested(item)
    where jsonb_typeof(requested.item) <> 'object'
      or nullif(requested.item ->> 'enrollment_id', '') is null
      or nullif(requested.item ->> 'replacement_course_id', '') is null
  ) then
    raise exception 'schedule_engine_replacement_incomplete' using errcode = '23514';
  end if;
  if (select count(distinct requested.item ->> 'enrollment_id') from jsonb_array_elements(p_replacements) requested(item)) <> replacement_count then
    raise exception 'schedule_engine_duplicate_enrollment' using errcode = '23505';
  end if;
  if (select count(distinct requested.item ->> 'replacement_course_id') from jsonb_array_elements(p_replacements) requested(item)) <> replacement_count then
    raise exception 'schedule_engine_duplicate_replacement_course' using errcode = '23505';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_replacements) requested(item)
    left join public.class_enrollments enrollment
      on enrollment.id = (requested.item ->> 'enrollment_id')::uuid
     and enrollment.student_id = actor_id and enrollment.active
    where enrollment.id is null
  ) then
    raise exception 'schedule_engine_enrollment_not_owned' using errcode = '42501';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_replacements) requested(item)
    left join public.course_names replacement_course
      on replacement_course.id = (requested.item ->> 'replacement_course_id')::uuid
     and replacement_course.status = 'active'
    where replacement_course.id is null
  ) then
    raise exception 'schedule_engine_replacement_course_invalid' using errcode = '23503';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_replacements) requested(item)
    join public.class_enrollments enrollment on enrollment.id = (requested.item ->> 'enrollment_id')::uuid
    join public.classes class_record on class_record.id = enrollment.class_id
    where class_record.course_name_id = (requested.item ->> 'replacement_course_id')::uuid
  ) then
    raise exception 'schedule_engine_same_course_replacement' using errcode = '23514';
  end if;

  insert into public.schedule_engine_jobs (user_id, email_notification, notification_status)
  values (
    actor_id,
    coalesce(p_email_notification, true),
    case when coalesce(p_email_notification, true)
      then 'pending'::public.schedule_engine_notification_status
      else 'not_requested'::public.schedule_engine_notification_status end
  ) returning id into created_job_id;

  insert into public.schedule_engine_replacements (
    job_id, position, enrollment_id, current_course_name_id, current_course_name,
    replacement_course_name_id, replacement_course_name
  )
  select created_job_id, requested.ordinality::smallint, enrollment.id,
         current_course.id, current_course.name, replacement_course.id, replacement_course.name
  from jsonb_array_elements(p_replacements) with ordinality requested(item, ordinality)
  join public.class_enrollments enrollment
    on enrollment.id = (requested.item ->> 'enrollment_id')::uuid
   and enrollment.student_id = actor_id and enrollment.active
  join public.classes class_record on class_record.id = enrollment.class_id
  join public.course_names current_course on current_course.id = class_record.course_name_id
  join public.course_names replacement_course
    on replacement_course.id = (requested.item ->> 'replacement_course_id')::uuid
   and replacement_course.status = 'active';
  return created_job_id;
end;
$$;

create or replace function private.schedule_engine_job_payload(
  target_job public.schedule_engine_jobs,
  include_worker_details boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', target_job.id,
    'user_id', case when include_worker_details then target_job.user_id else null end,
    'user_name', case when include_worker_details then (select p.full_name from public.profiles p where p.id = target_job.user_id) else null end,
    'status', target_job.status,
    'email_notification', target_job.email_notification,
    'notification_status', target_job.notification_status,
    'notification_sent_at', target_job.notification_sent_at,
    'notification_error', case when include_worker_details then target_job.notification_error else null end,
    'worker_id', case when include_worker_details then target_job.worker_id else null end,
    'attempt_count', case when include_worker_details then target_job.attempt_count else null end,
    'queued_at', target_job.queued_at,
    'claimed_at', case when include_worker_details then target_job.claimed_at else null end,
    'processing_started_at', target_job.processing_started_at,
    'heartbeat_at', case when include_worker_details then target_job.heartbeat_at else null end,
    'completed_at', target_job.completed_at,
    'failed_at', target_job.failed_at,
    'cancelled_at', target_job.cancelled_at,
    'error_message', target_job.error_message,
    'created_at', target_job.created_at,
    'updated_at', target_job.updated_at,
    'replacements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', replacement.position,
        'enrollment_id', replacement.enrollment_id,
        'current_course_id', replacement.current_course_name_id,
        'current_course_name', replacement.current_course_name,
        'replacement_course_id', replacement.replacement_course_name_id,
        'replacement_course_name', replacement.replacement_course_name
      ) order by replacement.position)
      from public.schedule_engine_replacements replacement where replacement.job_id = target_job.id
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', result.rank,
        'prediction', result.prediction,
        'development_placeholder', result.development_placeholder
      ) order by result.rank)
      from public.schedule_engine_results result where result.job_id = target_job.id
    ), '[]'::jsonb)
  ));
$$;

revoke all on function private.schedule_engine_job_payload(public.schedule_engine_jobs, boolean) from public, anon, authenticated;

create or replace function public.list_my_schedule_engine_jobs(p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  return coalesce((
    select jsonb_agg(private.schedule_engine_job_payload(job, false) order by job.created_at desc, job.id desc)
    from (
      select selected_job.* from public.schedule_engine_jobs selected_job
      where selected_job.user_id = actor_id
      order by selected_job.created_at desc, selected_job.id desc
      limit least(greatest(coalesce(p_limit, 25), 1), 100)
    ) job
  ), '[]'::jsonb);
end;
$$;

create or replace function public.cancel_my_schedule_engine_job(p_job_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  update public.schedule_engine_jobs job
  set status = 'cancelled', cancelled_at = now(), worker_id = null,
      claimed_at = null, processing_started_at = null, heartbeat_at = null,
      completed_at = null, failed_at = null, error_message = null,
      notification_status = case when job.email_notification then 'pending'::public.schedule_engine_notification_status else 'not_requested'::public.schedule_engine_notification_status end
  where job.id = p_job_id and job.user_id = actor_id and job.status = 'queued';
  if not found then
    raise exception 'schedule_engine_job_not_cancellable' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_list_schedule_engine_jobs(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(private.schedule_engine_job_payload(job, true) order by job.created_at desc, job.id desc)
    from (
      select selected_job.* from public.schedule_engine_jobs selected_job
      order by (selected_job.status = 'queued') desc, selected_job.created_at, selected_job.id
      limit least(greatest(coalesce(p_limit, 100), 1), 250)
    ) job
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_schedule_engine_jobs_for_worker(p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.schedule_engine_job_payload(job, true) order by
    case job.status when 'processing' then 0 when 'queued' then 1 else 2 end,
    job.created_at, job.id
  ), '[]'::jsonb)
  from (
    select selected_job.* from public.schedule_engine_jobs selected_job
    order by case selected_job.status when 'processing' then 0 when 'queued' then 1 else 2 end,
             selected_job.created_at, selected_job.id
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  ) job;
$$;

revoke all on function public.list_my_schedule_engine_jobs(integer) from public, anon;
revoke all on function public.cancel_my_schedule_engine_job(uuid) from public, anon;
revoke all on function public.admin_list_schedule_engine_jobs(integer) from public, anon;
revoke all on function public.list_schedule_engine_jobs_for_worker(integer) from public, anon, authenticated;
grant execute on function public.list_my_schedule_engine_jobs(integer) to authenticated;
grant execute on function public.cancel_my_schedule_engine_job(uuid) to authenticated;
grant execute on function public.admin_list_schedule_engine_jobs(integer) to authenticated;
grant execute on function public.list_schedule_engine_jobs_for_worker(integer) to service_role;

comment on function public.cancel_my_schedule_engine_job(uuid) is
'Cancels only the signed-in user''s queued job. Processing jobs remain worker-owned.';
comment on function public.list_schedule_engine_jobs_for_worker(integer) is
'Service-role-only diagnostic listing for the local Schedule Engine control panel.';
