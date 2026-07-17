-- The atomic schedule-import RPC inferred whether a class was double-period only
-- after validating the submitted slots. Passing false to the validator caused any
-- imported class with two periods on the same day to fail with
-- normal_class_multiple_periods before it could be classified correctly.

do $$
declare
  function_definition text;
  old_validation constant text :=
    'perform private.assert_valid_meeting_slots(requested_slots, false);';
  corrected_validation constant text :=
    'perform private.assert_valid_meeting_slots(requested_slots, private.meeting_slots_have_multiple_periods(requested_slots));';
begin
  select pg_get_functiondef('private.replace_schedule_from_import(jsonb)'::regprocedure)
  into function_definition;

  if function_definition is null or strpos(function_definition, old_validation) = 0 then
    raise exception 'schedule_import_validation_patch_target_not_found';
  end if;

  function_definition := replace(
    function_definition,
    old_validation,
    corrected_validation
  );

  execute function_definition;
end;
$$;

comment on function public.replace_schedule_from_import(jsonb) is
  'Atomically replaces the authenticated student schedule from reviewed import rows, supports validated single- and double-period classes, and rejects conflicts only within the replacement schedule.';
