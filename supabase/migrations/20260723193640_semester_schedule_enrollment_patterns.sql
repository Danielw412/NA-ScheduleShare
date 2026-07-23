-- Semester-aware schedules keep shared class identity on classes while placing
-- each student's actual term/day/period attendance on the enrollment.

-- The recursive sanitizer uses aggregate SQL and is therefore STABLE rather
-- than IMMUTABLE. This corrects the schema-linter warning without changing its
-- output or event-log privacy behavior.
alter function private.safe_event_metadata(jsonb) stable;

create type public.course_term_policy as enum (
  'full_year',
  'semester',
  'flexible_attendance',
  'lunch',
  'variable_credit',
  'versioned'
);

alter table public.course_names
add column term_policy public.course_term_policy not null default 'full_year';

-- Only the explicitly approved half-credit catalogue entries are semester
-- courses. Everything else keeps the full-year default.
update public.course_names
set term_policy = 'semester'
where normalized_name = any (array[
  'business communications',
  'business management',
  'cybersecurity',
  'entrepreneurship',
  'honors advanced accounting 1',
  'honors advanced accounting 2',
  'honors finance & investments',
  'honors international business',
  'intro to information science',
  'microsoft office applications 1',
  'microsoft office applications 2',
  'personal financial literacy',
  'principles of accounting 1',
  'principles of accounting 2',
  'sports & entertainment management',
  'web page design',
  'acting',
  'contemporary novels',
  'creative writing',
  'creative writing 2',
  'digital media production - naeye tv',
  'film & tv production 1',
  'film & tv production 2',
  'film & tv production 3',
  'film studies',
  'intro to film',
  'intro to theater',
  'journalism - naeye news',
  'leadership 1',
  'leadership 2',
  'speech',
  'speech & debate',
  'adventures in food',
  'child psychology',
  'fashion & design',
  'fashion art & merchandising',
  'foods americana',
  'foods for you',
  'interior design',
  'international foods',
  'intro to child development',
  'intro to sports nutrition',
  'preschool practicum',
  'sports nutrition',
  'the real world',
  'academic computer science a (python)',
  'academic computer science b (python)',
  'beginning computer applications',
  'honors computer programming a (c++)',
  'honors computer programming b (c++)',
  'honors database programming (sql)',
  'advanced computer multimedia arts',
  'computer multimedia arts',
  'honors music production 3',
  'music production 1',
  'music production 2',
  'music technology & songwriting 1',
  'music technology & songwriting 2',
  'music technology & songwriting 3',
  'music technology & songwriting 4',
  'academic american history',
  'academic european history',
  'american history (impact)',
  'economics',
  'european history (impact)',
  'honors american foreign policy',
  'honors american history',
  'honors european history',
  'honors history of east asia',
  'honors history of europe & russia',
  'honors intro to philosophy',
  'law & justice',
  'multicultural experience',
  'psychology',
  'sociology',
  'advanced game development',
  'creation & innovation',
  'electricity & electronics',
  'emerging technologies',
  'exploring cadd',
  'exploring creation & innovation',
  'exploring emerging technologies',
  'exploring robotic engineering',
  'game development',
  'home maintenance & repair',
  'manufacturing 1',
  'manufacturing 2',
  'robotic engineering',
  'arts & crafts',
  'digital imaging & media arts',
  'drawing & design concepts',
  'drawing & painting 1',
  'drawing & painting 2',
  'graphic design & digital illustration',
  'intro to pottery & sculpture',
  'jewelry & metalsmithing',
  'painting & color concepts',
  'photography 1',
  'photography 2',
  'pottery 1',
  'pottery 2',
  'sculpture'
]::text[]);

-- These sections share a roster even when individual students attend with a
-- different semester/day pattern.
update public.course_names
set term_policy = 'flexible_attendance'
where normalized_name = any (array[
  'adaptive gym',
  'gym',
  'unified gym - senior',
  'unified gym - sophomore',
  'wellness for life',
  'study hall',
  'study hall - nai',
  'study hall - nash'
]::text[]);

update public.course_names
set term_policy = 'lunch'
where normalized_name = any (array['lunch', 'lunch - nai', 'lunch - nash']::text[]);

update public.course_names
set term_policy = 'variable_credit'
where normalized_name = 'executive functioning';

-- The visible/selected version supplies the format for these courses. Their
-- term must never be inferred from the base course name.
update public.course_names
set term_policy = 'versioned'
where normalized_name = any (array[
  '9th grade chorus',
  '10th grade chorus',
  'wood & metal fabrication',
  'vocational training 9',
  'vocational training 10',
  'vocational training 11',
  'vocational training 12'
]::text[]);

create table public.class_enrollment_meeting_slots (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.class_enrollments(id) on delete cascade,
  day_type public.day_type not null,
  period_number smallint not null check (period_number between 1 and 9),
  created_at timestamptz not null default now(),
  unique (enrollment_id, day_type, period_number)
);

create index enrollment_slots_period_lookup_idx
on public.class_enrollment_meeting_slots(day_type, period_number, enrollment_id);

create index classes_active_section_match_idx
on public.classes(course_name_id, normalized_teacher_last_name, default_academic_term, created_at, id)
where status = 'active';

alter table public.class_enrollment_meeting_slots enable row level security;

create policy enrollment_slots_select_visible_schedule
on public.class_enrollment_meeting_slots
for select
to authenticated
using (
  exists (
    select 1
    from public.class_enrollments enrollment
    where enrollment.id = enrollment_id
      and private.is_active_user((select auth.uid()))
      and (
        enrollment.student_id = (select auth.uid())
        or private.is_admin((select auth.uid()))
        or (enrollment.active and private.can_view_full_schedule((select auth.uid()), enrollment.student_id))
      )
  )
);

revoke all on table public.class_enrollment_meeting_slots from public, anon, authenticated;
grant select on table public.class_enrollment_meeting_slots to authenticated;

insert into public.class_enrollment_meeting_slots (enrollment_id, day_type, period_number)
select enrollment.id, slot.day_type, slot.period_number
from public.class_enrollments enrollment
join public.class_meeting_slots slot on slot.class_id = enrollment.class_id
on conflict do nothing;

create or replace function private.enrollment_slots_json(target_enrollment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('day_type', slot.day_type, 'period_number', slot.period_number)
      order by slot.day_type, slot.period_number
    ),
    '[]'::jsonb
  )
  from public.class_enrollment_meeting_slots slot
  where slot.enrollment_id = target_enrollment_id;
$$;

create or replace function private.class_slots_json(target_class_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('day_type', slot.day_type, 'period_number', slot.period_number)
      order by slot.day_type, slot.period_number
    ),
    '[]'::jsonb
  )
  from public.class_meeting_slots slot
  where slot.class_id = target_class_id;
$$;

create or replace function private.meeting_slots_equal(left_slots jsonb, right_slots jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(jsonb_array_length(left_slots), 0) = coalesce(jsonb_array_length(right_slots), 0)
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(left_slots, '[]'::jsonb)) left_slot(day_type public.day_type, period_number smallint)
      where not exists (
        select 1
        from jsonb_to_recordset(coalesce(right_slots, '[]'::jsonb)) right_slot(day_type public.day_type, period_number smallint)
        where right_slot.day_type = left_slot.day_type
          and right_slot.period_number = left_slot.period_number
      )
    );
$$;

create or replace function private.meeting_periods_equal(left_slots jsonb, right_slots jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    not exists (
      select distinct left_slot.period_number
      from jsonb_to_recordset(coalesce(left_slots, '[]'::jsonb)) left_slot(day_type public.day_type, period_number smallint)
      where not exists (
        select 1
        from jsonb_to_recordset(coalesce(right_slots, '[]'::jsonb)) right_slot(day_type public.day_type, period_number smallint)
        where right_slot.period_number = left_slot.period_number
      )
    )
    and not exists (
      select distinct right_slot.period_number
      from jsonb_to_recordset(coalesce(right_slots, '[]'::jsonb)) right_slot(day_type public.day_type, period_number smallint)
      where not exists (
        select 1
        from jsonb_to_recordset(coalesce(left_slots, '[]'::jsonb)) left_slot(day_type public.day_type, period_number smallint)
        where left_slot.period_number = right_slot.period_number
      )
    );
$$;

create or replace function private.assert_valid_enrollment_meeting_slots(input_slots jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_valid_meeting_slots(
    input_slots,
    private.meeting_slots_have_multiple_periods(input_slots)
  );

  if jsonb_array_length(input_slots) > 4 then
    raise exception 'too_many_meeting_slots' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(input_slots) slot(day_type public.day_type, period_number smallint)
    group by slot.day_type
    having count(*) > 2
      or (count(*) = 2 and max(slot.period_number) <> min(slot.period_number) + 1)
  ) then
    raise exception 'invalid_multiple_period_schedule' using errcode = '23514';
  end if;
end;
$$;

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
    -- A pre-migration FY section remains usable as FY; the class trigger below
    -- prevents creating any new FY section for a half-credit course.
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
  elsif policy = 'flexible_attendance' then
    if requested_term = 'full_year' then
      if slot_count <> 1 or (a_count <> 1 and b_count <> 1) then
        raise exception 'full_year_special_requires_one_day' using errcode = '23514';
      end if;
    elsif slot_count <> 2 or a_count <> 1 or b_count <> 1 then
      raise exception 'semester_special_requires_every_day' using errcode = '23514';
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

create or replace function private.set_enrollment_meeting_slots(
  target_enrollment_id uuid,
  requested_slots jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.assert_valid_enrollment_meeting_slots(requested_slots);

  delete from public.class_enrollment_meeting_slots
  where enrollment_id = target_enrollment_id;

  insert into public.class_enrollment_meeting_slots (enrollment_id, day_type, period_number)
  select target_enrollment_id, slot.day_type, slot.period_number
  from jsonb_to_recordset(requested_slots) slot(day_type public.day_type, period_number smallint);
end;
$$;

create or replace function private.copy_default_slots_to_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.class_enrollment_meeting_slots slot
    where slot.enrollment_id = new.id
  ) then
    insert into public.class_enrollment_meeting_slots (enrollment_id, day_type, period_number)
    select new.id, slot.day_type, slot.period_number
    from public.class_meeting_slots slot
    where slot.class_id = new.class_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger class_enrollments_copy_default_slots
after insert or update of class_id on public.class_enrollments
for each row execute function private.copy_default_slots_to_enrollment();

create or replace function private.sync_class_slot_to_fixed_enrollments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_policy public.course_term_policy;
begin
  select course_name.term_policy
  into target_policy
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = case when tg_op = 'DELETE' then old.class_id else new.class_id end;

  if target_policy in ('flexible_attendance', 'lunch') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('DELETE', 'UPDATE') then
    delete from public.class_enrollment_meeting_slots enrollment_slot
    using public.class_enrollments enrollment
    where enrollment.id = enrollment_slot.enrollment_id
      and enrollment.class_id = old.class_id
      and enrollment.active
      and enrollment_slot.day_type = old.day_type
      and enrollment_slot.period_number = old.period_number;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.class_enrollment_meeting_slots (enrollment_id, day_type, period_number)
    select enrollment.id, new.day_type, new.period_number
    from public.class_enrollments enrollment
    where enrollment.class_id = new.class_id
      and enrollment.active
    on conflict do nothing;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger class_meeting_slots_sync_fixed_enrollments
after insert or update or delete on public.class_meeting_slots
for each row execute function private.sync_class_slot_to_fixed_enrollments();

-- Course policy, not a loose name heuristic, is now authoritative.
create or replace function private.is_term_flexible_course(normalized_course_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select course_name.term_policy = 'flexible_attendance'
      from public.course_names course_name
      where course_name.normalized_name = normalized_course_name
    ),
    false
  );
$$;

create or replace function private.is_lunch_course(normalized_course_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select course_name.term_policy = 'lunch'
      from public.course_names course_name
      where course_name.normalized_name = normalized_course_name
    ),
    false
  );
$$;

create or replace function private.assert_enrollment_term_allowed(
  target_class_id uuid,
  requested_term public.academic_term
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  class_term public.academic_term;
  target_policy public.course_term_policy;
begin
  select class_record.default_academic_term, course_name.term_policy
  into class_term, target_policy
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = target_class_id;

  if not found then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;

  if target_policy = 'full_year' and requested_term <> 'full_year' then
    raise exception 'full_year_course_requires_full_year' using errcode = '23514';
  end if;

  if target_policy in ('semester', 'variable_credit', 'versioned')
     and requested_term <> class_term then
    raise exception 'class_term_locked' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.enforce_class_term_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_policy public.course_term_policy;
begin
  if tg_op = 'UPDATE'
     and old.default_academic_term is distinct from new.default_academic_term
     and not private.is_admin((select auth.uid())) then
    raise exception 'class_term_locked' using errcode = '23514';
  end if;

  select course_name.term_policy
  into target_policy
  from public.course_names course_name
  where course_name.id = new.course_name_id;

  if target_policy = 'full_year' and new.default_academic_term <> 'full_year' then
    raise exception 'full_year_course_requires_full_year' using errcode = '23514';
  end if;

  if target_policy = 'semester' and new.default_academic_term = 'full_year' then
    raise exception 'half_credit_course_requires_semester' using errcode = '23514';
  end if;

  if target_policy in ('variable_credit', 'versioned') and new.default_academic_term not in (
    'full_year'::public.academic_term,
    'semester_1'::public.academic_term,
    'semester_2'::public.academic_term
  ) then
    raise exception 'course_version_term_required' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_course_name_term_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.term_policy = 'full_year' and exists (
    select 1
    from public.classes class_record
    where class_record.course_name_id = new.id
      and class_record.default_academic_term <> 'full_year'
  ) then
    raise exception 'full_year_course_has_semester_sections' using errcode = '23514';
  end if;

  if new.term_policy = 'semester' and exists (
    select 1
    from public.classes class_record
    where class_record.course_name_id = new.id
      and class_record.default_academic_term = 'full_year'
  ) then
    raise exception 'half_credit_course_has_full_year_sections' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists course_names_enforce_term_rules on public.course_names;
create trigger course_names_enforce_term_rules
after update of name, normalized_name, term_policy on public.course_names
for each row execute function private.enforce_course_name_term_rules();

-- Existing class/enrollment rows may reflect historical data. They were copied
-- without reinterpretation above; all new writes use the stricter policy rules.

drop function if exists private.assert_no_schedule_conflict(
  uuid,
  uuid,
  public.academic_term,
  uuid,
  boolean
);

create or replace function private.assert_no_schedule_conflict(
  target_student_id uuid,
  target_class_id uuid,
  target_term public.academic_term,
  excluded_enrollment_id uuid default null,
  allow_conflict boolean default false,
  target_slots jsonb default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_slots jsonb;
  target_policy public.course_term_policy;
begin
  resolved_slots := coalesce(target_slots, private.class_slots_json(target_class_id));
  perform private.assert_enrollment_schedule_allowed(target_class_id, target_term, resolved_slots);

  select course_name.term_policy
  into target_policy
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = target_class_id;

  if target_policy = 'lunch' and exists (
    select 1
    from public.class_enrollments existing
    join public.classes existing_class on existing_class.id = existing.class_id
    join public.course_names existing_course on existing_course.id = existing_class.course_name_id
    where existing.student_id = target_student_id
      and existing.active
      and existing.id is distinct from excluded_enrollment_id
      and existing_course.term_policy = 'lunch'
      and private.terms_overlap(existing.academic_term, target_term)
  ) then
    raise exception 'lunch_schedule_conflict' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.class_enrollments existing
    join public.class_enrollment_meeting_slots existing_slot
      on existing_slot.enrollment_id = existing.id
    join jsonb_to_recordset(resolved_slots) next_slot(day_type public.day_type, period_number smallint)
      on next_slot.day_type = existing_slot.day_type
     and next_slot.period_number = existing_slot.period_number
    where existing.student_id = target_student_id
      and existing.active
      and existing.id is distinct from excluded_enrollment_id
      and private.terms_overlap(existing.academic_term, target_term)
  ) then
    -- Conflict overrides were a legacy escape hatch. Semester-aware schedules
    -- reject invalid combinations consistently in every write path.
    perform allow_conflict;
    raise exception 'schedule_conflict' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.validate_enrollment_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_enrollment_id uuid;
  enrollment public.class_enrollments%rowtype;
  slots jsonb;
begin
  if tg_table_name = 'class_enrollments' then
    target_enrollment_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_enrollment_id := case when tg_op = 'DELETE' then old.enrollment_id else new.enrollment_id end;
  end if;

  select * into enrollment
  from public.class_enrollments
  where id = target_enrollment_id;

  if not found or not enrollment.active then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  slots := private.enrollment_slots_json(enrollment.id);
  perform private.assert_enrollment_schedule_allowed(enrollment.class_id, enrollment.academic_term, slots);
  perform private.assert_no_schedule_conflict(
    enrollment.student_id,
    enrollment.class_id,
    enrollment.academic_term,
    enrollment.id,
    false,
    slots
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger validate_enrollment_schedule_after_enrollment
after insert or update of class_id, academic_term, active on public.class_enrollments
deferrable initially deferred
for each row execute function private.validate_enrollment_schedule();

create constraint trigger validate_enrollment_schedule_after_slot
after insert or update or delete on public.class_enrollment_meeting_slots
deferrable initially deferred
for each row execute function private.validate_enrollment_schedule();

drop function if exists private.add_enrollment_for_student(
  uuid,
  uuid,
  public.academic_term,
  uuid,
  public.schedule_action,
  boolean
);

create or replace function private.add_enrollment_for_student(
  target_student_id uuid,
  target_class_id uuid,
  target_term public.academic_term,
  actor_id uuid,
  history_action public.schedule_action,
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
  enrollment_id uuid;
  prior_enrollment_id uuid;
  prior_term public.academic_term;
  target_policy public.course_term_policy;
  resolved_slots jsonb;
  class_snapshot jsonb;
begin
  if not exists (
    select 1
    from public.classes class_record
    join public.course_names course_name on course_name.id = class_record.course_name_id
    where class_record.id = target_class_id
      and class_record.status = 'active'
      and course_name.status = 'active'
  ) then
    raise exception 'active_class_not_found' using errcode = 'P0002';
  end if;

  resolved_slots := coalesce(target_slots, private.class_slots_json(target_class_id));
  perform private.assert_enrollment_schedule_allowed(target_class_id, target_term, resolved_slots);

  select enrollment.id, enrollment.academic_term, course_name.term_policy
  into prior_enrollment_id, prior_term, target_policy
  from public.class_enrollments enrollment
  join public.classes class_record on class_record.id = enrollment.class_id
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where enrollment.student_id = target_student_id
    and enrollment.class_id = target_class_id
  for update of enrollment;

  if target_policy = 'lunch'
     and prior_term in ('semester_1'::public.academic_term, 'semester_2'::public.academic_term)
     and target_term in ('semester_1'::public.academic_term, 'semester_2'::public.academic_term)
     and prior_term <> target_term then
    target_term := 'full_year';
    perform private.assert_enrollment_schedule_allowed(target_class_id, target_term, resolved_slots);
  end if;

  perform private.assert_no_schedule_conflict(
    target_student_id,
    target_class_id,
    target_term,
    prior_enrollment_id,
    allow_conflict,
    resolved_slots
  );

  insert into public.class_enrollments (student_id, class_id, academic_term, active)
  values (target_student_id, target_class_id, target_term, true)
  on conflict (student_id, class_id) do update
    set academic_term = excluded.academic_term,
        active = true,
        updated_at = now()
  returning id into enrollment_id;

  perform private.set_enrollment_meeting_slots(enrollment_id, resolved_slots);

  select jsonb_build_object(
    'enrollment_id', enrollment_id,
    'class_id', class_record.id,
    'course_name_id', course_name.id,
    'course_name', course_name.name,
    'teacher_last_name', class_record.teacher_last_name,
    'academic_term', target_term,
    'meeting_slots', resolved_slots
  )
  into class_snapshot
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = target_class_id;

  insert into public.schedule_change_history (student_id, action, new_value, changed_by)
  values (target_student_id, history_action, class_snapshot, actor_id);

  return enrollment_id;
end;
$$;

drop function if exists public.enroll_in_class(uuid, public.academic_term, boolean);
drop function if exists private.enroll_in_class(uuid, public.academic_term, boolean);

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
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  return private.add_enrollment_for_student(
    actor_id,
    target_class_id,
    target_term,
    actor_id,
    'class_added',
    allow_conflict,
    target_slots
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

create or replace function private.update_enrollment_schedule(
  target_enrollment_id uuid,
  next_term public.academic_term,
  next_slots jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing public.class_enrollments%rowtype;
  previous_slots jsonb;
  course_name_value text;
begin
  actor_id := private.require_active_user();

  select * into existing
  from public.class_enrollments
  where id = target_enrollment_id
    and student_id = actor_id
    and active
  for update;

  if not found then
    raise exception 'active_enrollment_not_found' using errcode = 'P0002';
  end if;

  previous_slots := private.enrollment_slots_json(existing.id);
  perform private.assert_enrollment_schedule_allowed(existing.class_id, next_term, next_slots);
  perform private.assert_no_schedule_conflict(
    actor_id,
    existing.class_id,
    next_term,
    existing.id,
    false,
    next_slots
  );

  if existing.academic_term = next_term
     and private.meeting_slots_equal(previous_slots, next_slots) then
    return;
  end if;

  select course_name.name
  into course_name_value
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = existing.class_id;

  update public.class_enrollments
  set academic_term = next_term
  where id = existing.id;

  perform private.set_enrollment_meeting_slots(existing.id, next_slots);

  insert into public.schedule_change_history (
    student_id,
    action,
    previous_value,
    new_value,
    changed_by
  )
  values (
    actor_id,
    case
      when existing.academic_term is distinct from next_term then 'term_changed'::public.schedule_action
      else 'meeting_slots_changed'::public.schedule_action
    end,
    jsonb_build_object(
      'enrollment_id', existing.id,
      'class_id', existing.class_id,
      'course_name', course_name_value,
      'academic_term', existing.academic_term,
      'meeting_slots', previous_slots
    ),
    jsonb_build_object(
      'enrollment_id', existing.id,
      'class_id', existing.class_id,
      'course_name', course_name_value,
      'academic_term', next_term,
      'meeting_slots', next_slots
    ),
    actor_id
  );
end;
$$;

create or replace function public.update_enrollment_schedule(
  p_enrollment_id uuid,
  p_academic_term public.academic_term,
  p_meeting_slots jsonb
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_enrollment_schedule(
    p_enrollment_id,
    p_academic_term,
    p_meeting_slots
  );
$$;

create or replace function private.update_enrollment_term(
  target_enrollment_id uuid,
  next_term public.academic_term
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare current_slots jsonb;
begin
  current_slots := private.enrollment_slots_json(target_enrollment_id);
  perform private.update_enrollment_schedule(target_enrollment_id, next_term, current_slots);
end;
$$;

drop function if exists public.replace_enrollment(uuid, uuid, public.academic_term, boolean);
drop function if exists private.replace_enrollment(uuid, uuid, public.academic_term, boolean);

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
  actor_id uuid;
  existing public.class_enrollments%rowtype;
  next_enrollment_id uuid;
  prior_replacement_id uuid;
  resolved_slots jsonb;
  previous_snapshot jsonb;
  next_snapshot jsonb;
begin
  actor_id := private.require_active_user();

  select * into existing
  from public.class_enrollments
  where id = target_enrollment_id
    and student_id = actor_id
    and active
  for update;

  if not found then
    raise exception 'active_enrollment_not_found' using errcode = 'P0002';
  end if;

  resolved_slots := coalesce(replacement_slots, private.class_slots_json(replacement_class_id));

  if existing.class_id = replacement_class_id then
    perform private.update_enrollment_schedule(existing.id, replacement_term, resolved_slots);
    return existing.id;
  end if;

  select enrollment.id
  into prior_replacement_id
  from public.class_enrollments enrollment
  where enrollment.student_id = actor_id
    and enrollment.class_id = replacement_class_id
  for update;

  perform private.assert_enrollment_schedule_allowed(
    replacement_class_id,
    replacement_term,
    resolved_slots
  );
  perform private.assert_no_schedule_conflict(
    actor_id,
    replacement_class_id,
    replacement_term,
    existing.id,
    allow_conflict,
    resolved_slots
  );

  select jsonb_build_object(
    'enrollment_id', existing.id,
    'class_id', class_record.id,
    'course_name_id', course_name.id,
    'course_name', course_name.name,
    'teacher_last_name', class_record.teacher_last_name,
    'academic_term', existing.academic_term,
    'meeting_slots', private.enrollment_slots_json(existing.id)
  )
  into previous_snapshot
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = existing.class_id;

  update public.class_enrollments
  set active = false
  where id = existing.id;

  insert into public.class_enrollments (student_id, class_id, academic_term, active)
  values (actor_id, replacement_class_id, replacement_term, true)
  on conflict (student_id, class_id) do update
    set academic_term = excluded.academic_term,
        active = true,
        updated_at = now()
  returning id into next_enrollment_id;

  perform private.set_enrollment_meeting_slots(next_enrollment_id, resolved_slots);

  select jsonb_build_object(
    'enrollment_id', next_enrollment_id,
    'class_id', class_record.id,
    'course_name_id', course_name.id,
    'course_name', course_name.name,
    'teacher_last_name', class_record.teacher_last_name,
    'academic_term', replacement_term,
    'meeting_slots', resolved_slots
  )
  into next_snapshot
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = replacement_class_id;

  insert into public.schedule_change_history (
    student_id,
    action,
    previous_value,
    new_value,
    changed_by
  )
  values (
    actor_id,
    'class_replaced',
    previous_snapshot,
    next_snapshot,
    actor_id
  );

  perform prior_replacement_id;
  return next_enrollment_id;
end;
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

-- Creating a section reuses an existing section whenever the shared identity
-- and format match. Flexible-attendance sections compare periods but ignore
-- the student's semester/day pattern.
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
  selected_class_id uuid;
  normalized_teacher text;
  selected_policy public.course_term_policy;
begin
  actor_id := private.require_active_user();
  perform private.consume_rate_limit(actor_id, 'class_create', 8, interval '1 hour');
  perform private.assert_valid_meeting_slots(input_meeting_slots, input_is_double);
  perform private.assert_valid_enrollment_meeting_slots(input_meeting_slots);
  input_is_double := private.meeting_slots_have_multiple_periods(input_meeting_slots);
  input_teacher_last_name := private.normalize_teacher_last_name(input_teacher_last_name);
  normalized_teacher := private.normalize_search(input_teacher_last_name);

  if input_course_name_id is not null
     and private.normalize_search(input_new_course_name) <> '' then
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
    values (
      input_new_course_name,
      private.normalize_search(input_new_course_name),
      'active',
      'user',
      actor_id
    )
    on conflict (normalized_name) do update set name = public.course_names.name
    returning id into selected_course_name_id;
  end if;

  select course_name.term_policy
  into selected_policy
  from public.course_names course_name
  where course_name.id = selected_course_name_id
    and course_name.status = 'active';

  if not found then
    raise exception 'active_course_name_not_found' using errcode = 'P0002';
  end if;

  select class_record.id
  into selected_class_id
  from public.classes class_record
  where class_record.status = 'active'
    and class_record.course_name_id = selected_course_name_id
    and class_record.normalized_teacher_last_name = normalized_teacher
    and (
      (
        selected_policy = 'flexible_attendance'
        and private.meeting_periods_equal(
          private.class_slots_json(class_record.id),
          input_meeting_slots
        )
      )
      or (
        selected_policy <> 'flexible_attendance'
        and class_record.default_academic_term = input_term
        and private.meeting_slots_equal(
          private.class_slots_json(class_record.id),
          input_meeting_slots
        )
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
    )
    values (
      selected_course_name_id,
      input_teacher_last_name,
      normalized_teacher,
      input_term,
      input_is_double,
      actor_id
    )
    returning id into selected_class_id;

    insert into public.class_meeting_slots (class_id, day_type, period_number)
    select selected_class_id, slot.day_type, slot.period_number
    from jsonb_to_recordset(input_meeting_slots) slot(
      day_type public.day_type,
      period_number smallint
    );
  end if;

  return private.add_enrollment_for_student(
    actor_id,
    selected_class_id,
    input_term,
    actor_id,
    'class_added',
    false,
    input_meeting_slots
  );
end;
$$;

create or replace function private.create_class_and_replace_enrollment(
  target_enrollment_id uuid,
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
declare actor_id uuid;
begin
  actor_id := private.require_active_user();

  perform 1
  from public.class_enrollments enrollment
  where enrollment.id = target_enrollment_id
    and enrollment.student_id = actor_id
    and enrollment.active
  for update;

  if not found then
    raise exception 'active_enrollment_not_found' using errcode = 'P0002';
  end if;

  -- Both operations run in the same transaction. If class validation or
  -- enrollment fails, the original enrollment remains active.
  perform private.remove_enrollment(target_enrollment_id);
  return private.create_class_and_enroll(
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

create or replace function public.create_class_and_replace_enrollment(
  p_enrollment_id uuid,
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
  select private.create_class_and_replace_enrollment(
    p_enrollment_id,
    p_course_name_id,
    p_new_course_name,
    p_teacher_last_name,
    p_academic_term,
    p_is_double_period,
    p_meeting_slots,
    p_confirmed_no_course_match
  );
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
declare
  actor_id uuid;
  before_data jsonb;
  after_data jsonb;
  current_status public.class_status;
  next_policy public.course_term_policy;
  enrollment_record record;
  effective_term public.academic_term;
  effective_slots jsonb;
begin
  actor_id := private.require_admin();

  select class_record.status,
         jsonb_build_object(
           'class', to_jsonb(class_record),
           'course_name', course_name.name,
           'meeting_slots', private.class_slots_json(class_record.id)
         )
  into current_status, before_data
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = target_class_id
  for update of class_record;

  if not found then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;
  if current_status <> 'active' then
    raise exception 'only_active_classes_can_be_edited' using errcode = '23514';
  end if;

  select course_name.term_policy
  into next_policy
  from public.course_names course_name
  where course_name.id = next_course_name_id
    and course_name.status = 'active';

  if not found then
    raise exception 'active_course_name_not_found' using errcode = 'P0002';
  end if;

  next_teacher_last_name := private.normalize_teacher_last_name(next_teacher_last_name);
  if char_length(trim(coalesce(action_reason, ''))) < 3 then
    raise exception 'class_edit_reason_required' using errcode = '23514';
  end if;
  perform private.assert_valid_meeting_slots(next_slots, next_is_double);
  perform private.assert_valid_enrollment_meeting_slots(next_slots);
  next_is_double := private.meeting_slots_have_multiple_periods(next_slots);

  if next_policy = 'full_year' and next_term <> 'full_year' then
    raise exception 'full_year_course_requires_full_year' using errcode = '23514';
  end if;
  if next_policy = 'semester' and next_term = 'full_year' then
    raise exception 'half_credit_course_requires_semester' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.class_enrollments edited_enrollment
    join public.class_enrollments other_enrollment
      on other_enrollment.student_id = edited_enrollment.student_id
     and other_enrollment.active
     and other_enrollment.class_id <> target_class_id
    join public.class_enrollment_meeting_slots other_slot
      on other_slot.enrollment_id = other_enrollment.id
    join lateral jsonb_to_recordset(
      case
        when next_policy = 'flexible_attendance'
          then private.enrollment_slots_json(edited_enrollment.id)
        else next_slots
      end
    ) requested(day_type public.day_type, period_number smallint)
      on requested.day_type = other_slot.day_type
     and requested.period_number = other_slot.period_number
    where edited_enrollment.class_id = target_class_id
      and edited_enrollment.active
      and private.terms_overlap(
        case
          when next_policy in ('flexible_attendance', 'lunch')
            then edited_enrollment.academic_term
          when next_policy = 'full_year'
            then 'full_year'::public.academic_term
          else next_term
        end,
        other_enrollment.academic_term
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

  delete from public.class_meeting_slots
  where class_id = target_class_id;

  insert into public.class_meeting_slots (class_id, day_type, period_number)
  select target_class_id, slot.day_type, slot.period_number
  from jsonb_to_recordset(next_slots) slot(day_type public.day_type, period_number smallint);

  for enrollment_record in
    select enrollment.id, enrollment.academic_term
    from public.class_enrollments enrollment
    where enrollment.class_id = target_class_id
      and enrollment.active
    for update
  loop
    effective_term := case
      when next_policy in ('flexible_attendance', 'lunch') then enrollment_record.academic_term
      when next_policy = 'full_year' then 'full_year'::public.academic_term
      else next_term
    end;
    effective_slots := case
      when next_policy = 'flexible_attendance'
        then private.enrollment_slots_json(enrollment_record.id)
      else next_slots
    end;

    update public.class_enrollments
    set academic_term = effective_term
    where id = enrollment_record.id;

    if next_policy <> 'flexible_attendance' then
      perform private.set_enrollment_meeting_slots(enrollment_record.id, effective_slots);
    end if;

    perform private.assert_enrollment_schedule_allowed(
      target_class_id,
      effective_term,
      effective_slots
    );
  end loop;

  select jsonb_build_object(
           'class', to_jsonb(class_record),
           'course_name', course_name.name,
           'meeting_slots', private.class_slots_json(class_record.id)
         )
  into after_data
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = target_class_id;

  insert into public.schedule_change_history (
    student_id,
    action,
    previous_value,
    new_value,
    changed_by
  )
  select enrollment.student_id,
         'meeting_slots_changed',
         before_data,
         after_data,
         actor_id
  from public.class_enrollments enrollment
  where enrollment.class_id = target_class_id
    and enrollment.active;

  perform private.write_audit(
    actor_id,
    'class_edited',
    'class',
    target_class_id::text,
    before_data,
    after_data,
    action_reason
  );
end;
$$;

revoke all on function private.enrollment_slots_json(uuid) from public, anon, authenticated;
revoke all on function private.class_slots_json(uuid) from public, anon, authenticated;
revoke all on function private.meeting_slots_equal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.meeting_periods_equal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.assert_valid_enrollment_meeting_slots(jsonb) from public, anon, authenticated;
revoke all on function private.assert_enrollment_schedule_allowed(uuid, public.academic_term, jsonb) from public, anon, authenticated;
revoke all on function private.set_enrollment_meeting_slots(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.copy_default_slots_to_enrollment() from public, anon, authenticated;
revoke all on function private.sync_class_slot_to_fixed_enrollments() from public, anon, authenticated;
revoke all on function private.assert_no_schedule_conflict(uuid, uuid, public.academic_term, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function private.validate_enrollment_schedule() from public, anon, authenticated;
revoke all on function private.add_enrollment_for_student(uuid, uuid, public.academic_term, uuid, public.schedule_action, boolean, jsonb) from public, anon, authenticated;
revoke all on function private.enroll_in_class(uuid, public.academic_term, boolean, jsonb) from public, anon, authenticated;
revoke all on function private.update_enrollment_schedule(uuid, public.academic_term, jsonb) from public, anon, authenticated;
revoke all on function private.replace_enrollment(uuid, uuid, public.academic_term, boolean, jsonb) from public, anon, authenticated;
revoke all on function private.create_class_and_replace_enrollment(uuid, uuid, text, text, public.academic_term, boolean, jsonb, boolean) from public, anon, authenticated;

revoke all on function public.enroll_in_class(uuid, public.academic_term, boolean, jsonb) from public, anon;
revoke all on function public.update_enrollment_schedule(uuid, public.academic_term, jsonb) from public, anon;
revoke all on function public.replace_enrollment(uuid, uuid, public.academic_term, boolean, jsonb) from public, anon;
revoke all on function public.create_class_and_replace_enrollment(uuid, uuid, text, text, public.academic_term, boolean, jsonb, boolean) from public, anon;
grant execute on function public.enroll_in_class(uuid, public.academic_term, boolean, jsonb) to authenticated;
grant execute on function public.update_enrollment_schedule(uuid, public.academic_term, jsonb) to authenticated;
grant execute on function public.replace_enrollment(uuid, uuid, public.academic_term, boolean, jsonb) to authenticated;
grant execute on function public.create_class_and_replace_enrollment(uuid, uuid, text, text, public.academic_term, boolean, jsonb, boolean) to authenticated;

-- Search exposes course policy and can scope add-class results to the semester
-- currently being edited. Flexible-attendance sections remain discoverable from
-- any A/B cell because the student's enrollment supplies the actual pattern.
drop function if exists public.search_classes(text, public.day_type, smallint, integer);
drop function if exists private.search_classes(text, public.day_type, smallint, integer);

create or replace function private.search_classes(
  search_query text default '',
  search_day_type public.day_type default null,
  search_period_number smallint default null,
  result_limit integer default 20,
  search_term public.academic_term default null
)
returns table (
  class_id uuid,
  course_name_id uuid,
  course_name text,
  course_term_policy public.course_term_policy,
  teacher_last_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  score real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare normalized_query text := private.normalize_search(left(coalesce(search_query, ''), 100));
begin
  perform private.require_active_user();

  return query
  select class_record.id,
         course_name.id,
         course_name.name,
         course_name.term_policy,
         class_record.teacher_last_name,
         class_record.default_academic_term,
         class_record.is_double_period,
         jsonb_agg(
           jsonb_build_object('day_type', slot.day_type, 'period_number', slot.period_number)
           order by slot.day_type, slot.period_number
         ),
         (
           case
             when search_day_type is not null
              and search_period_number is not null
              and bool_or(slot.day_type = search_day_type and slot.period_number = search_period_number)
             then 50 else 0
           end
           + case
             when normalized_query = '' then 10
             else greatest(
               extensions.similarity(course_name.normalized_name, normalized_query),
               extensions.similarity(class_record.normalized_teacher_last_name, normalized_query)
             ) * 40
           end
           + case when course_name.normalized_name = normalized_query then 30 else 0 end
         )::real
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  join public.class_meeting_slots slot on slot.class_id = class_record.id
  where class_record.status = 'active'
    and course_name.status = 'active'
    and (
      normalized_query = ''
      or course_name.normalized_name like '%' || normalized_query || '%'
      or class_record.normalized_teacher_last_name like '%' || normalized_query || '%'
      or course_name.normalized_name operator(extensions.%) normalized_query
      or class_record.normalized_teacher_last_name operator(extensions.%) normalized_query
    )
    and (
      search_term is null
      or class_record.default_academic_term = 'full_year'
      or class_record.default_academic_term = search_term
      or course_name.term_policy in ('flexible_attendance', 'lunch')
    )
    and (
      (
        course_name.term_policy = 'flexible_attendance'
        and (
          search_period_number is null
          or exists (
            select 1
            from public.class_meeting_slots flexible_slot
            where flexible_slot.class_id = class_record.id
              and flexible_slot.period_number = search_period_number
          )
        )
      )
      or (search_day_type is null and search_period_number is null)
      or exists (
        select 1
        from public.class_meeting_slots filter_slot
        where filter_slot.class_id = class_record.id
          and (search_day_type is null or filter_slot.day_type = search_day_type)
          and (search_period_number is null or filter_slot.period_number = search_period_number)
      )
    )
  group by class_record.id, course_name.id
  order by 9 desc, course_name.name, class_record.teacher_last_name
  limit least(greatest(coalesce(result_limit, 20), 1), 1000);
end;
$$;

create or replace function public.search_classes(
  p_query text default '',
  p_day_type public.day_type default null,
  p_period_number smallint default null,
  p_limit integer default 20,
  p_academic_term public.academic_term default null
)
returns table (
  class_id uuid,
  course_name_id uuid,
  course_name text,
  course_term_policy public.course_term_policy,
  teacher_last_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  score real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.search_classes(
    p_query,
    p_day_type,
    p_period_number,
    p_limit,
    p_academic_term
  );
$$;

drop function if exists public.search_course_names(text, integer);
drop function if exists private.search_course_names(text, integer);

create or replace function private.search_course_names(
  search_query text default '',
  result_limit integer default 20
)
returns table (
  course_name_id uuid,
  course_name text,
  course_term_policy public.course_term_policy,
  score real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare normalized_query text := private.normalize_search(left(coalesce(search_query, ''), 100));
begin
  perform private.require_active_user();
  return query
  select course_name.id,
         course_name.name,
         course_name.term_policy,
         (
           case
             when normalized_query = '' then 10
             else extensions.similarity(course_name.normalized_name, normalized_query) * 40
           end
           + case when course_name.normalized_name = normalized_query then 50 else 0 end
           + case when course_name.normalized_name like normalized_query || '%' then 20 else 0 end
         )::real
  from public.course_names course_name
  where course_name.status = 'active'
    and (
      normalized_query = ''
      or course_name.normalized_name like '%' || normalized_query || '%'
      or course_name.normalized_name operator(extensions.%) normalized_query
    )
  order by 4 desc, course_name.name
  limit least(greatest(coalesce(result_limit, 20), 1), 50);
end;
$$;

create or replace function public.search_course_names(
  p_query text default '',
  p_limit integer default 20
)
returns table (
  course_name_id uuid,
  course_name text,
  course_term_policy public.course_term_policy,
  score real
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.search_course_names(p_query, p_limit); $$;

drop function if exists public.guest_search_course_names(text, integer);

create or replace function public.guest_search_course_names(
  p_query text default '',
  p_limit integer default 20
)
returns table (
  course_name_id uuid,
  course_name text,
  course_term_policy public.course_term_policy,
  score real
)
language sql
stable
security definer
set search_path = ''
as $$
  select course_name.id,
         course_name.name,
         course_name.term_policy,
         (
           case
             when private.normalize_search(left(coalesce(p_query, ''), 100)) = '' then 10
             else extensions.similarity(
               course_name.normalized_name,
               private.normalize_search(left(coalesce(p_query, ''), 100))
             ) * 40
           end
           + case
             when course_name.normalized_name = private.normalize_search(left(coalesce(p_query, ''), 100)) then 50
             else 0
           end
         )::real
  from public.course_names course_name
  where course_name.status = 'active'
    and (
      private.normalize_search(left(coalesce(p_query, ''), 100)) = ''
      or course_name.normalized_name like '%' || private.normalize_search(left(coalesce(p_query, ''), 100)) || '%'
      or course_name.normalized_name operator(extensions.%) private.normalize_search(left(coalesce(p_query, ''), 100))
    )
  order by 4 desc, 2
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

drop function if exists public.guest_search_classes(text, public.day_type, smallint, integer);

create or replace function public.guest_search_classes(
  p_query text default '',
  p_day_type public.day_type default null,
  p_period_number smallint default null,
  p_limit integer default 1000,
  p_academic_term public.academic_term default null
)
returns table (
  class_id uuid,
  course_name_id uuid,
  course_name text,
  course_term_policy public.course_term_policy,
  teacher_last_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  score real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare normalized_query text := private.normalize_search(left(coalesce(p_query, ''), 100));
begin
  return query
  select class_record.id,
         course_name.id,
         course_name.name,
         course_name.term_policy,
         class_record.teacher_last_name,
         class_record.default_academic_term,
         class_record.is_double_period,
         jsonb_agg(
           jsonb_build_object('day_type', slot.day_type, 'period_number', slot.period_number)
           order by slot.day_type, slot.period_number
         ),
         (
           case
             when p_day_type is not null
              and p_period_number is not null
              and bool_or(slot.day_type = p_day_type and slot.period_number = p_period_number)
             then 50 else 0
           end
           + case
             when normalized_query = '' then 10
             else greatest(
               extensions.similarity(course_name.normalized_name, normalized_query),
               extensions.similarity(class_record.normalized_teacher_last_name, normalized_query)
             ) * 40
           end
           + case when course_name.normalized_name = normalized_query then 30 else 0 end
         )::real
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  join public.class_meeting_slots slot on slot.class_id = class_record.id
  where class_record.status = 'active'
    and course_name.status = 'active'
    and (
      normalized_query = ''
      or course_name.normalized_name like '%' || normalized_query || '%'
      or class_record.normalized_teacher_last_name like '%' || normalized_query || '%'
      or course_name.normalized_name operator(extensions.%) normalized_query
      or class_record.normalized_teacher_last_name operator(extensions.%) normalized_query
    )
    and (
      p_academic_term is null
      or class_record.default_academic_term = 'full_year'
      or class_record.default_academic_term = p_academic_term
      or course_name.term_policy in ('flexible_attendance', 'lunch')
    )
    and (
      (
        course_name.term_policy = 'flexible_attendance'
        and (
          p_period_number is null
          or exists (
            select 1
            from public.class_meeting_slots flexible_slot
            where flexible_slot.class_id = class_record.id
              and flexible_slot.period_number = p_period_number
          )
        )
      )
      or (p_day_type is null and p_period_number is null)
      or exists (
        select 1
        from public.class_meeting_slots filter_slot
        where filter_slot.class_id = class_record.id
          and (p_day_type is null or filter_slot.day_type = p_day_type)
          and (p_period_number is null or filter_slot.period_number = p_period_number)
      )
    )
  group by class_record.id, course_name.id
  order by 9 desc, 3, class_record.teacher_last_name
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

revoke all on function private.search_classes(text, public.day_type, smallint, integer, public.academic_term) from public, anon, authenticated;
revoke all on function private.search_course_names(text, integer) from public, anon, authenticated;
revoke all on function public.search_classes(text, public.day_type, smallint, integer, public.academic_term) from public, anon;
revoke all on function public.search_course_names(text, integer) from public, anon;
revoke all on function public.guest_search_course_names(text, integer) from public, authenticated;
revoke all on function public.guest_search_classes(text, public.day_type, smallint, integer, public.academic_term) from public, authenticated;
grant execute on function public.search_classes(text, public.day_type, smallint, integer, public.academic_term) to authenticated;
grant execute on function public.search_course_names(text, integer) to authenticated;
grant execute on function public.guest_search_course_names(text, integer) to anon;
grant execute on function public.guest_search_classes(text, public.day_type, smallint, integer, public.academic_term) to anon;

drop function if exists public.get_visible_schedule(uuid);
drop function if exists private.get_visible_schedule(uuid);

create or replace function private.get_visible_schedule(target_student_id uuid)
returns table (
  enrollment_id uuid,
  class_id uuid,
  course_name_id uuid,
  course_name text,
  course_term_policy public.course_term_policy,
  teacher_last_name text,
  academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  if not private.can_view_full_schedule(actor_id, target_student_id) then
    raise exception 'schedule_not_visible' using errcode = '42501';
  end if;

  return query
  select enrollment.id,
         class_record.id,
         course_name.id,
         course_name.name,
         course_name.term_policy,
         class_record.teacher_last_name,
         enrollment.academic_term,
         class_record.is_double_period,
         jsonb_agg(
           jsonb_build_object(
             'day_type', enrollment_slot.day_type,
             'period_number', enrollment_slot.period_number
           )
           order by enrollment_slot.day_type, enrollment_slot.period_number
         ),
         enrollment.created_at
  from public.class_enrollments enrollment
  join public.classes class_record
    on class_record.id = enrollment.class_id
   and class_record.status = 'active'
  join public.course_names course_name
    on course_name.id = class_record.course_name_id
  join public.class_enrollment_meeting_slots enrollment_slot
    on enrollment_slot.enrollment_id = enrollment.id
  where enrollment.student_id = target_student_id
    and enrollment.active
  group by enrollment.id, class_record.id, course_name.id
  order by min(enrollment_slot.period_number), course_name.name;
end;
$$;

create or replace function public.get_visible_schedule(p_student_id uuid)
returns table (
  enrollment_id uuid,
  class_id uuid,
  course_name_id uuid,
  course_name text,
  course_term_policy public.course_term_policy,
  teacher_last_name text,
  academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_visible_schedule(p_student_id); $$;

revoke all on function private.get_visible_schedule(uuid) from public, anon, authenticated;
revoke all on function public.get_visible_schedule(uuid) from public, anon;
grant execute on function public.get_visible_schedule(uuid) to authenticated;

create or replace function public.get_public_schedule_share(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'available', true,
        'owner_name', profile.full_name,
        'schedule', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'day_type', enrollment_slot.day_type,
                'period_number', enrollment_slot.period_number,
                'course_name', course_name.name,
                'teacher_last_name', class_record.teacher_last_name,
                'academic_term', enrollment.academic_term
              )
              order by enrollment_slot.day_type,
                       enrollment_slot.period_number,
                       enrollment.academic_term,
                       course_name.name
            )
            from public.class_enrollments enrollment
            join public.classes class_record
              on class_record.id = enrollment.class_id
             and class_record.status = 'active'
            join public.course_names course_name
              on course_name.id = class_record.course_name_id
            join public.class_enrollment_meeting_slots enrollment_slot
              on enrollment_slot.enrollment_id = enrollment.id
            where enrollment.student_id = link.owner_id
              and enrollment.active
          ),
          '[]'::jsonb
        )
      )
      from public.schedule_share_links link
      join public.profiles profile on profile.id = link.owner_id
      join private.account_moderation moderation on moderation.user_id = link.owner_id
      where link.token = p_token
        and link.enabled
        and moderation.suspended_at is null
        and moderation.deleted_at is null
        and exists (
          select 1
          from public.class_enrollments active_enrollment
          where active_enrollment.student_id = link.owner_id
            and active_enrollment.active
        )
    ),
    jsonb_build_object('available', false, 'owner_name', null, 'schedule', '[]'::jsonb)
  );
$$;

revoke all on function public.get_public_schedule_share(uuid) from public, anon, authenticated;
grant execute on function public.get_public_schedule_share(uuid) to anon, authenticated;

create or replace function private.capture_enrollment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  enrollment public.class_enrollments%rowtype;
  actor_id uuid := auth.uid();
  event_name text;
  class_metadata jsonb;
begin
  if tg_op = 'DELETE' then enrollment := old; else enrollment := new; end if;
  if tg_op = 'INSERT' and new.active then event_name := 'user_joined_class';
  elsif tg_op = 'DELETE' and old.active then event_name := case when actor_id = old.student_id then 'user_left_class' else 'user_removed_from_class' end;
  elsif tg_op = 'UPDATE' and old.active and not new.active then event_name := case when actor_id = new.student_id then 'user_left_class' else 'user_removed_from_class' end;
  elsif tg_op = 'UPDATE' and not old.active and new.active then event_name := 'user_joined_class';
  elsif tg_op = 'DELETE' then return old;
  else return new;
  end if;

  select jsonb_build_object(
    'class_id', class_record.id,
    'course_name_id', course_name.id,
    'course_name', course_name.name,
    'course_term_policy', course_name.term_policy,
    'teacher_last_name', class_record.teacher_last_name,
    'class_default_academic_term', class_record.default_academic_term,
    'enrollment_academic_term', enrollment.academic_term,
    'meeting_slots', case
      when jsonb_array_length(private.enrollment_slots_json(enrollment.id)) > 0
        then private.enrollment_slots_json(enrollment.id)
      else private.class_slots_json(enrollment.class_id)
    end
  )
  into class_metadata
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = enrollment.class_id;

  perform private.write_event_log(
    'audit',
    event_name,
    actor_id,
    enrollment.student_id,
    'class',
    enrollment.class_id::text,
    'succeeded',
    coalesce(class_metadata, '{}'::jsonb) || jsonb_build_object('enrollment_id', enrollment.id)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Atomic importer replacement now persists each reviewed row's enrollment
-- pattern. Shared flexible-attendance sections are reused when the course and
-- teacher identify one unambiguous roster, regardless of the student's pattern.
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
  requested_policy public.course_term_policy;
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

    perform private.assert_valid_enrollment_meeting_slots(requested_slots);

    select coalesce(
      jsonb_agg(
        jsonb_build_object('day_type', slot.day_type, 'period_number', slot.period_number)
        order by slot.day_type, slot.period_number
      ),
      '[]'::jsonb
    )
    into requested_slots
    from jsonb_to_recordset(requested_slots) slot(day_type public.day_type, period_number smallint);

    requested_is_double := private.meeting_slots_have_multiple_periods(requested_slots);

    select course_name.term_policy
    into requested_policy
    from public.course_names course_name
    where course_name.id = requested_course_name_id
      and course_name.status = 'active';

    if not found then
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
        and (
          (
            requested_policy = 'flexible_attendance'
            and private.meeting_periods_equal(
              private.class_slots_json(class_record.id),
              requested_slots
            )
          )
          or (
            requested_policy = 'lunch'
            and private.meeting_slots_equal(
              private.class_slots_json(class_record.id),
              requested_slots
            )
          )
          or (
            class_record.default_academic_term = requested_term
            and private.meeting_slots_equal(
              private.class_slots_json(class_record.id),
              requested_slots
            )
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
        and private.meeting_slots_equal(
          private.class_slots_json(class_record.id),
          requested_slots
        )
      order by class_record.created_at, class_record.id
      limit 1;

      if selected_class_id is null
         and requested_policy in ('flexible_attendance', 'lunch') then
        select class_record.id
        into selected_class_id
        from public.classes class_record
        where class_record.status = 'active'
          and class_record.course_name_id = requested_course_name_id
          and class_record.normalized_teacher_last_name = requested_normalized_teacher
          and case
            when requested_policy = 'flexible_attendance'
              then private.meeting_periods_equal(
                private.class_slots_json(class_record.id),
                requested_slots
              )
            else private.meeting_slots_equal(
              private.class_slots_json(class_record.id),
              requested_slots
            )
          end
        order by class_record.created_at, class_record.id
        limit 1;
      end if;

      if selected_class_id is null then
        insert into public.classes (
          course_name_id,
          teacher_last_name,
          normalized_teacher_last_name,
          default_academic_term,
          is_double_period,
          created_by
        )
        values (
          requested_course_name_id,
          requested_teacher_last_name,
          requested_normalized_teacher,
          requested_term,
          requested_is_double,
          actor_id
        )
        returning id into selected_class_id;

        insert into public.class_meeting_slots (class_id, day_type, period_number)
        select selected_class_id, slot.day_type, slot.period_number
        from jsonb_to_recordset(requested_slots) slot(day_type public.day_type, period_number smallint);
      end if;
    end if;

    perform private.assert_enrollment_schedule_allowed(
      selected_class_id,
      requested_term,
      requested_slots
    );

    if exists (
      select 1
      from jsonb_to_recordset(resolved_rows) previous(class_id uuid)
      where previous.class_id = selected_class_id
    ) then
      if requested_policy = 'lunch'
         and requested_term in ('semester_1'::public.academic_term, 'semester_2'::public.academic_term)
         and exists (
           select 1
           from jsonb_to_recordset(resolved_rows) previous(
             class_id uuid,
             academic_term public.academic_term
           )
           where previous.class_id = selected_class_id
             and previous.academic_term in (
               'semester_1'::public.academic_term,
               'semester_2'::public.academic_term
             )
             and previous.academic_term <> requested_term
         ) then
        select jsonb_agg(
                 case
                   when (entry.value ->> 'class_id')::uuid = selected_class_id
                     then jsonb_set(entry.value, '{academic_term}', '"full_year"'::jsonb)
                   else entry.value
                 end
                 order by entry.ordinality
               )
        into resolved_rows
        from jsonb_array_elements(resolved_rows) with ordinality entry(value, ordinality);
        continue;
      end if;

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
    from jsonb_to_recordset(resolved_rows) left_row(
      row_number integer,
      class_id uuid,
      course_name_id uuid,
      teacher_last_name text,
      academic_term public.academic_term,
      meeting_slots jsonb
    )
    join jsonb_to_recordset(resolved_rows) right_row(
      row_number integer,
      class_id uuid,
      course_name_id uuid,
      teacher_last_name text,
      academic_term public.academic_term,
      meeting_slots jsonb
    )
      on left_row.row_number < right_row.row_number
     and private.terms_overlap(left_row.academic_term, right_row.academic_term)
    join public.course_names left_course on left_course.id = left_row.course_name_id
    join public.course_names right_course on right_course.id = right_row.course_name_id
    where (
      left_course.term_policy = 'lunch'
      and right_course.term_policy = 'lunch'
    ) or exists (
      select 1
      from jsonb_to_recordset(left_row.meeting_slots) left_slot(
        day_type public.day_type,
        period_number smallint
      )
      join jsonb_to_recordset(right_row.meeting_slots) right_slot(
        day_type public.day_type,
        period_number smallint
      )
        on right_slot.day_type = left_slot.day_type
       and right_slot.period_number = left_slot.period_number
    )
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
  select actor_id,
         'class_removed',
         jsonb_build_object(
           'enrollment_id', enrollment.id,
           'class_id', class_record.id,
           'course_name_id', course_name.id,
           'course_name', course_name.name,
           'teacher_last_name', class_record.teacher_last_name,
           'academic_term', enrollment.academic_term,
           'meeting_slots', private.enrollment_slots_json(enrollment.id)
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
      false,
      resolved_row.meeting_slots
    );
  end loop;

  added_count := jsonb_array_length(resolved_rows);
  return next;
end;
$$;

revoke all on function private.replace_schedule_from_import(jsonb) from public, anon, authenticated;
grant execute on function private.replace_schedule_from_import(jsonb) to authenticated;

comment on function public.replace_schedule_from_import(jsonb) is
  'Atomically replaces the caller schedule with semester-aware enrollment meeting patterns and never mutates shared class rosters.';

-- Public SECURITY INVOKER wrappers require EXECUTE on their private-schema
-- implementation. The private schema itself is not exposed through PostgREST.
grant execute on function private.search_classes(text, public.day_type, smallint, integer, public.academic_term) to authenticated;
grant execute on function private.search_course_names(text, integer) to authenticated;
grant execute on function private.get_visible_schedule(uuid) to authenticated;
grant execute on function private.enroll_in_class(uuid, public.academic_term, boolean, jsonb) to authenticated;
grant execute on function private.update_enrollment_schedule(uuid, public.academic_term, jsonb) to authenticated;
grant execute on function private.update_enrollment_term(uuid, public.academic_term) to authenticated;
grant execute on function private.replace_enrollment(uuid, uuid, public.academic_term, boolean, jsonb) to authenticated;
grant execute on function private.create_class_and_replace_enrollment(uuid, uuid, text, text, public.academic_term, boolean, jsonb, boolean) to authenticated;
