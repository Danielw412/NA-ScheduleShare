-- Supply the local worker with every relevant existing section/attendance
-- pattern and store either one to three ranked schedules or an explained
-- no-solution outcome. Browser privileges and RLS remain unchanged.

alter table public.schedule_engine_jobs
add column no_valid_schedule_reason text
check (no_valid_schedule_reason is null or char_length(no_valid_schedule_reason) between 1 and 4000);

comment on column public.schedule_engine_jobs.no_valid_schedule_reason is
'Worker-authored explanation shown when the existing section catalog cannot produce a valid predicted schedule.';

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
    'no_valid_schedule_reason', target_job.no_valid_schedule_reason,
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
        'position', target.position,
        'course_id', course_name.id,
        'course_name', course_name.name,
        'course_term_policy', course_name.term_policy
      ) order by target.position)
      from public.schedule_engine_replacement_courses target
      join public.course_names course_name on course_name.id = target.course_name_id
      where target.job_id = target_job.id
    ), '[]'::jsonb),
    'available_sections', coalesce((
      with relevant_course_ids as (
        select replacement.course_name_id
        from public.schedule_engine_replacement_courses replacement
        where replacement.job_id = target_job.id
        union
        select class_record.course_name_id
        from public.class_enrollments enrollment
        join public.classes class_record on class_record.id = enrollment.class_id
        where enrollment.student_id = target_job.user_id
          and enrollment.active
          and not exists (
            select 1 from public.schedule_engine_replacements source
            where source.job_id = target_job.id and source.enrollment_id = enrollment.id
          )
      ),
      section_defaults as (
        select course_name.id as course_id,
               course_name.name as course_name,
               course_name.term_policy as course_term_policy,
               class_record.id as class_id,
               class_record.teacher_last_name,
               class_record.default_academic_term,
               class_record.default_academic_term as academic_term,
               class_record.is_double_period,
               private.class_slots_json(class_record.id) as meeting_slots,
               count(enrollment.id)::integer as active_enrollment_count,
               'section_default'::text as pattern_source
        from relevant_course_ids relevant
        join public.course_names course_name
          on course_name.id = relevant.course_name_id
         and course_name.status = 'active'
        join public.classes class_record
          on class_record.course_name_id = course_name.id
         and class_record.status = 'active'
        left join public.class_enrollments enrollment
          on enrollment.class_id = class_record.id
         and enrollment.active
        group by course_name.id, class_record.id
      ),
      observed_flexible_patterns as (
        select course_name.id as course_id,
               course_name.name as course_name,
               course_name.term_policy as course_term_policy,
               class_record.id as class_id,
               class_record.teacher_last_name,
               class_record.default_academic_term,
               enrollment.academic_term,
               class_record.is_double_period,
               private.enrollment_slots_json(enrollment.id) as meeting_slots,
               count(*)::integer as active_enrollment_count,
               'existing_enrollment'::text as pattern_source
        from relevant_course_ids relevant
        join public.course_names course_name
          on course_name.id = relevant.course_name_id
         and course_name.status = 'active'
         and course_name.term_policy = 'flexible_attendance'
        join public.classes class_record
          on class_record.course_name_id = course_name.id
         and class_record.status = 'active'
        join public.class_enrollments enrollment
          on enrollment.class_id = class_record.id
         and enrollment.active
        group by course_name.id, class_record.id, enrollment.academic_term,
                 private.enrollment_slots_json(enrollment.id)
      ),
      normalized_placements as (
        select placement.course_id,
               placement.course_name,
               placement.course_term_policy,
               placement.class_id,
               placement.teacher_last_name,
               placement.default_academic_term,
               placement.academic_term,
               placement.is_double_period,
               placement.meeting_slots,
               max(placement.active_enrollment_count)::integer as active_enrollment_count,
               case when bool_or(placement.pattern_source = 'existing_enrollment')
                 then 'existing_enrollment' else 'section_default' end as pattern_source
        from (
          select * from section_defaults
          union all
          select * from observed_flexible_patterns
        ) placement
        where jsonb_typeof(placement.meeting_slots) = 'array'
          and jsonb_array_length(placement.meeting_slots) > 0
        group by placement.course_id, placement.course_name, placement.course_term_policy,
                 placement.class_id, placement.teacher_last_name, placement.default_academic_term,
                 placement.academic_term, placement.is_double_period, placement.meeting_slots
      )
      select jsonb_agg(jsonb_build_object(
        'course_id', placement.course_id,
        'course_name', placement.course_name,
        'course_term_policy', placement.course_term_policy,
        'class_id', placement.class_id,
        'teacher_last_name', placement.teacher_last_name,
        'default_academic_term', placement.default_academic_term,
        'academic_term', placement.academic_term,
        'is_double_period', placement.is_double_period,
        'meeting_slots', placement.meeting_slots,
        'active_enrollment_count', placement.active_enrollment_count,
        'pattern_source', placement.pattern_source
      ) order by placement.course_name, placement.teacher_last_name,
                 placement.academic_term, placement.meeting_slots::text, placement.class_id)
      from normalized_placements placement
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.complete_schedule_engine_job(
  p_job_id uuid,
  p_worker_id text,
  p_results jsonb,
  p_no_valid_schedule_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result_count integer;
  no_solution_reason text := nullif(trim(p_no_valid_schedule_reason), '');
begin
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'schedule_engine_results_must_be_array' using errcode = '22023';
  end if;

  result_count := jsonb_array_length(p_results);
  if result_count > 3
     or (result_count = 0 and no_solution_reason is null)
     or (result_count > 0 and no_solution_reason is not null) then
    raise exception 'schedule_engine_result_count_invalid' using errcode = '23514';
  end if;

  if no_solution_reason is not null and char_length(no_solution_reason) > 4000 then
    raise exception 'schedule_engine_no_solution_reason_too_long' using errcode = '22001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) submitted(result)
    where jsonb_typeof(submitted.result) <> 'object'
      or jsonb_typeof(submitted.result -> 'schedule') <> 'array'
      or jsonb_array_length(submitted.result -> 'schedule') = 0
      or jsonb_typeof(submitted.result -> 'explanations') <> 'array'
      or coalesce(submitted.result ->> 'search_stage', '') not in (
        'direct_replacement', 'one_collateral_change', 'displacement_chain'
      )
      or coalesce(submitted.result ->> 'collateral_change_count', '') !~ '^[0-9]+$'
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

  insert into public.schedule_engine_results (job_id, rank, prediction, development_placeholder)
  select p_job_id,
         submitted.ordinality::smallint,
         submitted.result,
         false
  from jsonb_array_elements(p_results) with ordinality submitted(result, ordinality);

  update public.schedule_engine_jobs job
  set status = 'completed',
      completed_at = now(),
      failed_at = null,
      heartbeat_at = now(),
      error_message = null,
      no_valid_schedule_reason = no_solution_reason
  where job.id = p_job_id;
end;
$$;

create or replace function public.complete_schedule_engine_job(
  p_job_id uuid,
  p_worker_id text,
  p_results jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select public.complete_schedule_engine_job(p_job_id, p_worker_id, p_results, null::text);
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
      error_message = left(coalesce(nullif(trim(p_error_message), ''), 'Schedule Engine processing failed.'), 4000),
      no_valid_schedule_reason = null
  where job.id = p_job_id
    and job.status = 'processing'
    and job.worker_id = nullif(trim(p_worker_id), '');

  if not found then
    raise exception 'schedule_engine_job_not_claimed_by_worker' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.get_schedule_engine_worker_input(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_schedule_engine_job(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_schedule_engine_job(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.fail_schedule_engine_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_schedule_engine_worker_input(uuid, text) to service_role;
grant execute on function public.complete_schedule_engine_job(uuid, text, jsonb) to service_role;
grant execute on function public.complete_schedule_engine_job(uuid, text, jsonb, text) to service_role;
grant execute on function public.fail_schedule_engine_job(uuid, text, text) to service_role;

comment on function public.get_schedule_engine_worker_input(uuid, text) is
'Returns the claimed student schedule plus every relevant active existing section and observed flexible-attendance pattern. Service role only.';
comment on function public.complete_schedule_engine_job(uuid, text, jsonb, text) is
'Completes a claimed job with up to three ranked predictions or an explained no-solution outcome. Service role only.';
comment on table public.schedule_engine_results is
'One to three worker-created, ranked Schedule Engine predictions stored as typed JSON payloads.';
