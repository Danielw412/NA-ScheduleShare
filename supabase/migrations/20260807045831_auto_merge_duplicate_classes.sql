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
    'duplicate_enrollment_count', (select count(*) from public.class_enrollments e where e.class_id = duplicate_class_id)
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
      -- Updating class_id preserves the enrollment's existing meeting-slot rows.
      -- This is important for flexible-attendance courses such as Gym/Study Hall.
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

  update public.classes
  set status = 'merged'
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
      'duplicate_status', 'merged'
    ),
    action_reason
  );
end;
$$;

create or replace function private.admin_merge_classes(
  canonical_class_id uuid,
  duplicate_class_id uuid,
  action_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  actor_id := private.require_admin();
  perform private.merge_class_records(
    canonical_class_id,
    duplicate_class_id,
    actor_id,
    action_reason
  );
end;
$$;

create or replace function private.coalesce_duplicate_classes_for_course(
  target_course_name_id uuid,
  actor_id uuid,
  action_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_policy public.course_term_policy;
  candidate record;
  canonical_class_id uuid;
  merged_count integer := 0;
begin
  select course_name.term_policy
  into selected_policy
  from public.course_names course_name
  where course_name.id = target_course_name_id;

  if not found then
    return 0;
  end if;

  -- Serialize duplicate cleanup for one catalog course so two admin operations
  -- cannot race while deciding which section is canonical.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('class-coalesce:' || target_course_name_id::text, 0)
  );

  for candidate in
    select class_record.id,
           class_record.created_at,
           class_record.normalized_teacher_last_name,
           class_record.default_academic_term
    from public.classes class_record
    where class_record.course_name_id = target_course_name_id
      and class_record.status = 'active'
    order by class_record.created_at, class_record.id
  loop
    if not exists (
      select 1
      from public.classes current_class
      where current_class.id = candidate.id
        and current_class.status = 'active'
    ) then
      continue;
    end if;

    canonical_class_id := null;

    select existing.id
    into canonical_class_id
    from public.classes existing
    where existing.course_name_id = target_course_name_id
      and existing.status = 'active'
      and existing.id <> candidate.id
      and existing.normalized_teacher_last_name = candidate.normalized_teacher_last_name
      and (
        existing.created_at < candidate.created_at
        or (existing.created_at = candidate.created_at and existing.id < candidate.id)
      )
      and (
        (
          selected_policy = 'flexible_attendance'
          and private.meeting_periods_equal(
            private.class_slots_json(existing.id),
            private.class_slots_json(candidate.id)
          )
        )
        or (
          selected_policy <> 'flexible_attendance'
          and existing.default_academic_term = candidate.default_academic_term
          and private.meeting_slots_equal(
            private.class_slots_json(existing.id),
            private.class_slots_json(candidate.id)
          )
        )
      )
    order by existing.created_at, existing.id
    limit 1;

    if canonical_class_id is not null then
      perform private.merge_class_records(
        canonical_class_id,
        candidate.id,
        actor_id,
        action_reason
      );
      merged_count := merged_count + 1;
    end if;
  end loop;

  return merged_count;
end;
$$;

create or replace function public.admin_update_class(
  p_class_id uuid,
  p_course_name_id uuid,
  p_teacher_last_name text,
  p_academic_term public.academic_term,
  p_is_double_period boolean,
  p_meeting_slots jsonb,
  p_reason text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  perform private.admin_update_class(
    p_class_id,
    p_course_name_id,
    p_teacher_last_name,
    p_academic_term,
    p_is_double_period,
    p_meeting_slots,
    p_reason
  );

  actor_id := private.require_admin();
  perform private.coalesce_duplicate_classes_for_course(
    p_course_name_id,
    actor_id,
    'Automatic duplicate merge after class edit: ' || coalesce(p_reason, 'admin edit')
  );
end;
$$;

create or replace function public.admin_merge_course_names(
  p_canonical_course_name_id uuid,
  p_duplicate_course_name_id uuid,
  p_reason text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  perform private.admin_merge_course_names(
    p_canonical_course_name_id,
    p_duplicate_course_name_id,
    p_reason
  );

  actor_id := private.require_admin();
  perform private.coalesce_duplicate_classes_for_course(
    p_canonical_course_name_id,
    actor_id,
    'Automatic duplicate merge after course-name merge: ' || coalesce(p_reason, 'course-name merge')
  );
end;
$$;

-- Clean up duplicates already present when this migration is applied.
-- Null actor_id marks these as system cleanup rather than attributing them to an admin.
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
      'Automatic duplicate section cleanup after coalescing fix'
    );
  end loop;
end;
$$;