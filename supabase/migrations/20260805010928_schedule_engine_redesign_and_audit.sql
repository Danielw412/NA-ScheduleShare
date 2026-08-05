-- Expand Schedule Engine requests to three courses, make completed predictions
-- safely applicable, and surface the engine lifecycle in the existing audit log.

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

create or replace function private.capture_schedule_engine_job_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle_event text;
  event_actor_id uuid;
  event_result text;
begin
  if new.status is distinct from old.status then
    lifecycle_event := case new.status::text
      when 'processing' then 'schedule_engine_processing_started'
      when 'completed' then 'schedule_engine_processing_completed'
      when 'failed' then 'schedule_engine_processing_failed'
      when 'cancelled' then 'schedule_engine_request_cancelled'
      else null
    end;
    event_actor_id := case when new.status::text = 'cancelled' then new.user_id else null end;
    event_result := case when new.status::text = 'failed' then 'failed' else 'succeeded' end;

    if lifecycle_event is not null then
      perform private.write_event_log(
        'audit',
        lifecycle_event,
        event_actor_id,
        new.user_id,
        'schedule_engine_job',
        new.id::text,
        event_result,
        jsonb_strip_nulls(jsonb_build_object(
          'status', new.status,
          'attempt_count', new.attempt_count,
          'result_count', case when new.status::text = 'completed' then (
            select count(*) from public.schedule_engine_results result where result.job_id = new.id
          ) else null end,
          'valid_schedule_found', case when new.status::text = 'completed' then new.no_valid_schedule_reason is null else null end
        ))
      );
    end if;
  end if;

  if new.notification_status is distinct from old.notification_status
     and new.notification_status::text in ('sent', 'failed') then
    perform private.write_event_log(
      'audit',
      case when new.notification_status::text = 'sent'
        then 'schedule_engine_notification_sent'
        else 'schedule_engine_notification_failed'
      end,
      null,
      new.user_id,
      'schedule_engine_job',
      new.id::text,
      case when new.notification_status::text = 'sent' then 'succeeded' else 'failed' end,
      jsonb_build_object('notification_status', new.notification_status)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists capture_schedule_engine_job_event on public.schedule_engine_jobs;
create trigger capture_schedule_engine_job_event
after update of status, notification_status on public.schedule_engine_jobs
for each row execute function private.capture_schedule_engine_job_event();

revoke all on function private.capture_schedule_engine_job_event() from public, anon, authenticated;

create or replace function private.apply_schedule_engine_prediction(
  target_job_id uuid,
  target_rank smallint
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  target_job public.schedule_engine_jobs%rowtype;
  selected_prediction jsonb;
  development_placeholder boolean;
  origin_enrollment_ids uuid[];
  active_enrollment_count integer;
  import_rows jsonb;
  applied_count integer;
  lunch_enrollment record;
begin
  actor_id := private.require_active_user();
  perform private.consume_rate_limit(actor_id, 'schedule_engine_apply', 6, interval '1 hour');
  perform 1 from public.profiles profile where profile.id = actor_id for update;

  if target_rank not between 1 and 3 then
    raise exception 'schedule_engine_result_rank_invalid' using errcode = '23514';
  end if;

  select job.*
  into target_job
  from public.schedule_engine_jobs job
  where job.id = target_job_id
    and job.user_id = actor_id
  for update;

  if target_job.id is null then
    raise exception 'schedule_engine_prediction_not_found' using errcode = 'P0002';
  end if;
  if target_job.status::text <> 'completed' then
    raise exception 'schedule_engine_job_not_completed' using errcode = '23514';
  end if;

  select result.prediction, result.development_placeholder
  into selected_prediction, development_placeholder
  from public.schedule_engine_results result
  where result.job_id = target_job_id
    and result.rank = target_rank;

  if not found then
    raise exception 'schedule_engine_prediction_not_found' using errcode = 'P0002';
  end if;
  if development_placeholder then
    raise exception 'schedule_engine_development_result_not_applicable' using errcode = '23514';
  end if;
  if jsonb_typeof(selected_prediction -> 'schedule') <> 'array'
     or jsonb_array_length(selected_prediction -> 'schedule') = 0 then
    raise exception 'schedule_engine_result_invalid' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(selected_prediction -> 'schedule') predicted(enrollment)
    where nullif(coalesce(
      predicted.enrollment ->> 'changed_from_enrollment_id',
      predicted.enrollment ->> 'enrollment_id'
    ), '') is null
  ) then
    raise exception 'schedule_engine_result_invalid' using errcode = '23514';
  end if;

  begin
    select coalesce(array_agg(distinct origin.enrollment_id), '{}'::uuid[])
    into origin_enrollment_ids
    from (
      select source.enrollment_id
      from public.schedule_engine_replacements source
      where source.job_id = target_job_id
        and source.enrollment_id is not null
      union all
      select coalesce(
        predicted.enrollment ->> 'changed_from_enrollment_id',
        predicted.enrollment ->> 'enrollment_id'
      )::uuid
      from jsonb_array_elements(selected_prediction -> 'schedule') predicted(enrollment)
    ) origin(enrollment_id);
  exception when invalid_text_representation then
    raise exception 'schedule_engine_result_invalid' using errcode = '23514';
  end;

  select count(*)::integer
  into active_enrollment_count
  from public.class_enrollments enrollment
  where enrollment.student_id = actor_id
    and enrollment.active;

  if cardinality(origin_enrollment_ids) = 0
     or cardinality(origin_enrollment_ids) <> active_enrollment_count
     or exists (
       select 1
       from unnest(origin_enrollment_ids) origin(enrollment_id)
       where not exists (
         select 1
         from public.class_enrollments enrollment
         where enrollment.id = origin.enrollment_id
           and enrollment.student_id = actor_id
           and enrollment.active
       )
     )
     or exists (
       select 1
       from public.class_enrollments enrollment
       where enrollment.student_id = actor_id
         and enrollment.active
         and enrollment.updated_at > target_job.created_at
     ) then
    raise exception 'schedule_engine_prediction_stale' using errcode = '40001';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'existing_class_id', predicted.enrollment ->> 'class_id',
      'course_name_id', predicted.enrollment ->> 'course_id',
      'teacher_last_name', predicted.enrollment ->> 'teacher_last_name',
      'academic_term', predicted.enrollment ->> 'academic_term',
      'meeting_slots', predicted.enrollment -> 'meeting_slots'
    )
    order by predicted.ordinality
  )
  into import_rows
  from jsonb_array_elements(selected_prediction -> 'schedule')
       with ordinality predicted(enrollment, ordinality);

  select replacement.added_count
  into applied_count
  from private.replace_schedule_from_import(import_rows) replacement;

  -- The importer accepts complementary semester lunch rows and normalizes them
  -- through one full-year enrollment. Re-expand that representation immediately
  -- so personal attendance retains the required Semester 1 + Semester 2 rows.
  for lunch_enrollment in
    select enrollment.id,
           enrollment.class_id,
           private.enrollment_slots_json(enrollment.id) as meeting_slots
    from public.class_enrollments enrollment
    join public.classes class_record on class_record.id = enrollment.class_id
    join public.course_names course_name on course_name.id = class_record.course_name_id
    where enrollment.student_id = actor_id
      and enrollment.active
      and enrollment.academic_term = 'full_year'::public.academic_term
      and course_name.term_policy = 'lunch'::public.course_term_policy
  loop
    perform private.replace_enrollment(
      lunch_enrollment.id,
      lunch_enrollment.class_id,
      'full_year'::public.academic_term,
      false,
      lunch_enrollment.meeting_slots
    );
  end loop;

  select count(*)::integer
  into applied_count
  from public.class_enrollments enrollment
  where enrollment.student_id = actor_id
    and enrollment.active;

  perform private.write_event_log(
    'audit',
    'schedule_engine_prediction_applied',
    actor_id,
    actor_id,
    'schedule_engine_job',
    target_job_id::text,
    'succeeded',
    jsonb_build_object(
      'prediction_rank', target_rank,
      'active_enrollment_count', applied_count
    )
  );

  return applied_count;
end;
$$;

create or replace function public.apply_schedule_engine_prediction(
  p_job_id uuid,
  p_rank smallint
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.apply_schedule_engine_prediction(p_job_id, p_rank);
$$;

revoke all on function private.apply_schedule_engine_prediction(uuid, smallint) from public, anon, authenticated;
grant execute on function private.apply_schedule_engine_prediction(uuid, smallint) to authenticated;
revoke all on function public.apply_schedule_engine_prediction(uuid, smallint) from public, anon;
grant execute on function public.apply_schedule_engine_prediction(uuid, smallint) to authenticated;

comment on function public.apply_schedule_engine_prediction(uuid, smallint) is
  'Atomically applies one completed Schedule Engine result when the caller still has the schedule the worker evaluated.';
