-- Serialize Schedule Engine applies before writing FK-backed rate-limit rows.
-- This prevents concurrent applies for the same user from taking compatible
-- profile FK locks and then deadlocking while both try to upgrade to FOR UPDATE.
-- Stale predictions are an application-level validation failure, not a
-- serialization failure, so do not report SQLSTATE 40001 (which can invite retry).

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

  -- Lock the profile first. private.consume_rate_limit() inserts a row whose
  -- user_id FK references public.profiles, so taking this lock after that insert
  -- allows two concurrent transactions to deadlock during lock upgrade.
  perform 1
  from public.profiles profile
  where profile.id = actor_id
  for update;

  perform private.consume_rate_limit(actor_id, 'schedule_engine_apply', 6, interval '1 hour');

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
    raise exception 'schedule_engine_prediction_stale' using errcode = 'P0001';
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
