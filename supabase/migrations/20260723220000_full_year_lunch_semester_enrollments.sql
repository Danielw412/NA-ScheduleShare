-- A full-year lunch choice represents attendance in both semester rosters.
-- Keep the public API stable while expanding that one choice into two atomic
-- semester-specific enrollments at the same period.

alter function private.enroll_in_class(uuid, public.academic_term, boolean, jsonb)
rename to enroll_in_class_without_full_year_lunch;

alter function private.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean)
rename to create_class_and_enroll_without_full_year_lunch;

alter function private.replace_enrollment(uuid, uuid, public.academic_term, boolean, jsonb)
rename to replace_enrollment_without_full_year_lunch;

create or replace function private.create_class_and_enroll(
  input_course_name_id uuid,
  input_new_course_name text,
  input_teacher_last_name text,
  input_term public.academic_term,
  input_is_double boolean,
  input_meeting_slots jsonb,
  confirmed_no_course_match boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_policy public.course_term_policy;
  semester_one_enrollment_id uuid;
begin
  if input_course_name_id is not null then
    select course_name.term_policy
    into selected_policy
    from public.course_names course_name
    where course_name.id = input_course_name_id
      and course_name.status = 'active';
  end if;

  if selected_policy = 'lunch' and input_term = 'full_year' then
    semester_one_enrollment_id := private.create_class_and_enroll_without_full_year_lunch(
      input_course_name_id,
      input_new_course_name,
      input_teacher_last_name,
      'semester_1',
      input_is_double,
      input_meeting_slots,
      confirmed_no_course_match
    );
    perform private.create_class_and_enroll_without_full_year_lunch(
      input_course_name_id,
      input_new_course_name,
      input_teacher_last_name,
      'semester_2',
      input_is_double,
      input_meeting_slots,
      confirmed_no_course_match
    );
    return semester_one_enrollment_id;
  end if;

  return private.create_class_and_enroll_without_full_year_lunch(
    input_course_name_id,
    input_new_course_name,
    input_teacher_last_name,
    input_term,
    input_is_double,
    input_meeting_slots,
    confirmed_no_course_match
  );
end;
$$;

create or replace function private.enroll_in_class(
  target_class_id uuid,
  target_term public.academic_term,
  allow_conflict boolean default false,
  target_slots jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_policy public.course_term_policy;
  selected_course_name_id uuid;
  selected_teacher_last_name text;
  resolved_slots jsonb;
  semester_one_enrollment_id uuid;
begin
  select course_name.term_policy,
         class_record.course_name_id,
         class_record.teacher_last_name
  into selected_policy, selected_course_name_id, selected_teacher_last_name
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = target_class_id
    and class_record.status = 'active'
    and course_name.status = 'active';

  if selected_policy = 'lunch' and target_term = 'full_year' then
    resolved_slots := coalesce(target_slots, private.class_slots_json(target_class_id));
    semester_one_enrollment_id := private.create_class_and_enroll_without_full_year_lunch(
      selected_course_name_id,
      null,
      selected_teacher_last_name,
      'semester_1',
      false,
      resolved_slots,
      false
    );
    perform private.create_class_and_enroll_without_full_year_lunch(
      selected_course_name_id,
      null,
      selected_teacher_last_name,
      'semester_2',
      false,
      resolved_slots,
      false
    );
    return semester_one_enrollment_id;
  end if;

  return private.enroll_in_class_without_full_year_lunch(
    target_class_id,
    target_term,
    allow_conflict,
    target_slots
  );
end;
$$;

create or replace function private.replace_enrollment(
  target_enrollment_id uuid,
  replacement_class_id uuid,
  replacement_term public.academic_term,
  allow_conflict boolean default false,
  replacement_slots jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  replacement_policy public.course_term_policy;
begin
  select course_name.term_policy
  into replacement_policy
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = replacement_class_id
    and class_record.status = 'active'
    and course_name.status = 'active';

  if replacement_policy = 'lunch' and replacement_term = 'full_year' then
    perform private.remove_enrollment(target_enrollment_id);
    return private.enroll_in_class(
      replacement_class_id,
      replacement_term,
      allow_conflict,
      replacement_slots
    );
  end if;

  return private.replace_enrollment_without_full_year_lunch(
    target_enrollment_id,
    replacement_class_id,
    replacement_term,
    allow_conflict,
    replacement_slots
  );
end;
$$;

create or replace function public.enroll_in_class(
  p_class_id uuid,
  p_academic_term public.academic_term,
  p_allow_conflict boolean default false,
  p_meeting_slots jsonb default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.enroll_in_class(
    p_class_id,
    p_academic_term,
    p_allow_conflict,
    p_meeting_slots
  );
$$;

create or replace function public.create_class_and_enroll(
  p_course_name_id uuid,
  p_new_course_name text,
  p_teacher_last_name text,
  p_academic_term public.academic_term,
  p_is_double_period boolean,
  p_meeting_slots jsonb,
  p_confirmed_no_course_match boolean
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_class_and_enroll(
    p_course_name_id,
    p_new_course_name,
    p_teacher_last_name,
    p_academic_term,
    p_is_double_period,
    p_meeting_slots,
    p_confirmed_no_course_match
  );
$$;

create or replace function public.replace_enrollment(
  p_enrollment_id uuid,
  p_new_class_id uuid,
  p_academic_term public.academic_term,
  p_allow_conflict boolean default false,
  p_meeting_slots jsonb default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.replace_enrollment(
    p_enrollment_id,
    p_new_class_id,
    p_academic_term,
    p_allow_conflict,
    p_meeting_slots
  );
$$;

revoke all on function private.enroll_in_class_without_full_year_lunch(uuid, public.academic_term, boolean, jsonb) from public, anon, authenticated;
revoke all on function private.create_class_and_enroll_without_full_year_lunch(uuid, text, text, public.academic_term, boolean, jsonb, boolean) from public, anon, authenticated;
revoke all on function private.replace_enrollment_without_full_year_lunch(uuid, uuid, public.academic_term, boolean, jsonb) from public, anon, authenticated;
revoke all on function private.enroll_in_class(uuid, public.academic_term, boolean, jsonb) from public, anon;
revoke all on function private.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) from public, anon;
revoke all on function private.replace_enrollment(uuid, uuid, public.academic_term, boolean, jsonb) from public, anon;
grant execute on function private.enroll_in_class(uuid, public.academic_term, boolean, jsonb) to authenticated;
grant execute on function private.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) to authenticated;
grant execute on function private.replace_enrollment(uuid, uuid, public.academic_term, boolean, jsonb) to authenticated;

revoke all on function public.enroll_in_class(uuid, public.academic_term, boolean, jsonb) from public, anon;
revoke all on function public.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) from public, anon;
revoke all on function public.replace_enrollment(uuid, uuid, public.academic_term, boolean, jsonb) from public, anon;
grant execute on function public.enroll_in_class(uuid, public.academic_term, boolean, jsonb) to authenticated;
grant execute on function public.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) to authenticated;
grant execute on function public.replace_enrollment(uuid, uuid, public.academic_term, boolean, jsonb) to authenticated;

comment on function public.enroll_in_class(uuid, public.academic_term, boolean, jsonb) is
  'Enrolls the caller in a class; a full-year lunch request atomically creates Semester 1 and Semester 2 lunch enrollments.';
comment on function public.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) is
  'Creates or reuses class sections and expands a full-year lunch into Semester 1 and Semester 2 enrollments.';
