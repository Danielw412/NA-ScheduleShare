begin;
select plan(8);

select has_function(
  'public',
  'record_schedule_import_backend_event',
  array['uuid', 'uuid', 'text', 'jsonb'],
  'the Edge Function has a service-only backend audit RPC'
);

select has_function(
  'private',
  'current_schedule_log_snapshot',
  array['uuid'],
  'the log system can snapshot the final saved schedule'
);

select lives_ok(
  $$
    select private.record_schedule_import_backend_event(
      '10000000-0000-4000-8000-000000000002'::uuid,
      '91000000-0000-4000-8000-000000000001'::uuid,
      'failed',
      jsonb_build_object(
        'failure_stage', 'ai_response_validation',
        'what_was_read', jsonb_build_object(
          'ai_attempts', jsonb_build_array(jsonb_build_object(
            'attempt', 1,
            'parsed_output', jsonb_build_object(
              'schedule', false,
              'issue', 'The period column is cropped out.',
              'rows', '[]'::jsonb
            )
          ))
        ),
        'what_was_tried', jsonb_build_object(
          'configuration', jsonb_build_object('model_id', 'gemini-3.5-flash-lite'),
          'image_metadata', jsonb_build_array(jsonb_build_object(
            'index', 1,
            'mime_type', 'image/png',
            'byte_size', 100
          ))
        ),
        'failure_cause', jsonb_build_object(
          'code', 'schedule_not_detected',
          'message', 'The screenshot could not be used: The period column is cropped out.'
        )
      )
    )
  $$,
  'a backend importer failure can be recorded with detailed context'
);

select is(
  (
    select log.metadata #>> '{failure_cause,code}'
    from public.event_logs log
    where log.event_type = 'schedule_import_backend_failed'
      and log.target_id = '91000000-0000-4000-8000-000000000001'
    order by log.created_at desc
    limit 1
  ),
  'schedule_not_detected',
  'the failure log preserves the exact failure code'
);

select is(
  (
    select log.metadata #>> '{what_was_read,ai_attempts,0,parsed_output,issue}'
    from public.event_logs log
    where log.event_type = 'schedule_import_backend_failed'
      and log.target_id = '91000000-0000-4000-8000-000000000001'
    order by log.created_at desc
    limit 1
  ),
  'The period column is cropped out.',
  'the failure log preserves what the AI read from the screenshot'
);

select lives_ok(
  $$
    select private.record_schedule_import_backend_event(
      '10000000-0000-4000-8000-000000000002'::uuid,
      '91000000-0000-4000-8000-000000000002'::uuid,
      'succeeded',
      jsonb_build_object(
        'what_was_read', jsonb_build_object(
          'selected_review_rows', jsonb_build_array(jsonb_build_object(
            'source_course_name', 'AP Biology (CHS)',
            'teacher_last_name', 'Spak',
            'term', 'full_year',
            'meeting_slots', jsonb_build_array(
              jsonb_build_object('day_type', 'A', 'period_number', 1),
              jsonb_build_object('day_type', 'B', 'period_number', 1)
            )
          ))
        ),
        'what_was_tried', jsonb_build_object('ai_attempt_count', 1),
        'result_summary', jsonb_build_object('row_count', 1)
      )
    )
  $$,
  'a successful backend read is available for later correction comparison'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$
    select public.record_schedule_import_event(
      'schedule_import_corrected',
      '91000000-0000-4000-8000-000000000002'::uuid,
      'succeeded',
      jsonb_build_object('classes_found', 1, 'classes_matched', 1)
    )
  $$,
  'a correction event is enriched after the atomic schedule replacement'
);

reset role;

select ok(
  (
    select
      jsonb_typeof(log.metadata -> 'original_importer_read') = 'object'
      and jsonb_typeof(log.metadata -> 'corrected_to') = 'array'
      and (log.metadata ->> 'correction_recorded_after_atomic_replace')::boolean
    from public.event_logs log
    where log.event_type = 'schedule_import_corrected'
      and log.target_id = '91000000-0000-4000-8000-000000000002'
    order by log.created_at desc
    limit 1
  ),
  'the correction log contains both the original read and what it was corrected to'
);

select * from finish();
rollback;
