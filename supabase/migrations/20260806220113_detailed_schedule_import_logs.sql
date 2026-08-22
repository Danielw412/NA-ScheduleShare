-- Preserve a detailed, privacy-conscious audit trail for schedule imports.
-- The Edge Function records what Gemini returned and what the importer tried.
-- Review/correction events are then enriched with the final saved schedule so
-- administrators can compare the original read with the user's correction.

create or replace function private.current_schedule_log_snapshot(target_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'enrollment_id', enrollment.id,
        'class_id', class_record.id,
        'course_name_id', course.id,
        'course_name', course.name,
        'teacher_last_name', class_record.teacher_last_name,
        'academic_term', enrollment.academic_term,
        'meeting_slots', private.enrollment_slots_json(enrollment.id)
      )
      order by course.name, class_record.teacher_last_name, enrollment.academic_term, enrollment.id
    ),
    '[]'::jsonb
  )
  from public.class_enrollments enrollment
  join public.classes class_record on class_record.id = enrollment.class_id
  join public.course_names course on course.id = class_record.course_name_id
  where enrollment.student_id = target_user_id
    and enrollment.active
    and class_record.status = 'active';
$$;

revoke all on function private.current_schedule_log_snapshot(uuid) from public, anon, authenticated;

create or replace function private.record_schedule_import_backend_event(
  actor_id uuid,
  import_id uuid,
  event_result text,
  event_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
begin
  if import_id is null then
    raise exception 'invalid_import_id' using errcode = '22023';
  end if;
  if event_result not in ('succeeded', 'failed') then
    raise exception 'invalid_import_result' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(event_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_import_metadata' using errcode = '22023';
  end if;
  if actor_id is not null and not exists (
    select 1 from public.profiles profile where profile.id = actor_id
  ) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  event_name := case
    when event_result = 'succeeded' then 'schedule_import_backend_succeeded'
    else 'schedule_import_backend_failed'
  end;

  perform private.write_event_log(
    'import',
    event_name,
    actor_id,
    actor_id,
    'schedule_import',
    import_id::text,
    event_result,
    coalesce(event_metadata, '{}'::jsonb) || jsonb_build_object(
      'import_id', import_id,
      'input_image_count', case
        when jsonb_typeof(event_metadata #> '{what_was_tried,image_metadata}') = 'array'
          then jsonb_array_length(event_metadata #> '{what_was_tried,image_metadata}')
        else 0
      end
    )
  );
end;
$$;

create or replace function public.record_schedule_import_backend_event(
  p_user_id uuid,
  p_import_id uuid,
  p_result text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.record_schedule_import_backend_event(
    p_user_id,
    p_import_id,
    p_result,
    p_metadata
  );
$$;

revoke all on function public.record_schedule_import_backend_event(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_schedule_import_backend_event(uuid, uuid, text, jsonb) to service_role;

create or replace function private.record_schedule_import_event(
  event_name text,
  import_id uuid,
  event_result text,
  event_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  enriched_metadata jsonb := coalesce(event_metadata, '{}'::jsonb);
  backend_metadata jsonb;
  final_schedule jsonb;
  backend_event_name text;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if event_name not in (
    'schedule_import_started', 'schedule_import_succeeded', 'schedule_import_failed',
    'schedule_import_partially_succeeded', 'schedule_import_needs_review',
    'schedule_import_review_completed', 'schedule_import_review_skipped',
    'schedule_import_corrected', 'schedule_import_rejected', 'schedule_import_rate_limited',
    'schedule_import_invalid_image', 'schedule_import_no_schedule_detected',
    'schedule_import_course_unmatched', 'schedule_import_period_uncertain',
    'schedule_import_conflict_detected'
  ) then
    raise exception 'unsupported_import_event' using errcode = '22023';
  end if;

  if event_name in (
    'schedule_import_review_completed',
    'schedule_import_corrected',
    'schedule_import_conflict_detected',
    'schedule_import_failed',
    'schedule_import_no_schedule_detected',
    'schedule_import_course_unmatched',
    'schedule_import_period_uncertain'
  ) then
    backend_event_name := case
      when event_name in ('schedule_import_failed', 'schedule_import_no_schedule_detected')
        then 'schedule_import_backend_failed'
      else 'schedule_import_backend_succeeded'
    end;

    select log.metadata
      into backend_metadata
    from public.event_logs log
    where log.log_category = 'import'
      and log.event_type = backend_event_name
      and log.target_type = 'schedule_import'
      and log.target_id = import_id::text
      and (log.actor_user_id = actor_id or log.actor_user_id is null)
    order by log.created_at desc, log.id desc
    limit 1;

    if backend_metadata is not null then
      enriched_metadata := enriched_metadata || jsonb_build_object(
        'backend_import_details', backend_metadata,
        'original_importer_read', backend_metadata -> 'what_was_read',
        'importer_attempt', backend_metadata -> 'what_was_tried',
        'importer_failure', backend_metadata -> 'failure_cause'
      );
    end if;
  end if;

  if event_name in ('schedule_import_review_completed', 'schedule_import_corrected') then
    final_schedule := private.current_schedule_log_snapshot(actor_id);
    enriched_metadata := enriched_metadata || jsonb_build_object(
      'corrected_to', final_schedule,
      'final_schedule_class_count', jsonb_array_length(final_schedule),
      'correction_recorded_after_atomic_replace', true
    );
  end if;

  perform private.write_event_log(
    'import',
    event_name,
    actor_id,
    actor_id,
    'schedule_import',
    import_id::text,
    nullif(event_result, ''),
    enriched_metadata || jsonb_build_object('import_id', import_id)
  );

  if event_name = 'schedule_import_started' then
    insert into private.user_activity_metrics (user_id, schedule_import_count)
    values (actor_id, 1)
    on conflict (user_id) do update
      set schedule_import_count = private.user_activity_metrics.schedule_import_count + 1,
          updated_at = now();
  end if;
end;
$$;
