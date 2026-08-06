-- Pair lunch removal by semester and period, regardless of which active Lunch
-- catalog label or section represents each semester.

create or replace function private.remove_enrollment(target_enrollment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing public.class_enrollments%rowtype;
  paired_enrollment_id uuid;
  target_policy public.course_term_policy;
  target_period smallint;
  enrollment_to_remove uuid;
  previous_snapshot jsonb;
begin
  actor_id := private.require_active_user();

  select *
  into existing
  from public.class_enrollments
  where id = target_enrollment_id
    and student_id = actor_id
    and active
  for update;

  if not found then
    raise exception 'active_enrollment_not_found' using errcode = 'P0002';
  end if;

  select course_name.term_policy
  into target_policy
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = existing.class_id;

  if target_policy = 'lunch'
     and existing.academic_term in ('semester_1', 'semester_2') then
    select min(slot.period_number)::smallint
    into target_period
    from public.class_enrollment_meeting_slots slot
    where slot.enrollment_id = existing.id
    having count(*) = 2
       and count(distinct slot.day_type) = 2
       and count(distinct slot.period_number) = 1;

    if target_period is not null then
      select candidate.id
      into paired_enrollment_id
      from public.class_enrollments candidate
      join public.classes candidate_class on candidate_class.id = candidate.class_id
      join public.course_names candidate_course on candidate_course.id = candidate_class.course_name_id
      where candidate.student_id = actor_id
        and candidate.active
        and candidate.id <> existing.id
        and candidate.academic_term = case existing.academic_term
          when 'semester_1' then 'semester_2'::public.academic_term
          else 'semester_1'::public.academic_term
        end
        and candidate_course.term_policy = 'lunch'
        and (
          select count(*)
          from public.class_enrollment_meeting_slots candidate_slot
          where candidate_slot.enrollment_id = candidate.id
        ) = 2
        and (
          select count(distinct candidate_slot.day_type)
          from public.class_enrollment_meeting_slots candidate_slot
          where candidate_slot.enrollment_id = candidate.id
        ) = 2
        and not exists (
          select 1
          from public.class_enrollment_meeting_slots candidate_slot
          where candidate_slot.enrollment_id = candidate.id
            and candidate_slot.period_number <> target_period
        )
      order by candidate.created_at desc, candidate.id
      limit 1
      for update of candidate;
    end if;
  end if;

  for enrollment_to_remove in
    select existing.id
    union all
    select paired_enrollment_id
    where paired_enrollment_id is not null
  loop
    select jsonb_build_object(
      'enrollment_id', enrollment.id,
      'class_id', class_record.id,
      'course_name_id', course_name.id,
      'course_name', course_name.name,
      'academic_term', enrollment.academic_term
    )
    into previous_snapshot
    from public.class_enrollments enrollment
    join public.classes class_record on class_record.id = enrollment.class_id
    join public.course_names course_name on course_name.id = class_record.course_name_id
    where enrollment.id = enrollment_to_remove
      and enrollment.active;

    if previous_snapshot is null then
      continue;
    end if;

    update public.class_enrollments
    set active = false
    where id = enrollment_to_remove;

    insert into public.schedule_change_history (
      student_id,
      action,
      previous_value,
      changed_by
    )
    values (
      actor_id,
      'class_removed',
      previous_snapshot,
      actor_id
    );
  end loop;
end;
$$;

comment on function public.remove_enrollment(uuid) is
  'Removes one enrollment. Semester 1 and Semester 2 lunch enrollments are removed together only when both use the same period.';
