-- Study Hall can be a full-year class on A-only, B-only, or the same
-- period on both A and B days. Keep Gym/Wellness restrictions unchanged.
create or replace function private.assert_enrollment_schedule_allowed(
  target_class_id uuid,
  requested_term public.academic_term,
  requested_slots jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  class_term public.academic_term;
  policy public.course_term_policy;
  course_normalized_name text;
  default_slots jsonb;
  slot_count integer;
  a_count integer;
  b_count integer;
  min_period integer;
  max_period integer;
begin
  select class_record.default_academic_term, course_name.term_policy, course_name.normalized_name
  into class_term, policy, course_normalized_name
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = target_class_id
    and class_record.status = 'active'
    and course_name.status = 'active';

  if not found then
    raise exception 'active_class_not_found' using errcode = 'P0002';
  end if;

  perform private.assert_valid_enrollment_meeting_slots(requested_slots);
  default_slots := private.class_slots_json(target_class_id);

  select count(*),
         count(*) filter (where slot.day_type = 'A'),
         count(*) filter (where slot.day_type = 'B'),
         min(slot.period_number),
         max(slot.period_number)
  into slot_count, a_count, b_count, min_period, max_period
  from jsonb_to_recordset(requested_slots) slot(day_type public.day_type, period_number smallint);

  if policy = 'full_year' then
    if requested_term <> 'full_year' then
      raise exception 'full_year_course_requires_full_year' using errcode = '23514';
    end if;
    if not private.meeting_slots_equal(requested_slots, default_slots) then
      raise exception 'class_meeting_slots_locked' using errcode = '23514';
    end if;
  elsif policy = 'semester' then
    if requested_term <> class_term then
      raise exception 'semester_course_term_mismatch' using errcode = '23514';
    end if;
    if not private.meeting_slots_equal(requested_slots, default_slots) then
      raise exception 'class_meeting_slots_locked' using errcode = '23514';
    end if;
  elsif policy in ('variable_credit', 'versioned') then
    if requested_term <> class_term then
      raise exception 'course_version_term_mismatch' using errcode = '23514';
    end if;
    if not private.meeting_slots_equal(requested_slots, default_slots) then
      raise exception 'class_meeting_slots_locked' using errcode = '23514';
    end if;
  elsif policy in ('flexible_attendance', 'sectioned_attendance') then
    if requested_term = 'full_year' then
      if course_normalized_name in ('study hall', 'study hall - nai', 'study hall - nash') then
        if not (
          (slot_count = 1 and (a_count = 1 or b_count = 1))
          or (slot_count = 2 and a_count = 1 and b_count = 1 and min_period = max_period)
        ) then
          raise exception 'full_year_special_requires_one_day' using errcode = '23514';
        end if;
      elsif slot_count <> 1 or (a_count <> 1 and b_count <> 1) then
        raise exception 'full_year_special_requires_one_day' using errcode = '23514';
      end if;
    elsif slot_count <> 2 or a_count <> 1 or b_count <> 1 then
      raise exception 'semester_special_requires_every_day' using errcode = '23514';
    elsif min_period <> max_period then
      raise exception 'semester_special_requires_same_period' using errcode = '23514';
    end if;

    if policy = 'sectioned_attendance' then
      if requested_term <> class_term then
        raise exception 'sectioned_attendance_term_mismatch' using errcode = '23514';
      end if;
      if not private.meeting_slots_equal(requested_slots, default_slots) then
        raise exception 'sectioned_attendance_slots_locked' using errcode = '23514';
      end if;
    end if;
  elsif policy = 'lunch' then
    if slot_count <> 2 or a_count <> 1 or b_count <> 1 or min_period <> max_period then
      raise exception 'lunch_requires_same_period_every_day' using errcode = '23514';
    end if;
    if not private.meeting_slots_equal(requested_slots, default_slots) then
      raise exception 'lunch_period_does_not_match_section' using errcode = '23514';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_enrollment_schedule_allowed(uuid, public.academic_term, jsonb)
from public, anon, authenticated;
