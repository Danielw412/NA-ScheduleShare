-- Schedule Engine request queue, secure worker hand-off, and ranked results.
-- Prediction logic intentionally lives outside Postgres and is not implemented here.

create type public.schedule_engine_job_status as enum (
  'queued',
  'processing',
  'completed',
  'failed'
);

create type public.schedule_engine_notification_status as enum (
  'not_requested',
  'pending',
  'sent',
  'failed'
);

create table public.schedule_engine_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.schedule_engine_job_status not null default 'queued',
  email_notification boolean not null default true,
  notification_status public.schedule_engine_notification_status not null default 'pending',
  notification_sent_at timestamptz,
  notification_error text check (notification_error is null or char_length(notification_error) <= 2000),
  worker_id text check (worker_id is null or char_length(worker_id) between 1 and 200),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  processing_started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  error_message text check (error_message is null or char_length(error_message) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (email_notification and notification_status in ('pending', 'sent', 'failed'))
    or (not email_notification and notification_status = 'not_requested')
  ),
  check ((status = 'completed') = (completed_at is not null)),
  check ((status = 'failed') = (failed_at is not null)),
  check (status <> 'processing' or (worker_id is not null and claimed_at is not null and processing_started_at is not null))
);

create table public.schedule_engine_replacements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.schedule_engine_jobs(id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  enrollment_id uuid not null,
  current_course_name_id uuid not null,
  current_course_name text not null check (char_length(current_course_name) between 1 and 200),
  replacement_course_name_id uuid not null,
  replacement_course_name text not null check (char_length(replacement_course_name) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (job_id, position),
  unique (job_id, enrollment_id),
  unique (job_id, replacement_course_name_id)
);

create table public.schedule_engine_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.schedule_engine_jobs(id) on delete cascade,
  rank smallint not null check (rank between 1 and 4),
  prediction jsonb not null check (jsonb_typeof(prediction) = 'object'),
  development_placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  unique (job_id, rank)
);

create index schedule_engine_jobs_queue_idx
on public.schedule_engine_jobs(created_at, id)
where status = 'queued';

create index schedule_engine_jobs_user_history_idx
on public.schedule_engine_jobs(user_id, created_at desc, id desc);

create index schedule_engine_replacements_job_idx
on public.schedule_engine_replacements(job_id, position);

create index schedule_engine_replacements_enrollment_idx
on public.schedule_engine_replacements(enrollment_id);

create index schedule_engine_replacements_course_idx
on public.schedule_engine_replacements(replacement_course_name_id);

create index schedule_engine_results_job_idx
on public.schedule_engine_results(job_id, rank);

create trigger schedule_engine_jobs_set_updated_at
before update on public.schedule_engine_jobs
for each row execute function private.set_updated_at();

alter table public.schedule_engine_jobs enable row level security;
alter table public.schedule_engine_replacements enable row level security;
alter table public.schedule_engine_results enable row level security;

create policy schedule_engine_jobs_select_own
on public.schedule_engine_jobs
for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_active_user((select auth.uid()))
);

create policy schedule_engine_replacements_select_own
on public.schedule_engine_replacements
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and job_id in (
    select job.id
    from public.schedule_engine_jobs job
    where job.user_id = (select auth.uid())
  )
);

create policy schedule_engine_results_select_own
on public.schedule_engine_results
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and job_id in (
    select job.id
    from public.schedule_engine_jobs job
    where job.user_id = (select auth.uid())
  )
);

revoke all on table public.schedule_engine_jobs from public, anon, authenticated;
revoke all on table public.schedule_engine_replacements from public, anon, authenticated;
revoke all on table public.schedule_engine_results from public, anon, authenticated;
grant select on table public.schedule_engine_jobs to authenticated;
grant select on table public.schedule_engine_replacements to authenticated;
grant select on table public.schedule_engine_results to authenticated;

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

  if jsonb_typeof(p_replacements) <> 'array' then
    raise exception 'schedule_engine_replacements_must_be_array' using errcode = '22023';
  end if;

  replacement_count := jsonb_array_length(p_replacements);
  if replacement_count not between 1 and 5 then
    raise exception 'schedule_engine_replacement_count_invalid' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_replacements) requested(item)
    where jsonb_typeof(requested.item) <> 'object'
      or nullif(requested.item ->> 'enrollment_id', '') is null
      or nullif(requested.item ->> 'replacement_course_id', '') is null
  ) then
    raise exception 'schedule_engine_replacement_incomplete' using errcode = '23514';
  end if;

  if (
    select count(distinct requested.item ->> 'enrollment_id')
    from jsonb_array_elements(p_replacements) requested(item)
  ) <> replacement_count then
    raise exception 'schedule_engine_duplicate_enrollment' using errcode = '23505';
  end if;

  if (
    select count(distinct requested.item ->> 'replacement_course_id')
    from jsonb_array_elements(p_replacements) requested(item)
  ) <> replacement_count then
    raise exception 'schedule_engine_duplicate_replacement_course' using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_replacements) requested(item)
    left join public.class_enrollments enrollment
      on enrollment.id = (requested.item ->> 'enrollment_id')::uuid
     and enrollment.student_id = actor_id
     and enrollment.active
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
    join public.class_enrollments enrollment
      on enrollment.id = (requested.item ->> 'enrollment_id')::uuid
    join public.classes class_record on class_record.id = enrollment.class_id
    where class_record.course_name_id = (requested.item ->> 'replacement_course_id')::uuid
  ) then
    raise exception 'schedule_engine_same_course_replacement' using errcode = '23514';
  end if;

  insert into public.schedule_engine_jobs (
    user_id,
    email_notification,
    notification_status
  ) values (
    actor_id,
    coalesce(p_email_notification, true),
    case
      when coalesce(p_email_notification, true) then 'pending'::public.schedule_engine_notification_status
      else 'not_requested'::public.schedule_engine_notification_status
    end
  )
  returning id into created_job_id;

  insert into public.schedule_engine_replacements (
    job_id,
    position,
    enrollment_id,
    current_course_name_id,
    current_course_name,
    replacement_course_name_id,
    replacement_course_name
  )
  select created_job_id,
         requested.ordinality::smallint,
         enrollment.id,
         current_course.id,
         current_course.name,
         replacement_course.id,
         replacement_course.name
  from jsonb_array_elements(p_replacements) with ordinality requested(item, ordinality)
  join public.class_enrollments enrollment
    on enrollment.id = (requested.item ->> 'enrollment_id')::uuid
   and enrollment.student_id = actor_id
   and enrollment.active
  join public.classes class_record on class_record.id = enrollment.class_id
  join public.course_names current_course on current_course.id = class_record.course_name_id
  join public.course_names replacement_course
    on replacement_course.id = (requested.item ->> 'replacement_course_id')::uuid
   and replacement_course.status = 'active';

  return created_job_id;
end;
$$;

revoke all on function public.create_schedule_engine_job(jsonb, boolean) from public, anon;
grant execute on function public.create_schedule_engine_job(jsonb, boolean) to authenticated;

create or replace function private.get_my_latest_schedule_engine_job()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  latest_job public.schedule_engine_jobs%rowtype;
begin
  actor_id := private.require_active_user();

  select job.*
  into latest_job
  from public.schedule_engine_jobs job
  where job.user_id = actor_id
  order by job.created_at desc, job.id desc
  limit 1;

  if latest_job.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', latest_job.id,
    'status', latest_job.status,
    'email_notification', latest_job.email_notification,
    'notification_status', latest_job.notification_status,
    'queued_at', latest_job.queued_at,
    'processing_started_at', latest_job.processing_started_at,
    'completed_at', latest_job.completed_at,
    'failed_at', latest_job.failed_at,
    'error_message', latest_job.error_message,
    'created_at', latest_job.created_at,
    'updated_at', latest_job.updated_at,
    'replacements', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'position', replacement.position,
            'enrollment_id', replacement.enrollment_id,
            'current_course_id', replacement.current_course_name_id,
            'current_course_name', replacement.current_course_name,
            'replacement_course_id', replacement.replacement_course_name_id,
            'replacement_course_name', replacement.replacement_course_name
          )
          order by replacement.position
        )
        from public.schedule_engine_replacements replacement
        where replacement.job_id = latest_job.id
      ),
      '[]'::jsonb
    ),
    'results', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'rank', result.rank,
            'prediction', result.prediction,
            'development_placeholder', result.development_placeholder
          )
          order by result.rank
        )
        from public.schedule_engine_results result
        where result.job_id = latest_job.id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_my_latest_schedule_engine_job()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_my_latest_schedule_engine_job();
$$;

revoke all on function private.get_my_latest_schedule_engine_job() from public, anon, authenticated;
revoke all on function public.get_my_latest_schedule_engine_job() from public, anon;
grant execute on function private.get_my_latest_schedule_engine_job() to authenticated;
grant execute on function public.get_my_latest_schedule_engine_job() to authenticated;

create or replace function public.claim_next_schedule_engine_job(p_worker_id text)
returns table (
  job_id uuid,
  user_id uuid,
  email_notification boolean,
  attempt_count integer,
  claimed_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_worker_id text := nullif(trim(p_worker_id), '');
begin
  if normalized_worker_id is null or char_length(normalized_worker_id) > 200 then
    raise exception 'schedule_engine_worker_id_invalid' using errcode = '23514';
  end if;

  return query
  with next_job as (
    select job.id
    from public.schedule_engine_jobs job
    where job.status = 'queued'
    order by job.created_at, job.id
    for update skip locked
    limit 1
  )
  update public.schedule_engine_jobs job
  set status = 'processing',
      worker_id = normalized_worker_id,
      attempt_count = job.attempt_count + 1,
      claimed_at = now(),
      processing_started_at = now(),
      heartbeat_at = now(),
      completed_at = null,
      failed_at = null,
      error_message = null
  from next_job
  where job.id = next_job.id
  returning job.id, job.user_id, job.email_notification, job.attempt_count, job.claimed_at;
end;
$$;

create or replace function public.get_schedule_engine_worker_input(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_job public.schedule_engine_jobs%rowtype;
begin
  select job.*
  into target_job
  from public.schedule_engine_jobs job
  where job.id = p_job_id;

  if target_job.id is null
    or target_job.status <> 'processing'
    or target_job.worker_id is distinct from nullif(trim(p_worker_id), '') then
    raise exception 'schedule_engine_job_not_claimed_by_worker' using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.schedule_engine_replacements replacement
    join public.class_enrollments enrollment
      on enrollment.id = replacement.enrollment_id
     and enrollment.student_id = target_job.user_id
     and enrollment.active
    join public.classes class_record
      on class_record.id = enrollment.class_id
     and class_record.status = 'active'
    join public.course_names replacement_course
      on replacement_course.id = replacement.replacement_course_name_id
     and replacement_course.status = 'active'
    where replacement.job_id = target_job.id
  ) <> (
    select count(*)
    from public.schedule_engine_replacements replacement
    where replacement.job_id = target_job.id
  ) then
    raise exception 'schedule_engine_request_data_changed' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'job', jsonb_build_object(
      'id', target_job.id,
      'user_id', target_job.user_id,
      'email_notification', target_job.email_notification,
      'attempt_count', target_job.attempt_count,
      'queued_at', target_job.queued_at,
      'claimed_at', target_job.claimed_at
    ),
    'user', jsonb_build_object(
      'id', target_job.user_id,
      'email', (select auth_user.email from auth.users auth_user where auth_user.id = target_job.user_id)
    ),
    'current_schedule', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'enrollment_id', enrollment.id,
            'class_id', class_record.id,
            'course_id', course_name.id,
            'course_name', course_name.name,
            'course_term_policy', course_name.term_policy,
            'teacher_last_name', class_record.teacher_last_name,
            'academic_term', enrollment.academic_term,
            'is_double_period', class_record.is_double_period,
            'meeting_slots', private.enrollment_slots_json(enrollment.id)
          )
          order by enrollment.created_at, enrollment.id
        )
        from public.class_enrollments enrollment
        join public.classes class_record
          on class_record.id = enrollment.class_id
         and class_record.status = 'active'
        join public.course_names course_name on course_name.id = class_record.course_name_id
        where enrollment.student_id = target_job.user_id
          and enrollment.active
      ),
      '[]'::jsonb
    ),
    'replacements', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'position', replacement.position,
            'enrollment_id', source_enrollment.id,
            'current_course', jsonb_build_object(
              'enrollment_id', source_enrollment.id,
              'course_id', source_course.id,
              'course_name', source_course.name,
              'course_term_policy', source_course.term_policy,
              'class_id', source_class.id,
              'teacher_last_name', source_class.teacher_last_name,
              'academic_term', source_enrollment.academic_term,
              'is_double_period', source_class.is_double_period,
              'meeting_slots', private.enrollment_slots_json(source_enrollment.id)
            ),
            'replacement_course', jsonb_build_object(
              'course_id', replacement_course.id,
              'course_name', replacement_course.name,
              'course_term_policy', replacement_course.term_policy
            )
          )
          order by replacement.position
        )
        from public.schedule_engine_replacements replacement
        join public.class_enrollments source_enrollment on source_enrollment.id = replacement.enrollment_id
        join public.classes source_class on source_class.id = source_enrollment.class_id
        join public.course_names source_course on source_course.id = source_class.course_name_id
        join public.course_names replacement_course on replacement_course.id = replacement.replacement_course_name_id
        where replacement.job_id = target_job.id
      ),
      '[]'::jsonb
    ),
    'replacement_course_sections', coalesce(
      (
        select jsonb_agg(section_context order by section_context ->> 'course_name', section_context ->> 'teacher_last_name')
        from (
          select jsonb_build_object(
            'course_id', course_name.id,
            'course_name', course_name.name,
            'course_term_policy', course_name.term_policy,
            'class_id', class_record.id,
            'teacher_last_name', class_record.teacher_last_name,
            'default_academic_term', class_record.default_academic_term,
            'is_double_period', class_record.is_double_period,
            'meeting_slots', private.class_slots_json(class_record.id),
            'active_enrollment_count', count(enrollment.id)
          ) as section_context
          from public.schedule_engine_replacements replacement
          join public.course_names course_name on course_name.id = replacement.replacement_course_name_id
          join public.classes class_record
            on class_record.course_name_id = course_name.id
           and class_record.status = 'active'
          left join public.class_enrollments enrollment
            on enrollment.class_id = class_record.id
           and enrollment.active
          where replacement.job_id = target_job.id
          group by course_name.id, class_record.id
        ) available_sections
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.heartbeat_schedule_engine_job(
  p_job_id uuid,
  p_worker_id text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  update public.schedule_engine_jobs job
  set heartbeat_at = now()
  where job.id = p_job_id
    and job.status = 'processing'
    and job.worker_id = nullif(trim(p_worker_id), '')
  returning true;
$$;

create or replace function public.complete_schedule_engine_job(
  p_job_id uuid,
  p_worker_id text,
  p_results jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result_count integer;
begin
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'schedule_engine_results_must_be_array' using errcode = '22023';
  end if;

  result_count := jsonb_array_length(p_results);
  if result_count not between 1 and 4 then
    raise exception 'schedule_engine_result_count_invalid' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) submitted(result)
    where jsonb_typeof(submitted.result) <> 'object'
      or jsonb_typeof(submitted.result -> 'schedule') <> 'array'
      or jsonb_array_length(submitted.result -> 'schedule') = 0
  ) then
    raise exception 'schedule_engine_result_invalid' using errcode = '23514';
  end if;

  perform 1
  from public.schedule_engine_jobs job
  where job.id = p_job_id
    and job.status = 'processing'
    and job.worker_id = nullif(trim(p_worker_id), '')
  for update;

  if not found then
    raise exception 'schedule_engine_job_not_claimed_by_worker' using errcode = '42501';
  end if;

  delete from public.schedule_engine_results result where result.job_id = p_job_id;

  insert into public.schedule_engine_results (
    job_id,
    rank,
    prediction,
    development_placeholder
  )
  select p_job_id,
         submitted.ordinality::smallint,
         submitted.result - 'development_placeholder',
         coalesce((submitted.result ->> 'development_placeholder')::boolean, false)
  from jsonb_array_elements(p_results) with ordinality submitted(result, ordinality);

  update public.schedule_engine_jobs job
  set status = 'completed',
      completed_at = now(),
      failed_at = null,
      heartbeat_at = now(),
      error_message = null
  where job.id = p_job_id;
end;
$$;

create or replace function public.fail_schedule_engine_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_message text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.schedule_engine_jobs job
  set status = 'failed',
      failed_at = now(),
      completed_at = null,
      heartbeat_at = now(),
      error_message = left(coalesce(nullif(trim(p_error_message), ''), 'Schedule Engine processing failed.'), 4000)
  where job.id = p_job_id
    and job.status = 'processing'
    and job.worker_id = nullif(trim(p_worker_id), '');

  if not found then
    raise exception 'schedule_engine_job_not_claimed_by_worker' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.record_schedule_engine_notification(
  p_job_id uuid,
  p_worker_id text,
  p_sent boolean,
  p_error_message text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.schedule_engine_jobs job
  set notification_status = case
        when p_sent then 'sent'::public.schedule_engine_notification_status
        else 'failed'::public.schedule_engine_notification_status
      end,
      notification_sent_at = case when p_sent then now() else null end,
      notification_error = case
        when p_sent then null
        else left(coalesce(nullif(trim(p_error_message), ''), 'Schedule Engine email notification failed.'), 2000)
      end
  where job.id = p_job_id
    and job.status = 'completed'
    and job.email_notification
    and job.worker_id = nullif(trim(p_worker_id), '');

  if not found then
    raise exception 'schedule_engine_notification_not_available' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.claim_next_schedule_engine_job(text) from public, anon, authenticated;
revoke all on function public.get_schedule_engine_worker_input(uuid, text) from public, anon, authenticated;
revoke all on function public.heartbeat_schedule_engine_job(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_schedule_engine_job(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_schedule_engine_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_schedule_engine_notification(uuid, text, boolean, text) from public, anon, authenticated;

grant execute on function public.claim_next_schedule_engine_job(text) to service_role;
grant execute on function public.get_schedule_engine_worker_input(uuid, text) to service_role;
grant execute on function public.heartbeat_schedule_engine_job(uuid, text) to service_role;
grant execute on function public.complete_schedule_engine_job(uuid, text, jsonb) to service_role;
grant execute on function public.fail_schedule_engine_job(uuid, text, text) to service_role;
grant execute on function public.record_schedule_engine_notification(uuid, text, boolean, text) to service_role;

comment on table public.schedule_engine_jobs is
  'User-owned Schedule Engine queue. Clients may read their rows but may only create jobs through create_schedule_engine_job.';
comment on table public.schedule_engine_replacements is
  'One to five validated enrollment-to-catalog-course replacements for each Schedule Engine job.';
comment on table public.schedule_engine_results is
  'One to four worker-created, ranked Schedule Engine predictions stored as typed JSON payloads.';
comment on function public.claim_next_schedule_engine_job(text) is
  'Atomically claims the oldest queued Schedule Engine job with FOR UPDATE SKIP LOCKED. Service role only.';
comment on function public.get_schedule_engine_worker_input(uuid, text) is
  'Builds the complete typed input payload for the worker that currently owns the claimed job. Service role only.';
