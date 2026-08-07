begin;
select plan(20);

create temporary table expanded_schedule_engine_payload (payload jsonb not null);

insert into expanded_schedule_engine_payload (payload)
select private.expand_schedule_engine_flexible_sections(
  jsonb_build_object(
    'job', jsonb_build_object('id', 'test-job'),
    'available_sections', jsonb_build_array(
      jsonb_build_object(
        'course_id', 'study-course',
        'course_name', 'Study Hall - NASH',
        'course_term_policy', 'flexible_attendance',
        'class_id', 'study-p3',
        'teacher_last_name', 'N/A',
        'default_academic_term', 'semester_1',
        'academic_term', 'semester_1',
        'is_double_period', false,
        'meeting_slots', jsonb_build_array(
          jsonb_build_object('day_type', 'A', 'period_number', 3),
          jsonb_build_object('day_type', 'B', 'period_number', 3)
        ),
        'active_enrollment_count', 0,
        'pattern_source', 'section_default'
      ),
      jsonb_build_object(
        'course_id', 'study-course',
        'course_name', 'Study Hall - NASH',
        'course_term_policy', 'flexible_attendance',
        'class_id', 'study-p7',
        'teacher_last_name', 'N/A',
        'default_academic_term', 'full_year',
        'academic_term', 'full_year',
        'is_double_period', false,
        'meeting_slots', jsonb_build_array(
          jsonb_build_object('day_type', 'B', 'period_number', 7)
        ),
        'active_enrollment_count', 0,
        'pattern_source', 'section_default'
      ),
      jsonb_build_object(
        'course_id', 'gym-course',
        'course_name', 'Gym',
        'course_term_policy', 'flexible_attendance',
        'class_id', 'gym-p3',
        'teacher_last_name', 'Winters',
        'default_academic_term', 'full_year',
        'academic_term', 'full_year',
        'is_double_period', false,
        'meeting_slots', jsonb_build_array(
          jsonb_build_object('day_type', 'B', 'period_number', 3)
        ),
        'active_enrollment_count', 1,
        'pattern_source', 'section_default'
      ),
      jsonb_build_object(
        'course_id', 'gym-course',
        'course_name', 'Gym',
        'course_term_policy', 'flexible_attendance',
        'class_id', 'gym-p3',
        'teacher_last_name', 'Winters',
        'default_academic_term', 'full_year',
        'academic_term', 'full_year',
        'is_double_period', false,
        'meeting_slots', jsonb_build_array(
          jsonb_build_object('day_type', 'B', 'period_number', 3)
        ),
        'active_enrollment_count', 4,
        'pattern_source', 'existing_enrollment'
      ),
      jsonb_build_object(
        'course_id', 'calc-course',
        'course_name', 'AP Calculus AB',
        'course_term_policy', 'full_year',
        'class_id', 'calc-p2',
        'teacher_last_name', 'Solenday',
        'default_academic_term', 'full_year',
        'academic_term', 'full_year',
        'is_double_period', false,
        'meeting_slots', jsonb_build_array(
          jsonb_build_object('day_type', 'A', 'period_number', 2),
          jsonb_build_object('day_type', 'B', 'period_number', 2)
        ),
        'active_enrollment_count', 0,
        'pattern_source', 'section_default'
      )
    )
  )
);

select is(
  (select payload #>> '{job,id}' from expanded_schedule_engine_payload),
  'test-job',
  'expansion preserves unrelated worker-input fields'
);

select is(
  (select jsonb_array_length(payload -> 'available_sections') from expanded_schedule_engine_payload),
  13,
  'two Study Hall sections, one Gym section, and one fixed section expand to thirteen unique placements'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'study-p3'
  ),
  5::bigint,
  'a semester-default Study Hall section exposes all five legal patterns at its period'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'study-p3'
      and section ->> 'academic_term' = 'full_year'
      and section -> 'meeting_slots' = '[{"day_type":"A","period_number":3}]'::jsonb
  ),
  1::bigint,
  'the AP Physics regression case receives a full-year A3 Study Hall option'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'study-p3'
      and section ->> 'academic_term' = 'full_year'
      and section -> 'meeting_slots' = '[{"day_type":"B","period_number":3}]'::jsonb
  ),
  1::bigint,
  'the same Study Hall section also exposes a full-year B3 option'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'study-p3'
      and section ->> 'academic_term' = 'semester_1'
      and section -> 'meeting_slots' = '[{"day_type":"A","period_number":3},{"day_type":"B","period_number":3}]'::jsonb
  ),
  1::bigint,
  'Semester 1 A3/B3 remains available exactly once'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'study-p3'
      and section ->> 'academic_term' = 'semester_2'
      and section -> 'meeting_slots' = '[{"day_type":"A","period_number":3},{"day_type":"B","period_number":3}]'::jsonb
  ),
  1::bigint,
  'Semester 2 A3/B3 is generated'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    cross join lateral jsonb_array_elements(section -> 'meeting_slots') slot
    where section ->> 'class_id' = 'study-p3'
      and (slot ->> 'period_number')::integer <> 3
  ),
  0::bigint,
  'generated Study Hall options never invent a different period'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'study-p7'
  ),
  5::bigint,
  'a one-day full-year Study Hall default also expands to five legal patterns'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'study-p7'
      and section ->> 'academic_term' = 'semester_2'
      and section -> 'meeting_slots' = '[{"day_type":"A","period_number":7},{"day_type":"B","period_number":7}]'::jsonb
  ),
  1::bigint,
  'period-seven Study Hall receives its own Semester 2 A/B pattern'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'gym-p3'
  ),
  4::bigint,
  'Gym receives the same four legal flexible-attendance patterns'
);

select is(
  (
    select (section ->> 'active_enrollment_count')::integer
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'gym-p3'
      and section ->> 'academic_term' = 'full_year'
      and section -> 'meeting_slots' = '[{"day_type":"B","period_number":3}]'::jsonb
  ),
  4,
  'an observed flexible-attendance pattern keeps its real enrollment count'
);

select is(
  (
    select section ->> 'pattern_source'
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'gym-p3'
      and section ->> 'academic_term' = 'full_year'
      and section -> 'meeting_slots' = '[{"day_type":"B","period_number":3}]'::jsonb
  ),
  'existing_enrollment',
  'an observed pattern wins deduplication over its generated duplicate'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'calc-p2'
  ),
  1::bigint,
  'fixed full-year classes are not expanded or changed'
);

select is(
  (
    select section -> 'meeting_slots'
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'class_id' = 'calc-p2'
  ),
  '[{"day_type":"A","period_number":2},{"day_type":"B","period_number":2}]'::jsonb,
  'AP Calculus AB keeps its exact A2/B2 section pattern'
);

select is(
  (
    select count(*) - count(distinct concat_ws(
      '|',
      section ->> 'course_id',
      section ->> 'class_id',
      section ->> 'academic_term',
      (section -> 'meeting_slots')::text
    ))
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
  ),
  0::bigint,
  'expanded worker input contains no duplicate placement keys'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'course_term_policy' = 'flexible_attendance'
      and section ->> 'academic_term' = 'full_year'
      and jsonb_array_length(section -> 'meeting_slots') <> 1
  ),
  0::bigint,
  'every generated full-year flexible placement is exactly one A/B-day meeting'
);

select is(
  (
    select count(*)
    from expanded_schedule_engine_payload payload_row
    cross join lateral jsonb_array_elements(payload_row.payload -> 'available_sections') section
    where section ->> 'course_term_policy' = 'flexible_attendance'
      and section ->> 'academic_term' in ('semester_1', 'semester_2')
      and not (
        jsonb_array_length(section -> 'meeting_slots') = 2
        and section -> 'meeting_slots' @> '[{"day_type":"A"}]'::jsonb
        and section -> 'meeting_slots' @> '[{"day_type":"B"}]'::jsonb
        and (section #>> '{meeting_slots,0,period_number}') = (section #>> '{meeting_slots,1,period_number}')
      )
  ),
  0::bigint,
  'every generated semester flexible placement meets on both days in one period'
);

select is(
  private.expand_schedule_engine_flexible_sections('{"available_sections":{}}'::jsonb) -> 'available_sections',
  '[]'::jsonb,
  'a malformed non-array section field is handled as an empty list'
);

select ok(
  has_function_privilege('service_role', 'public.get_schedule_engine_worker_input(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_schedule_engine_worker_input(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.get_schedule_engine_worker_input(uuid,text)', 'execute'),
  'the expanded worker-input RPC remains service-role only'
);

select * from finish();
rollback;
