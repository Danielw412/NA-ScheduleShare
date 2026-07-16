-- Restore an explicit normal/double-period distinction while keeping the
-- existing JSONB RPC shape and the explicit class_meeting_slots source of truth.
create or replace function private.assert_valid_meeting_slots(
  input_meeting_slots jsonb,
  input_is_double boolean
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if input_is_double is null then
    raise exception 'double_period_selection_required' using errcode = '23514';
  end if;
  if coalesce(jsonb_typeof(input_meeting_slots), 'null') <> 'array' then
    raise exception 'meeting_slots_required' using errcode = '23514';
  end if;
  if jsonb_array_length(input_meeting_slots) = 0 then
    raise exception 'meeting_slots_required' using errcode = '23514';
  end if;
  if jsonb_array_length(input_meeting_slots) > 4 then
    raise exception 'too_many_meeting_slots' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(input_meeting_slots) item
    where jsonb_typeof(item) <> 'object'
       or not (item ? 'day_type')
       or not (item ? 'period_number')
  ) then
    raise exception 'invalid_meeting_slot' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
    where requested.day_type not in ('A', 'B')
       or requested.period_number not between 1 and 9
       or requested.day_type is null
       or requested.period_number is null
  ) then
    raise exception 'invalid_meeting_slot' using errcode = '23514';
  end if;
  if (
    select count(*)
    from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
  ) <> (
    select count(distinct requested.day_type || ':' || requested.period_number::text)
    from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
  ) then
    raise exception 'duplicate_meeting_slot' using errcode = '23514';
  end if;

  if not coalesce(input_is_double, false) and exists (
    select 1
    from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
    group by requested.day_type
    having count(*) > 1
  ) then
    raise exception 'normal_class_multiple_periods' using errcode = '23514';
  end if;

  if coalesce(input_is_double, false) then
    if exists (
      select 1
      from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
      group by requested.day_type
      having count(*) > 2
    ) then
      raise exception 'double_period_too_many_slots' using errcode = '23514';
    end if;
    if exists (
      select 1
      from (
        select requested.day_type, min(requested.period_number) as first_period, max(requested.period_number) as last_period, count(*) as slot_count
        from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
        group by requested.day_type
      ) day_slots
      where day_slots.slot_count = 2 and day_slots.last_period <> day_slots.first_period + 1
    ) then
      raise exception 'double_period_slots_not_consecutive' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
      group by requested.day_type
      having count(*) = 2
    ) then
      raise exception 'double_period_requires_two_slots' using errcode = '23514';
    end if;
  end if;
end;
$$;

comment on function private.assert_valid_meeting_slots(jsonb, boolean) is
  'Validates normal classes as one period per selected day and double-period classes as at most two consecutive periods on at least one day.';

-- Permanent deletion used to leave all child cleanup to ON DELETE CASCADE.
-- The slot validator is a deferred constraint trigger, so make the class
-- inactive before explicitly removing its children and then remove each child
-- set in a documented order. The whole operation remains atomic and audited.
create or replace function private.admin_delete_class_section(target_class_id uuid, action_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  before_data jsonb;
  course_name_value text;
begin
  actor_id := private.require_admin();
  if char_length(trim(coalesce(action_reason, ''))) < 3 then
    raise exception 'class_delete_reason_required' using errcode = '23514';
  end if;

  select jsonb_build_object(
           'class', to_jsonb(c),
           'course_name', cn.name,
           'meeting_slots', coalesce((select jsonb_agg(to_jsonb(s) order by s.day_type, s.period_number) from public.class_meeting_slots s where s.class_id = c.id), '[]'::jsonb),
           'enrollment_count', (select count(*) from public.class_enrollments e where e.class_id = c.id),
           'report_count', (select count(*) from public.reports r where r.reported_class_id = c.id)
         ),
         cn.name
  into before_data, course_name_value
  from public.classes c
  join public.course_names cn on cn.id = c.course_name_id
  where c.id = target_class_id
  for update of c;
  if not found then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;

  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id,
         'admin_schedule_change',
         jsonb_build_object('enrollment_id', e.id, 'class_id', target_class_id, 'course_name', course_name_value, 'academic_term', e.academic_term, 'active', e.active),
         jsonb_build_object('class_id', target_class_id, 'course_name', course_name_value, 'permanently_deleted', true, 'reason', action_reason),
         actor_id
  from public.class_enrollments e
  where e.class_id = target_class_id and e.active;

  update public.reports
  set reported_course_name_snapshot = coalesce(reported_course_name_snapshot, course_name_value),
      reported_class_id = null
  where reported_class_id = target_class_id;

  perform private.write_audit(
    actor_id,
    'class_permanently_deleted',
    'class',
    target_class_id::text,
    before_data,
    jsonb_build_object('permanently_deleted', true),
    action_reason
  );

  update public.classes
  set status = 'archived'
  where id = target_class_id;
  delete from public.class_meeting_slots where class_id = target_class_id;
  delete from public.class_enrollments where class_id = target_class_id;
  delete from public.classes where id = target_class_id;
end;
$$;

revoke all on function private.admin_delete_class_section(uuid, text) from public, anon, authenticated;
grant execute on function private.admin_delete_class_section(uuid, text) to authenticated;

comment on function public.admin_delete_class_section(uuid, text) is
  'Administrator-only permanent section deletion with explicit trigger-safe child cleanup; reports retain a course-name snapshot and affected schedules receive immutable history.';

notify pgrst, 'reload schema';
