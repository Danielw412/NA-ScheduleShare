-- The Schedule Engine previously saw only a flexible-attendance class's
-- default pattern and patterns already used by active students. That excluded
-- legal choices such as a full-year A-only Study Hall when the stored section
-- default was semester-long A/B. Preserve the existing worker-input builder,
-- then expand each flexible-attendance section into every legal pattern at
-- each period represented by that section.

alter function public.get_schedule_engine_worker_input(uuid, text)
rename to get_schedule_engine_worker_input_unexpanded;

alter function public.get_schedule_engine_worker_input_unexpanded(uuid, text)
set schema private;

create or replace function private.expand_schedule_engine_flexible_sections(payload jsonb)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  with input_payload as (
    select coalesce(payload, '{}'::jsonb) as value
  ),
  input_sections as (
    select expanded.section,
           expanded.ordinality::bigint as source_order
    from input_payload
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(input_payload.value -> 'available_sections') = 'array'
          then input_payload.value -> 'available_sections'
        else '[]'::jsonb
      end
    ) with ordinality expanded(section, ordinality)
  ),
  flexible_periods as (
    select distinct
           input_sections.section,
           input_sections.source_order,
           (slot ->> 'period_number')::smallint as period_number
    from input_sections
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(input_sections.section -> 'meeting_slots') = 'array'
          then input_sections.section -> 'meeting_slots'
        else '[]'::jsonb
      end
    ) slot
    where input_sections.section ->> 'course_term_policy' = 'flexible_attendance'
      and coalesce(slot ->> 'period_number', '') ~ '^[1-9]$'
  ),
  generated_sections as (
    select
      (period_source.section
        - 'academic_term'
        - 'meeting_slots'
        - 'active_enrollment_count'
        - 'pattern_source')
        || jsonb_build_object(
          'academic_term', variant.academic_term,
          'meeting_slots', variant.meeting_slots,
          'active_enrollment_count', 0,
          'pattern_source', 'section_default'
        ) as section,
      period_source.source_order,
      true as generated
    from flexible_periods period_source
    cross join lateral (
      values
        (
          'full_year',
          jsonb_build_array(
            jsonb_build_object('day_type', 'A', 'period_number', period_source.period_number)
          )
        ),
        (
          'full_year',
          jsonb_build_array(
            jsonb_build_object('day_type', 'B', 'period_number', period_source.period_number)
          )
        ),
        (
          'semester_1',
          jsonb_build_array(
            jsonb_build_object('day_type', 'A', 'period_number', period_source.period_number),
            jsonb_build_object('day_type', 'B', 'period_number', period_source.period_number)
          )
        ),
        (
          'semester_2',
          jsonb_build_array(
            jsonb_build_object('day_type', 'A', 'period_number', period_source.period_number),
            jsonb_build_object('day_type', 'B', 'period_number', period_source.period_number)
          )
        )
    ) variant(academic_term, meeting_slots)
  ),
  combined_sections as (
    select input_sections.section,
           input_sections.source_order,
           false as generated
    from input_sections
    union all
    select generated_sections.section,
           generated_sections.source_order,
           generated_sections.generated
    from generated_sections
  ),
  ranked_sections as (
    select combined_sections.section,
           row_number() over (
             partition by
               combined_sections.section ->> 'course_id',
               combined_sections.section ->> 'class_id',
               combined_sections.section ->> 'academic_term',
               combined_sections.section -> 'meeting_slots'
             order by
               combined_sections.generated,
               case
                 when combined_sections.section ->> 'pattern_source' = 'existing_enrollment' then 0
                 else 1
               end,
               case
                 when coalesce(combined_sections.section ->> 'active_enrollment_count', '') ~ '^[0-9]+$'
                   then (combined_sections.section ->> 'active_enrollment_count')::integer
                 else 0
               end desc,
               combined_sections.source_order
           ) as duplicate_rank
    from combined_sections
  ),
  expanded_sections as (
    select coalesce(
      jsonb_agg(
        ranked_sections.section
        order by
          ranked_sections.section ->> 'course_name',
          ranked_sections.section ->> 'teacher_last_name',
          ranked_sections.section ->> 'academic_term',
          (ranked_sections.section -> 'meeting_slots')::text,
          ranked_sections.section ->> 'class_id'
      ) filter (where ranked_sections.duplicate_rank = 1),
      '[]'::jsonb
    ) as value
    from ranked_sections
  )
  select jsonb_set(
    input_payload.value,
    '{available_sections}',
    expanded_sections.value,
    true
  )
  from input_payload
  cross join expanded_sections;
$$;

create or replace function public.get_schedule_engine_worker_input(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.expand_schedule_engine_flexible_sections(
    private.get_schedule_engine_worker_input_unexpanded(p_job_id, p_worker_id)
  );
$$;

revoke all on function private.get_schedule_engine_worker_input_unexpanded(uuid, text)
from public, anon, authenticated;
revoke all on function private.expand_schedule_engine_flexible_sections(jsonb)
from public, anon, authenticated;
revoke all on function public.get_schedule_engine_worker_input(uuid, text)
from public, anon, authenticated;
grant execute on function public.get_schedule_engine_worker_input(uuid, text)
to service_role;

comment on function private.expand_schedule_engine_flexible_sections(jsonb) is
'Adds every legal full-year A-only, full-year B-only, Semester 1 A/B, and Semester 2 A/B pattern for each period represented by an existing flexible-attendance section.';

comment on function public.get_schedule_engine_worker_input(uuid, text) is
'Returns claimed Schedule Engine input with all legal period-specific patterns for existing flexible-attendance sections. Service role only.';
