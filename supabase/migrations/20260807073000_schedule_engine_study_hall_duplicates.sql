-- Allow Schedule Engine requests to target Study Hall more than once while
-- preserving duplicate protection for every other catalog course.

alter table public.schedule_engine_replacement_courses
  drop constraint if exists schedule_engine_replacement_courses_job_id_course_name_id_key;

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
  if source_count not between 1 and 3 then
    raise exception 'schedule_engine_source_count_invalid' using errcode = '23514';
  end if;
  if replacement_count not between 1 and 3 then
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

  if exists (
    select 1
    from (
      select submitted.value #>> '{}' as course_id_text, count(*) as occurrence_count
      from jsonb_array_elements(replacement_course_ids) submitted(value)
      group by submitted.value #>> '{}'
      having count(*) > 1
    ) duplicate_course
    left join public.course_names course_name
      on course_name.id::text = duplicate_course.course_id_text
    where course_name.id is null
       or lower(trim(course_name.name)) not like 'study hall%'
  ) then
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

  perform private.write_event_log(
    'audit',
    'schedule_engine_request_submitted',
    actor_id,
    actor_id,
    'schedule_engine_job',
    created_job_id::text,
    'succeeded',
    jsonb_build_object(
      'source_course_count', source_count,
      'replacement_course_count', replacement_count,
      'email_notification', coalesce(p_email_notification, true)
    )
  );

  return created_job_id;
end;
$$;

comment on function private.create_schedule_engine_job(jsonb, boolean) is
  'Creates a Schedule Engine request. Replacement courses must be unique except Study Hall, which may be requested multiple times.';
