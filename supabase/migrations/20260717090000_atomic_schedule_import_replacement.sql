-- Replace the authenticated student's schedule from reviewed screenshot-import rows.
-- The entire replacement is transactional: any invalid row or imported-row conflict
-- rolls back class creation, enrollment removal, and enrollment insertion together.

create or replace function private.replace_schedule_from_import(input_rows jsonb)
returns table (added_count integer, removed_count integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  input_row jsonb;
  input_index integer := 0;
  requested_existing_class_id uuid;
  requested_course_name_id uuid;
  requested_teacher_last_name text;
  requested_normalized_teacher text;
  requested_term public.academic_term;
  requested_slots jsonb;
  requested_is_double boolean;
  selected_class_id uuid;
  resolved_rows jsonb := '[]'::jsonb;
  resolved_row record;
begin
  actor_id := private.require_active_user();
  perform private.consume_rate_limit(actor_id, 'schedule_import_replace', 6, interval '1 hour');

  if coalesce(jsonb_typeof(input_rows), 'null') <> 'array'
     or jsonb_array_length(input_rows) not between 1 and 30 then
    raise exception 'invalid_import_schedule' using errcode = '23514';
  end if;

  for input_row in select value from jsonb_array_elements(input_rows)
  loop
    input_index := input_index + 1;

    if jsonb_typeof(input_row) <> 'object'
       or not (input_row ? 'existing_class_id')
       or not (input_row ? 'course_name_id')
       or not (input_row ? 'teacher_last_name')
       or not (input_row ? 'academic_term')
       or not (input_row ? 'meeting_slots')
       or exists (
         select 1
         from jsonb_object_keys(input_row) supplied_key
         where supplied_key not in (
           'existing_class_id',
           'course_name_id',
           'teacher_last_name',
           'academic_term',
           'meeting_slots'
         )
       ) then
      raise exception 'invalid_import_schedule' using errcode = '23514';
    end if;

    begin
      requested_existing_class_id := nullif(input_row ->> 'existing_class_id', '')::uuid;
      requested_course_name_id := (input_row ->> 'course_name_id')::uuid;
      requested_term := (input_row ->> 'academic_term')::public.academic_term;
    exception when invalid_text_representation then
      raise exception 'invalid_import_schedule' using errcode = '23514';
    end;

    requested_teacher_last_name := private.normalize_teacher_last_name(input_row ->> 'teacher_last_name');
    requested_normalized_teacher := private.normalize_search(requested_teacher_last_name);
    requested_slots := input_row -> 'meeting_slots';

    perform private.assert_valid_meeting_slots(requested_slots, false);

    if jsonb_array_length(requested_slots) > 4
       or exists (
         select 1
         from jsonb_to_recordset(requested_slots) requested(day_type public.day_type, period_number smallint)
         group by requested.day_type
         having count(*) > 2
            or (count(*) = 2 and max(requested.period_number) <> min(requested.period_number) + 1)
       ) then
      raise exception 'invalid_import_schedule' using errcode = '23514';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('day_type', requested.day_type, 'period_number', requested.period_number)
        order by requested.day_type, requested.period_number
      ),
      '[]'::jsonb
    )
    into requested_slots
    from jsonb_to_recordset(requested_slots) requested(day_type public.day_type, period_number smallint);

    requested_is_double := private.meeting_slots_have_multiple_periods(requested_slots);

    if not exists (
      select 1
      from public.course_names course_name
      where course_name.id = requested_course_name_id
        and course_name.status = 'active'
    ) then
      raise exception 'active_course_name_not_found' using errcode = 'P0002';
    end if;

    selected_class_id := null;

    if requested_existing_class_id is not null then
      select class_record.id
      into selected_class_id
      from public.classes class_record
      where class_record.id = requested_existing_class_id
        and class_record.status = 'active'
        and class_record.course_name_id = requested_course_name_id
        and class_record.normalized_teacher_last_name = requested_normalized_teacher
        and class_record.default_academic_term = requested_term
        and class_record.is_double_period = requested_is_double
        and (
          select count(*)
          from public.class_meeting_slots slot
          where slot.class_id = class_record.id
        ) = jsonb_array_length(requested_slots)
        and not exists (
          select 1
          from jsonb_to_recordset(requested_slots) requested(day_type public.day_type, period_number smallint)
          where not exists (
            select 1
            from public.class_meeting_slots slot
            where slot.class_id = class_record.id
              and slot.day_type = requested.day_type
              and slot.period_number = requested.period_number
          )
        );

      if selected_class_id is null then
        raise exception 'import_existing_class_mismatch' using errcode = '23514';
      end if;
    else
      select class_record.id
      into selected_class_id
      from public.classes class_record
      where class_record.status = 'active'
        and class_record.course_name_id = requested_course_name_id
        and class_record.normalized_teacher_last_name = requested_normalized_teacher
        and class_record.default_academic_term = requested_term
        and class_record.is_double_period = requested_is_double
        and (
          select count(*)
          from public.class_meeting_slots slot
          where slot.class_id = class_record.id
        ) = jsonb_array_length(requested_slots)
        and not exists (
          select 1
          from jsonb_to_recordset(requested_slots) requested(day_type public.day_type, period_number smallint)
          where not exists (
            select 1
            from public.class_meeting_slots slot
            where slot.class_id = class_record.id
              and slot.day_type = requested.day_type
              and slot.period_number = requested.period_number
          )
        )
      order by class_record.created_at, class_record.id
      limit 1;

      if selected_class_id is null then
        insert into public.classes (
          course_name_id,
          teacher_last_name,
          normalized_teacher_last_name,
          default_academic_term,
          is_double_period,
          created_by
        ) values (
          requested_course_name_id,
          requested_teacher_last_name,
          requested_normalized_teacher,
          requested_term,
          requested_is_double,
          actor_id
        )
        returning id into selected_class_id;

        insert into public.class_meeting_slots (class_id, day_type, period_number)
        select selected_class_id, requested.day_type, requested.period_number
        from jsonb_to_recordset(requested_slots) requested(day_type public.day_type, period_number smallint);
      end if;
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(resolved_rows) previous(class_id uuid)
      where previous.class_id = selected_class_id
    ) then
      raise exception 'duplicate_import_class' using errcode = '23514';
    end if;

    resolved_rows := resolved_rows || jsonb_build_array(jsonb_build_object(
      'row_number', input_index,
      'class_id', selected_class_id,
      'course_name_id', requested_course_name_id,
      'teacher_last_name', requested_teacher_last_name,
      'academic_term', requested_term,
      'meeting_slots', requested_slots
    ));
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(resolved_rows) as left_row(
      row_number integer,
      class_id uuid,
      course_name_id uuid,
      teacher_last_name text,
      academic_term public.academic_term,
      meeting_slots jsonb
    )
    join jsonb_to_recordset(resolved_rows) as right_row(
      row_number integer,
      class_id uuid,
      course_name_id uuid,
      teacher_last_name text,
      academic_term public.academic_term,
      meeting_slots jsonb
    ) on left_row.row_number < right_row.row_number
      and private.terms_overlap(left_row.academic_term, right_row.academic_term)
    cross join jsonb_to_recordset(left_row.meeting_slots) left_slot(day_type public.day_type, period_number smallint)
    join jsonb_to_recordset(right_row.meeting_slots) right_slot(day_type public.day_type, period_number smallint)
      on right_slot.day_type = left_slot.day_type
     and right_slot.period_number = left_slot.period_number
  ) then
    raise exception 'import_schedule_conflict' using errcode = '23514';
  end if;

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

  for resolved_row in
    select *
    from jsonb_to_recordset(resolved_rows) resolved(
      class_id uuid,
      course_name_id uuid,
      teacher_last_name text,
      academic_term public.academic_term,
      meeting_slots jsonb
    )
  loop
    perform private.add_enrollment_for_student(
      actor_id,
      resolved_row.class_id,
      resolved_row.academic_term,
      actor_id,
      'class_added',
      false
    );
  end loop;

  added_count := jsonb_array_length(resolved_rows);
  return next;
end;
$$;

create or replace function public.replace_schedule_from_import(p_rows jsonb)
returns table (added_count integer, removed_count integer)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.replace_schedule_from_import(p_rows);
$$;

revoke all on function private.replace_schedule_from_import(jsonb) from public, anon, authenticated;
grant execute on function private.replace_schedule_from_import(jsonb) to authenticated;

revoke all on function public.replace_schedule_from_import(jsonb) from public, anon;
grant execute on function public.replace_schedule_from_import(jsonb) to authenticated;

comment on function public.replace_schedule_from_import(jsonb) is
  'Atomically replaces the authenticated student schedule from reviewed import rows and rejects conflicts only within the replacement schedule.';
