-- Wellness supports the same attendance shapes as Gym and Study Hall, but its
-- term/day pattern identifies a separate class section instead of a personal
-- attendance pattern on one shared section.
update public.course_names
set term_policy = 'sectioned_attendance'
where normalized_name = 'wellness for life';

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
  default_slots jsonb;
  slot_count integer;
  a_count integer;
  b_count integer;
  min_period integer;
  max_period integer;
begin
  select class_record.default_academic_term, course_name.term_policy
  into class_term, policy
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
      if slot_count <> 1 or (a_count <> 1 and b_count <> 1) then
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

-- One shared Gym/Study Hall class can contain several distinct meeting
-- rosters. Other course policies keep their existing same-section semantics.
create or replace function private.enrollments_share_class_meeting(
  left_enrollment_id uuid,
  right_enrollment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_enrollments left_enrollment
    join public.class_enrollments right_enrollment
      on right_enrollment.id = right_enrollment_id
     and right_enrollment.class_id = left_enrollment.class_id
     and right_enrollment.active
    join public.classes class_record on class_record.id = left_enrollment.class_id
    join public.course_names course_name on course_name.id = class_record.course_name_id
    where left_enrollment.id = left_enrollment_id
      and left_enrollment.active
      and (
        course_name.term_policy <> 'flexible_attendance'
        or (
          private.terms_overlap(left_enrollment.academic_term, right_enrollment.academic_term)
          and exists (
            select 1
            from public.class_enrollment_meeting_slots left_slot
            join public.class_enrollment_meeting_slots right_slot
              on right_slot.enrollment_id = right_enrollment.id
             and right_slot.day_type = left_slot.day_type
             and right_slot.period_number = left_slot.period_number
            where left_slot.enrollment_id = left_enrollment.id
          )
        )
      )
  );
$$;

create or replace function private.shares_active_class(viewer_id uuid, owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer_id is not null and owner_id is not null and exists (
    select 1
    from public.class_enrollments viewer_enrollment
    join public.class_enrollments owner_enrollment
      on owner_enrollment.class_id = viewer_enrollment.class_id
     and owner_enrollment.student_id = owner_id
     and owner_enrollment.active
    where viewer_enrollment.student_id = viewer_id
      and viewer_enrollment.active
      and private.enrollments_share_class_meeting(viewer_enrollment.id, owner_enrollment.id)
  );
$$;

create or replace function private.get_classmates()
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_course_names jsonb,
  can_view_schedule boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  if not private.has_active_enrollment(actor_id) and not private.is_admin(actor_id) then
    raise exception 'schedule_required_for_discovery' using errcode = '42501';
  end if;

  return query
  select profile.id,
         profile.full_name,
         profile.grade,
         profile.privacy_setting,
         jsonb_agg(distinct course_name.name order by course_name.name),
         private.can_view_full_schedule(actor_id, profile.id)
  from public.class_enrollments mine
  join public.class_enrollments theirs
    on theirs.class_id = mine.class_id
   and theirs.active
   and theirs.student_id <> actor_id
   and private.enrollments_share_class_meeting(mine.id, theirs.id)
  join public.classes class_record on class_record.id = mine.class_id and class_record.status = 'active'
  join public.course_names course_name on course_name.id = class_record.course_name_id
  join public.profiles profile on profile.id = theirs.student_id
  where mine.student_id = actor_id
    and mine.active
    and private.is_active_user(profile.id)
  group by profile.id, profile.full_name, profile.grade, profile.privacy_setting
  order by count(distinct mine.class_id) desc, profile.full_name;
end;
$$;

drop function if exists public.get_class_members(uuid);
drop function if exists private.get_class_members(uuid);

create or replace function private.get_class_members(
  target_class_id uuid,
  target_day_type public.day_type default null,
  target_period_number smallint default null
)
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  can_view_schedule boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  class_term public.academic_term;
  target_policy public.course_term_policy;
  context_term public.academic_term;
  actor_attends_meeting boolean := false;
begin
  actor_id := private.require_active_user();

  select class_record.default_academic_term, course_name.term_policy
  into class_term, target_policy
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = target_class_id
    and class_record.status = 'active'
    and course_name.status = 'active';

  if not found then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;

  if target_policy = 'flexible_attendance' then
    if target_day_type is null or target_period_number is null then
      raise exception 'meeting_context_required' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.class_meeting_slots class_slot
      where class_slot.class_id = target_class_id
        and class_slot.period_number = target_period_number
    ) then
      raise exception 'class_meeting_not_found' using errcode = 'P0002';
    end if;

    select enrollment.academic_term
    into context_term
    from public.class_enrollments enrollment
    where enrollment.student_id = actor_id
      and enrollment.class_id = target_class_id
      and enrollment.active
    limit 1;

    context_term := case
      when private.is_admin(actor_id) then 'full_year'::public.academic_term
      else coalesce(context_term, class_term)
    end;
    actor_attends_meeting := exists (
      select 1
      from public.class_enrollments enrollment
      join public.class_enrollment_meeting_slots enrollment_slot
        on enrollment_slot.enrollment_id = enrollment.id
       and enrollment_slot.day_type = target_day_type
       and enrollment_slot.period_number = target_period_number
      where enrollment.student_id = actor_id
        and enrollment.class_id = target_class_id
        and enrollment.active
    );
  end if;

  return query
  select profile.id,
         profile.full_name,
         profile.grade,
         profile.privacy_setting,
         private.can_view_full_schedule(actor_id, profile.id)
  from public.class_enrollments enrollment
  join public.profiles profile on profile.id = enrollment.student_id
  where enrollment.class_id = target_class_id
    and enrollment.active
    and (
      target_policy <> 'flexible_attendance'
      or (
        private.terms_overlap(enrollment.academic_term, context_term)
        and exists (
          select 1
          from public.class_enrollment_meeting_slots enrollment_slot
          where enrollment_slot.enrollment_id = enrollment.id
            and enrollment_slot.day_type = target_day_type
            and enrollment_slot.period_number = target_period_number
        )
      )
    )
    and (
      private.is_admin(actor_id)
      or (
        private.is_active_user(profile.id)
        and (
          case
            when target_policy = 'flexible_attendance'
              then profile.privacy_setting = 'school' or actor_attends_meeting
            else private.can_view_roster_member(actor_id, profile.id)
              or private.is_enrolled_in_class(actor_id, target_class_id)
          end
        )
      )
    )
  order by profile.full_name;
end;
$$;

create or replace function public.get_class_members(
  p_class_id uuid,
  p_day_type public.day_type default null,
  p_period_number smallint default null
)
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  can_view_schedule boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.get_class_members(p_class_id, p_day_type, p_period_number);
$$;

revoke all on function private.assert_enrollment_schedule_allowed(uuid, public.academic_term, jsonb) from public, anon, authenticated;
revoke all on function private.enrollments_share_class_meeting(uuid, uuid) from public, anon, authenticated;
revoke all on function private.shares_active_class(uuid, uuid) from public, anon, authenticated;
revoke all on function private.get_classmates() from public, anon, authenticated;
revoke all on function private.get_class_members(uuid, public.day_type, smallint) from public, anon, authenticated;
revoke all on function public.get_class_members(uuid, public.day_type, smallint) from public, anon, authenticated;

grant execute on function private.get_class_members(uuid, public.day_type, smallint) to authenticated;
grant execute on function private.get_classmates() to authenticated;
grant execute on function public.get_class_members(uuid, public.day_type, smallint) to authenticated;

comment on function private.enrollments_share_class_meeting(uuid, uuid) is
  'Returns whether two active enrollments are classmates; flexible-attendance courses additionally require overlapping term and meeting slot.';
comment on function public.get_class_members(uuid, public.day_type, smallint) is
  'Returns the privacy-filtered roster for one class meeting. Flexible-attendance classes require an explicit A/B day and period.';
