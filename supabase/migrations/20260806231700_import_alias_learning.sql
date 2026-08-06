create or replace function private.import_slot_key(slots jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    string_agg(
      upper(slot ->> 'day_type') || lpad(slot ->> 'period_number', 2, '0'),
      ',' order by upper(slot ->> 'day_type'), (slot ->> 'period_number')::integer
    ),
    ''
  )
  from jsonb_array_elements(
    case when jsonb_typeof(slots) = 'array' then slots else '[]'::jsonb end
  ) slot
  where slot ->> 'day_type' in ('A', 'B')
    and (slot ->> 'period_number') ~ '^[1-9]$';
$$;

create or replace function private.learn_course_aliases_from_import_metadata(
  actor_id uuid,
  import_id uuid,
  import_metadata jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_rows jsonb := coalesce(
    import_metadata #> '{backend_import_details,what_was_read,selected_review_rows}',
    import_metadata #> '{original_importer_read,selected_review_rows}',
    import_metadata #> '{what_was_read,selected_review_rows}',
    '[]'::jsonb
  );
  corrected_rows jsonb := coalesce(import_metadata -> 'corrected_to', '[]'::jsonb);
  source_row jsonb;
  source_name text;
  source_term text;
  source_teacher text;
  source_slots text;
  target_course_id uuid;
  candidate_count integer;
  alias_id uuid;
  learned integer := 0;
begin
  if jsonb_typeof(source_rows) <> 'array' or jsonb_typeof(corrected_rows) <> 'array' then
    return 0;
  end if;

  for source_row in select value from jsonb_array_elements(source_rows)
  loop
    source_name := private.normalize_course_display(source_row ->> 'source_course_name');
    if char_length(source_name) not between 2 and 160 then
      continue;
    end if;
    if source_name ~* '^(9th|10th|11th|12th)[[:space:]]+grade|^grade[[:space:]]+(9|10|11|12)$|^(counselor|case[[:space:]]*manager|attendance)$'
       or source_name ~ '(\.\.\.|…)$' then
      continue;
    end if;

    source_term := coalesce(source_row ->> 'term', 'unknown');
    source_teacher := lower(coalesce(source_row ->> 'teacher_last_name', ''));
    source_slots := private.import_slot_key(source_row -> 'meeting_slots');
    if source_slots = '' then
      continue;
    end if;

    select count(distinct (corrected.value ->> 'course_name_id')::uuid),
           (array_agg(distinct (corrected.value ->> 'course_name_id')::uuid))[1]
      into candidate_count, target_course_id
    from jsonb_array_elements(corrected_rows) corrected(value)
    where (corrected.value ->> 'course_name_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and private.import_slot_key(corrected.value -> 'meeting_slots') = source_slots
      and (
        source_term = 'unknown'
        or corrected.value ->> 'academic_term' = source_term
        or source_term = 'full_year' and corrected.value ->> 'academic_term' = 'full_year'
      )
      and (
        source_teacher = ''
        or source_teacher = 'n/a'
        or lower(coalesce(corrected.value ->> 'teacher_last_name', '')) = source_teacher
      );

    if candidate_count <> 1 or target_course_id is null then
      continue;
    end if;

    alias_id := private.upsert_course_name_alias(
      target_course_id,
      source_name,
      'import_correction',
      import_id,
      actor_id,
      true
    );
    if alias_id is not null then
      learned := learned + 1;
    end if;
  end loop;

  return learned;
end;
$$;

revoke all on function private.learn_course_aliases_from_import_metadata(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- Enrich future corrected imports and learn aliases in the same transaction.
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
  learned_alias_count integer := 0;
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
    learned_alias_count := private.learn_course_aliases_from_import_metadata(
      actor_id,
      import_id,
      enriched_metadata
    );
    enriched_metadata := enriched_metadata || jsonb_build_object(
      'learned_course_alias_count', learned_alias_count
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

-- Backfill only the latest detailed correction event for each import. The helper
-- is deliberately conservative and skips any row that cannot map to exactly one
-- final canonical course.
do $$
declare
  correction record;
begin
  for correction in
    select distinct on (log.target_id)
           log.actor_user_id,
           log.target_id::uuid as import_id,
           log.metadata
    from public.event_logs log
    where log.log_category = 'import'
      and log.event_type in ('schedule_import_review_completed', 'schedule_import_corrected')
      and log.actor_user_id is not null
      and log.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and jsonb_typeof(log.metadata -> 'corrected_to') = 'array'
    order by log.target_id, log.created_at desc, log.id desc
  loop
    perform private.learn_course_aliases_from_import_metadata(
      correction.actor_user_id,
      correction.import_id,
      correction.metadata
    );
  end loop;
end;
$$;
