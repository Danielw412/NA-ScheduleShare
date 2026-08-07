-- Keep only the final word when a two-word teacher name is submitted, while
-- preserving legitimate multi-word last names such as "De la Cruz".
create or replace function private.normalize_teacher_last_name(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized text := private.normalize_course_display(value);
  words text[];
begin
  -- Reject invalid formatting and titles before removing a possible first name
  -- so inputs such as "Smith, Joe" cannot be accidentally converted into "Joe".
  if normalized ~ '[0-9,@]'
     or normalized ~ '[[:cntrl:]]'
     or normalized ~* '^(mr|mrs|ms|miss|dr|prof|professor|coach)\.?\s+' then
    raise exception 'invalid_teacher_last_name' using errcode = '23514';
  end if;

  words := regexp_split_to_array(normalized, '\s+');
  if coalesce(array_length(words, 1), 0) = 2 then
    normalized := words[2];
  end if;

  if char_length(normalized) not between 2 and 120 then
    raise exception 'invalid_teacher_last_name' using errcode = '23514';
  end if;

  return normalized;
end;
$$;

-- A merged duplicate has no remaining purpose once its enrollments and
-- enrollment-specific meeting slots have been transferred to the canonical
-- class. Preserve reports/history/audit data, then remove the duplicate row.
create or replace function private.merge_class_records(
  canonical_class_id uuid,
  duplicate_class_id uuid,
  actor_id uuid,
  action_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_data jsonb;
  canonical_status public.class_status;
  duplicate_status public.class_status;
  duplicate_enrollment record;
  canonical_enrollment_id uuid;
begin
  if canonical_class_id = duplicate_class_id then
    raise exception 'merge_requires_two_classes' using errcode = '23514';
  end if;

  perform 1
  from public.classes
  where id in (canonical_class_id, duplicate_class_id)
  order by id
  for update;

  if (select count(*) from public.classes where id in (canonical_class_id, duplicate_class_id)) <> 2 then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;

  select status into canonical_status
  from public.classes
  where id = canonical_class_id;

  select status into duplicate_status
  from public.classes
  where id = duplicate_class_id;

  if canonical_status <> 'active' then
    raise exception 'canonical_class_must_be_active' using errcode = '23514';
  end if;
  if duplicate_status <> 'active' then
    raise exception 'duplicate_class_must_be_active' using errcode = '23514';
  end if;

  select jsonb_build_object(
    'canonical', (select to_jsonb(c) from public.classes c where c.id = canonical_class_id),
    'duplicate', (select to_jsonb(c) from public.classes c where c.id = duplicate_class_id),
    'duplicate_enrollment_count', (select count(*) from public.class_enrollments e where e.class_id = duplicate_class_id),
    'duplicate_report_count', (select count(*) from public.reports r where r.reported_class_id = duplicate_class_id)
  ) into before_data;

  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id,
         'admin_schedule_change',
         jsonb_build_object('class_id', duplicate_class_id, 'enrollment_id', e.id, 'academic_term', e.academic_term),
         jsonb_build_object('class_id', canonical_class_id, 'merge_from', duplicate_class_id, 'academic_term', e.academic_term),
         actor_id
  from public.class_enrollments e
  where e.class_id = duplicate_class_id
    and e.active;

  for duplicate_enrollment in
    select e.id, e.student_id, e.academic_term, e.active
    from public.class_enrollments e
    where e.class_id = duplicate_class_id
    order by e.created_at, e.id
    for update
  loop
    canonical_enrollment_id := null;

    select e.id
    into canonical_enrollment_id
    from public.class_enrollments e
    where e.student_id = duplicate_enrollment.student_id
      and e.class_id = canonical_class_id
    for update;

    if canonical_enrollment_id is null then
      update public.class_enrollments
      set class_id = canonical_class_id,
          updated_at = now()
      where id = duplicate_enrollment.id;
    else
      update public.class_enrollments
      set active = public.class_enrollments.active or duplicate_enrollment.active,
          academic_term = case
            when public.class_enrollments.academic_term = duplicate_enrollment.academic_term
              then public.class_enrollments.academic_term
            when public.class_enrollments.academic_term = 'full_year'
              or duplicate_enrollment.academic_term = 'full_year'
              then 'full_year'::public.academic_term
            else 'full_year'::public.academic_term
          end,
          updated_at = now()
      where id = canonical_enrollment_id;

      insert into public.class_enrollment_meeting_slots (enrollment_id, day_type, period_number)
      select canonical_enrollment_id, slot.day_type, slot.period_number
      from public.class_enrollment_meeting_slots slot
      where slot.enrollment_id = duplicate_enrollment.id
      on conflict (enrollment_id, day_type, period_number) do nothing;

      delete from public.class_enrollments
      where id = duplicate_enrollment.id;
    end if;
  end loop;

  -- A class-only report must keep a valid target. Point reports at the
  -- canonical class before deleting the duplicate so the report remains usable.
  update public.reports
  set reported_class_id = canonical_class_id
  where reported_class_id = duplicate_class_id;

  delete from public.classes
  where id = duplicate_class_id;

  perform private.write_audit(
    actor_id,
    'class_merged',
    'class',
    canonical_class_id::text,
    before_data,
    jsonb_build_object(
      'canonical_class_id', canonical_class_id,
      'duplicate_class_id', duplicate_class_id,
      'duplicate_deleted', true
    ),
    action_reason
  );
end;
$$;

-- Normalize existing active sections that currently contain a simple
-- "First Last" teacher value. The class trigger updates the normalized field.
update public.classes
set teacher_last_name = private.normalize_teacher_last_name(teacher_last_name)
where status = 'active'
  and teacher_last_name ~ '^\S+\s+\S+$'
  and teacher_last_name !~ '[0-9,@]'
  and teacher_last_name !~ '[[:cntrl:]]'
  and teacher_last_name !~* '^(mr|mrs|ms|miss|dr|prof|professor|coach)\.?\s+';

-- Teacher cleanup may make two previously distinct sections identical.
-- Coalesce those sections using the normal merge path, which now removes the
-- duplicate class row after moving enrollments and report targets.
do $$
declare
  course_record record;
begin
  for course_record in
    select course_name.id
    from public.course_names course_name
    where course_name.status = 'active'
    order by course_name.id
  loop
    perform private.coalesce_duplicate_classes_for_course(
      course_record.id,
      null,
      'Automatic duplicate cleanup after teacher-name normalization'
    );
  end loop;
end;
$$;

-- Old merge behavior left status='merged' rows behind. The live preflight for
-- this migration found no enrollments or reports pointing at those rows. Abort
-- instead of cascading away an unexpected reference if that changes before
-- deployment.
do $$
begin
  if exists (
    select 1
    from public.class_enrollments enrollment
    join public.classes class_record on class_record.id = enrollment.class_id
    where class_record.status = 'merged'
  ) then
    raise exception 'merged_class_cleanup_found_enrollments' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.reports report
    join public.classes class_record on class_record.id = report.reported_class_id
    where class_record.status = 'merged'
  ) then
    raise exception 'merged_class_cleanup_found_reports' using errcode = '23514';
  end if;
end;
$$;

delete from public.classes
where status = 'merged';
