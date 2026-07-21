-- Atomically deactivate every class on the authenticated student's schedule.
-- Shared class records remain intact for every other enrolled student.

create or replace function private.clear_my_schedule()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  removed_count integer;
begin
  actor_id := private.require_active_user();

  perform 1
  from public.class_enrollments enrollment
  where enrollment.student_id = actor_id
    and enrollment.active
  for update;

  select count(*)::integer
  into removed_count
  from public.class_enrollments enrollment
  where enrollment.student_id = actor_id
    and enrollment.active;

  insert into public.schedule_change_history (
    student_id,
    action,
    previous_value,
    changed_by
  )
  select
    actor_id,
    'class_removed',
    jsonb_build_object(
      'enrollment_id', enrollment.id,
      'class_id', class_record.id,
      'course_name_id', course_name.id,
      'course_name', course_name.name,
      'teacher_last_name', class_record.teacher_last_name,
      'academic_term', enrollment.academic_term,
      'meeting_slots', coalesce((
        select jsonb_agg(
          jsonb_build_object('day_type', slot.day_type, 'period_number', slot.period_number)
          order by slot.day_type, slot.period_number
        )
        from public.class_meeting_slots slot
        where slot.class_id = class_record.id
      ), '[]'::jsonb)
    ),
    actor_id
  from public.class_enrollments enrollment
  join public.classes class_record on class_record.id = enrollment.class_id
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where enrollment.student_id = actor_id
    and enrollment.active;

  update public.class_enrollments
  set active = false,
      updated_at = now()
  where student_id = actor_id
    and active;

  return removed_count;
end;
$$;

create or replace function public.clear_my_schedule()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.clear_my_schedule();
$$;

revoke all on function private.clear_my_schedule() from public, anon, authenticated;
grant execute on function private.clear_my_schedule() to authenticated;

revoke all on function public.clear_my_schedule() from public, anon;
grant execute on function public.clear_my_schedule() to authenticated;

comment on function public.clear_my_schedule() is
  'Atomically deactivates every enrollment on the authenticated student schedule without deleting shared classes.';

notify pgrst, 'reload schema';
