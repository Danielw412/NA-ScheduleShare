-- Make explicit A/B-day period rows the source of truth for class schedules.
-- The legacy is_double_period flag and RPC arguments remain for compatibility,
-- but are derived from the submitted slots instead of constraining them.

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
  if coalesce(jsonb_typeof(input_meeting_slots), 'null') <> 'array' then
    raise exception 'meeting_slots_required' using errcode = '23514';
  end if;
  if jsonb_array_length(input_meeting_slots) = 0 then
    raise exception 'meeting_slots_required' using errcode = '23514';
  end if;
  if jsonb_array_length(input_meeting_slots) > 18 then
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

  -- input_is_double is intentionally ignored. It is retained only so existing
  -- clients can continue calling the RPC while explicit slots drive behavior.
  perform input_is_double;
end;
$$;

create or replace function private.meeting_slots_have_multiple_periods(input_meeting_slots jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_to_recordset(input_meeting_slots) requested(day_type public.day_type, period_number smallint)
    group by requested.day_type
    having count(*) > 1
  );
$$;

drop trigger if exists validate_slots_after_class_change on public.classes;
drop trigger if exists validate_slots_after_slot_change on public.class_meeting_slots;
drop function if exists private.validate_double_period_slots();

create or replace function private.validate_class_has_meeting_slots()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_class_id uuid;
begin
  if tg_table_name = 'classes' then
    target_class_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_class_id := case when tg_op = 'DELETE' then old.class_id else new.class_id end;
  end if;

  if exists (
    select 1 from public.classes c where c.id = target_class_id and c.status = 'active'
  ) and not exists (
    select 1 from public.class_meeting_slots s where s.class_id = target_class_id
  ) then
    raise exception 'meeting_slots_required' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger validate_slots_after_class_change
after insert or update of status on public.classes
deferrable initially deferred
for each row execute function private.validate_class_has_meeting_slots();

create constraint trigger validate_slots_after_slot_change
after insert or update or delete on public.class_meeting_slots
deferrable initially deferred
for each row execute function private.validate_class_has_meeting_slots();

update public.classes c
set is_double_period = exists (
  select 1
  from public.class_meeting_slots s
  where s.class_id = c.id
  group by s.day_type
  having count(*) > 1
)
where c.is_double_period is distinct from exists (
  select 1
  from public.class_meeting_slots s
  where s.class_id = c.id
  group by s.day_type
  having count(*) > 1
);

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
  actor_id uuid;
  selected_course_name_id uuid := input_course_name_id;
  new_class_id uuid;
  normalized_teacher text;
begin
  actor_id := private.require_active_user();
  perform private.consume_rate_limit(actor_id, 'class_create', 8, interval '1 hour');
  perform private.assert_valid_meeting_slots(input_meeting_slots, input_is_double);
  input_is_double := private.meeting_slots_have_multiple_periods(input_meeting_slots);
  input_teacher_last_name := private.normalize_teacher_last_name(input_teacher_last_name);
  normalized_teacher := private.normalize_search(input_teacher_last_name);

  if input_course_name_id is not null and private.normalize_search(input_new_course_name) <> '' then
    raise exception 'select_or_create_one_course_name' using errcode = '23514';
  end if;

  if input_course_name_id is null then
    if not confirmed_no_course_match then
      raise exception 'course_name_duplicate_confirmation_required' using errcode = '23514';
    end if;
    input_new_course_name := private.normalize_course_display(input_new_course_name);
    if char_length(input_new_course_name) not between 2 and 120 then
      raise exception 'course_name_required' using errcode = '23514';
    end if;
    insert into public.course_names (name, normalized_name, status, source, created_by)
    values (input_new_course_name, private.normalize_search(input_new_course_name), 'active', 'user', actor_id)
    on conflict (normalized_name) do update set name = public.course_names.name
    returning id into selected_course_name_id;
  end if;

  if not exists (
    select 1 from public.course_names cn
    where cn.id = selected_course_name_id and cn.status = 'active'
  ) then
    raise exception 'active_course_name_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.classes c
    where c.status = 'active'
      and c.course_name_id = selected_course_name_id
      and c.normalized_teacher_last_name = normalized_teacher
      and c.default_academic_term = input_term
      and c.is_double_period = input_is_double
      and (select count(*) from public.class_meeting_slots s where s.class_id = c.id) = jsonb_array_length(input_meeting_slots)
      and not exists (
        select 1
        from jsonb_to_recordset(input_meeting_slots) requested(day_type public.day_type, period_number smallint)
        where not exists (
          select 1 from public.class_meeting_slots s
          where s.class_id = c.id and s.day_type = requested.day_type and s.period_number = requested.period_number
        )
      )
  ) then
    raise exception 'exact_duplicate_class_section_exists' using errcode = '23505';
  end if;

  insert into public.classes (
    course_name_id, teacher_last_name, normalized_teacher_last_name,
    default_academic_term, is_double_period, created_by
  ) values (
    selected_course_name_id, input_teacher_last_name, normalized_teacher,
    input_term, input_is_double, actor_id
  ) returning id into new_class_id;

  insert into public.class_meeting_slots (class_id, day_type, period_number)
  select new_class_id, requested.day_type, requested.period_number
  from jsonb_to_recordset(input_meeting_slots) requested(day_type public.day_type, period_number smallint);

  return private.add_enrollment_for_student(actor_id, new_class_id, input_term, actor_id, 'class_added', false);
end;
$$;

create or replace function private.admin_update_class(
  target_class_id uuid,
  next_course_name_id uuid,
  next_teacher_last_name text,
  next_term public.academic_term,
  next_is_double boolean,
  next_slots jsonb,
  action_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; after_data jsonb; current_status public.class_status;
begin
  actor_id := private.require_admin();
  select c.status,
         jsonb_build_object(
           'class', to_jsonb(c), 'course_name', cn.name,
           'meeting_slots', coalesce((select jsonb_agg(to_jsonb(s) order by s.day_type, s.period_number) from public.class_meeting_slots s where s.class_id = c.id), '[]'::jsonb)
         )
  into current_status, before_data
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = target_class_id for update of c;
  if not found then raise exception 'class_not_found' using errcode = 'P0002'; end if;
  if current_status <> 'active' then raise exception 'only_active_classes_can_be_edited' using errcode = '23514'; end if;
  if not exists (select 1 from public.course_names cn where cn.id = next_course_name_id and cn.status = 'active') then
    raise exception 'active_course_name_not_found' using errcode = 'P0002';
  end if;
  next_teacher_last_name := private.normalize_teacher_last_name(next_teacher_last_name);
  if char_length(trim(coalesce(action_reason, ''))) < 3 then raise exception 'class_edit_reason_required' using errcode = '23514'; end if;
  perform private.assert_valid_meeting_slots(next_slots, next_is_double);
  next_is_double := private.meeting_slots_have_multiple_periods(next_slots);

  if exists (
    select 1
    from public.class_enrollments edited_enrollment
    join public.class_enrollments other_enrollment
      on other_enrollment.student_id = edited_enrollment.student_id
     and other_enrollment.active and other_enrollment.class_id <> target_class_id
     and private.terms_overlap(edited_enrollment.academic_term, other_enrollment.academic_term)
    join public.class_meeting_slots other_slot on other_slot.class_id = other_enrollment.class_id
    join jsonb_to_recordset(next_slots) requested(day_type public.day_type, period_number smallint)
      on requested.day_type = other_slot.day_type and requested.period_number = other_slot.period_number
    where edited_enrollment.class_id = target_class_id and edited_enrollment.active
      and not exists (
        select 1 from public.class_meeting_slots current_slot
        where current_slot.class_id = target_class_id
          and current_slot.day_type = requested.day_type and current_slot.period_number = requested.period_number
      )
  ) then
    raise exception 'class_edit_schedule_conflict' using errcode = '23514';
  end if;

  update public.classes
  set course_name_id = next_course_name_id,
      teacher_last_name = next_teacher_last_name,
      default_academic_term = next_term,
      is_double_period = next_is_double
  where id = target_class_id;
  delete from public.class_meeting_slots where class_id = target_class_id;
  insert into public.class_meeting_slots (class_id, day_type, period_number)
  select target_class_id, requested.day_type, requested.period_number
  from jsonb_to_recordset(next_slots) requested(day_type public.day_type, period_number smallint);

  select jsonb_build_object(
    'class', to_jsonb(c), 'course_name', cn.name,
    'meeting_slots', coalesce((select jsonb_agg(to_jsonb(s) order by s.day_type, s.period_number) from public.class_meeting_slots s where s.class_id = c.id), '[]'::jsonb)
  ) into after_data
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = target_class_id;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id, 'meeting_slots_changed', before_data, after_data, actor_id
  from public.class_enrollments e where e.class_id = target_class_id and e.active;
  perform private.write_audit(actor_id, 'class_edited', 'class', target_class_id::text, before_data, after_data, action_reason);
end;
$$;

revoke all on function private.assert_valid_meeting_slots(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.meeting_slots_have_multiple_periods(jsonb) from public, anon, authenticated;
revoke all on function private.validate_class_has_meeting_slots() from public, anon, authenticated;

comment on column public.classes.is_double_period is
  'Legacy compatibility metadata derived from whether either A/B day has multiple explicit meeting-slot rows.';
comment on function public.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) is
  'Creates a class section from validated explicit meeting slots and derives legacy multiple-period metadata before enrolling the caller.';
comment on function public.admin_update_class(uuid, uuid, text, public.academic_term, boolean, jsonb, text) is
  'Atomically edits an active shared class from explicit meeting slots, rejects schedule conflicts, and records history and audit rows.';
