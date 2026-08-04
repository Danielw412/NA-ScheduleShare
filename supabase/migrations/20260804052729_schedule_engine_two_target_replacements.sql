-- Model Schedule Engine requests as two independent sets: one or two current
-- enrollments to remove and one or two catalog courses to add. The legacy
-- target columns remain nullable so already-created paired requests retain
-- their snapshots while all new requests use the normalized target table.

alter table public.schedule_engine_replacements
  alter column replacement_course_name_id drop not null,
  alter column replacement_course_name drop not null;

create table public.schedule_engine_replacement_courses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.schedule_engine_jobs(id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  course_name_id uuid not null,
  course_name text not null check (char_length(course_name) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (job_id, position),
  unique (job_id, course_name_id)
);

create index schedule_engine_replacement_courses_job_idx
on public.schedule_engine_replacement_courses(job_id, position);

create index schedule_engine_replacement_courses_course_idx
on public.schedule_engine_replacement_courses(course_name_id);

insert into public.schedule_engine_replacement_courses (job_id, position, course_name_id, course_name, created_at)
select replacement.job_id,
       row_number() over (partition by replacement.job_id order by replacement.position)::smallint,
       replacement.replacement_course_name_id,
       replacement.replacement_course_name,
       replacement.created_at
from public.schedule_engine_replacements replacement
where replacement.replacement_course_name_id is not null;

alter table public.schedule_engine_replacement_courses enable row level security;

create policy schedule_engine_replacement_courses_select_own
on public.schedule_engine_replacement_courses
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

revoke all on table public.schedule_engine_replacement_courses from public, anon, authenticated;
grant select on table public.schedule_engine_replacement_courses to authenticated;

create or replace function private.create_schedule_engine_job(
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
  enrollment_ids jsonb;
  replacement_course_ids jsonb;
  source_count integer;
  replacement_count integer;
  created_job_id uuid;
begin
  actor_id := private.require_active_user();

  perform 1 from public.profiles profile where profile.id = actor_id for update;
  if (
    select count(*) from public.schedule_engine_jobs job
    where job.user_id = actor_id and job.status in ('queued', 'processing')
  ) >= 5 then
    raise exception 'schedule_engine_too_many_active_jobs' using errcode = '23514';
  end if;

  if jsonb_typeof(p_replacements) = 'object' then
    enrollment_ids := p_replacements -> 'enrollment_ids';
    replacement_course_ids := p_replacements -> 'replacement_course_ids';
  elsif jsonb_typeof(p_replacements) = 'array' then
    -- Compatibility for clients deployed before the independent-set redesign.
    select coalesce(jsonb_agg(requested.item ->> 'enrollment_id' order by requested.ordinality), '[]'::jsonb),
           coalesce(jsonb_agg(requested.item ->> 'replacement_course_id' order by requested.ordinality), '[]'::jsonb)
    into enrollment_ids, replacement_course_ids
    from jsonb_array_elements(p_replacements) with ordinality requested(item, ordinality);
  else
    raise exception 'schedule_engine_request_must_be_object' using errcode = '22023';
  end if;

  if jsonb_typeof(enrollment_ids) <> 'array' or jsonb_typeof(replacement_course_ids) <> 'array' then
    raise exception 'schedule_engine_request_incomplete' using errcode = '23514';
  end if;

  source_count := jsonb_array_length(enrollment_ids);
  replacement_count := jsonb_array_length(replacement_course_ids);
  if source_count not between 1 and 2 then
    raise exception 'schedule_engine_source_count_invalid' using errcode = '23514';
  end if;
  if replacement_count not between 1 and 2 then
    raise exception 'schedule_engine_replacement_course_count_invalid' using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(enrollment_ids) submitted(value)
    where jsonb_typeof(submitted.value) <> 'string' or nullif(trim(submitted.value #>> '{}'), '') is null
  ) or exists (
    select 1 from jsonb_array_elements(replacement_course_ids) submitted(value)
    where jsonb_typeof(submitted.value) <> 'string' or nullif(trim(submitted.value #>> '{}'), '') is null
  ) then
    raise exception 'schedule_engine_request_incomplete' using errcode = '23514';
  end if;

  if (select count(distinct submitted.value #>> '{}') from jsonb_array_elements(enrollment_ids) submitted(value)) <> source_count then
    raise exception 'schedule_engine_duplicate_enrollment' using errcode = '23505';
  end if;
  if (select count(distinct submitted.value #>> '{}') from jsonb_array_elements(replacement_course_ids) submitted(value)) <> replacement_count then
    raise exception 'schedule_engine_duplicate_replacement_course' using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(enrollment_ids) submitted(enrollment_id)
    left join public.class_enrollments enrollment
      on enrollment.id = submitted.enrollment_id::uuid
     and enrollment.student_id = actor_id
     and enrollment.active
    where enrollment.id is null
  ) then
    raise exception 'schedule_engine_enrollment_not_owned' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(replacement_course_ids) submitted(course_id)
    left join public.course_names replacement_course
      on replacement_course.id = submitted.course_id::uuid
     and replacement_course.status = 'active'
    where replacement_course.id is null
  ) then
    raise exception 'schedule_engine_replacement_course_invalid' using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(enrollment_ids) submitted_source(enrollment_id)
    join public.class_enrollments enrollment on enrollment.id = submitted_source.enrollment_id::uuid
    join public.classes class_record on class_record.id = enrollment.class_id
    cross join jsonb_array_elements_text(replacement_course_ids) submitted_target(course_id)
    where class_record.course_name_id = submitted_target.course_id::uuid
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
  select created_job_id, submitted.ordinality::smallint, enrollment.id,
         current_course.id, current_course.name, null, null
  from jsonb_array_elements_text(enrollment_ids) with ordinality submitted(enrollment_id, ordinality)
  join public.class_enrollments enrollment
    on enrollment.id = submitted.enrollment_id::uuid
   and enrollment.student_id = actor_id and enrollment.active
  join public.classes class_record on class_record.id = enrollment.class_id
  join public.course_names current_course on current_course.id = class_record.course_name_id;

  insert into public.schedule_engine_replacement_courses (
    job_id, position, course_name_id, course_name
  )
  select created_job_id, submitted.ordinality::smallint, replacement_course.id, replacement_course.name
  from jsonb_array_elements_text(replacement_course_ids) with ordinality submitted(course_id, ordinality)
  join public.course_names replacement_course
    on replacement_course.id = submitted.course_id::uuid
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
    'source_courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', source.position,
        'enrollment_id', source.enrollment_id,
        'course_id', source.current_course_name_id,
        'course_name', source.current_course_name
      ) order by source.position)
      from public.schedule_engine_replacements source where source.job_id = target_job.id
    ), '[]'::jsonb),
    'replacement_courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', target.position,
        'course_id', target.course_name_id,
        'course_name', target.course_name
      ) order by target.position)
      from public.schedule_engine_replacement_courses target where target.job_id = target_job.id
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
  select job.* into latest_job
  from public.schedule_engine_jobs job
  where job.user_id = actor_id
  order by job.created_at desc, job.id desc
  limit 1;
  if latest_job.id is null then return null; end if;
  return private.schedule_engine_job_payload(latest_job, false);
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
  select job.* into target_job
  from public.schedule_engine_jobs job
  where job.id = p_job_id;

  if target_job.id is null
    or target_job.status <> 'processing'
    or target_job.worker_id is distinct from nullif(trim(p_worker_id), '') then
    raise exception 'schedule_engine_job_not_claimed_by_worker' using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.schedule_engine_replacements source
    join public.class_enrollments enrollment
      on enrollment.id = source.enrollment_id
     and enrollment.student_id = target_job.user_id
     and enrollment.active
    join public.classes class_record
      on class_record.id = enrollment.class_id
     and class_record.status = 'active'
    where source.job_id = target_job.id
  ) <> (select count(*) from public.schedule_engine_replacements source where source.job_id = target_job.id)
  or (
    select count(*)
    from public.schedule_engine_replacement_courses target
    join public.course_names course_name
      on course_name.id = target.course_name_id
     and course_name.status = 'active'
    where target.job_id = target_job.id
  ) <> (select count(*) from public.schedule_engine_replacement_courses target where target.job_id = target_job.id) then
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
    'current_schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'enrollment_id', enrollment.id,
        'class_id', class_record.id,
        'course_id', course_name.id,
        'course_name', course_name.name,
        'course_term_policy', course_name.term_policy,
        'teacher_last_name', class_record.teacher_last_name,
        'academic_term', enrollment.academic_term,
        'is_double_period', class_record.is_double_period,
        'meeting_slots', private.enrollment_slots_json(enrollment.id)
      ) order by enrollment.created_at, enrollment.id)
      from public.class_enrollments enrollment
      join public.classes class_record on class_record.id = enrollment.class_id and class_record.status = 'active'
      join public.course_names course_name on course_name.id = class_record.course_name_id
      where enrollment.student_id = target_job.user_id and enrollment.active
    ), '[]'::jsonb),
    'source_courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', source.position,
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
        )
      ) order by source.position)
      from public.schedule_engine_replacements source
      join public.class_enrollments source_enrollment on source_enrollment.id = source.enrollment_id
      join public.classes source_class on source_class.id = source_enrollment.class_id
      join public.course_names source_course on source_course.id = source_class.course_name_id
      where source.job_id = target_job.id
    ), '[]'::jsonb),
    'replacement_courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'course_id', course_name.id,
        'course_name', course_name.name,
        'course_term_policy', course_name.term_policy
      ) order by target.position)
      from public.schedule_engine_replacement_courses target
      join public.course_names course_name on course_name.id = target.course_name_id
      where target.job_id = target_job.id
    ), '[]'::jsonb),
    'replacement_course_sections', coalesce((
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
        from public.schedule_engine_replacement_courses target
        join public.course_names course_name on course_name.id = target.course_name_id
        join public.classes class_record on class_record.course_name_id = course_name.id and class_record.status = 'active'
        left join public.class_enrollments enrollment on enrollment.class_id = class_record.id and enrollment.active
        where target.job_id = target_job.id
        group by course_name.id, class_record.id
      ) available_sections
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_schedule_engine_worker_input(uuid, text) from public, anon, authenticated;
grant execute on function public.get_schedule_engine_worker_input(uuid, text) to service_role;

comment on table public.schedule_engine_replacement_courses is
'Validated catalog course targets for a Schedule Engine request, stored independently from current enrollments.';
