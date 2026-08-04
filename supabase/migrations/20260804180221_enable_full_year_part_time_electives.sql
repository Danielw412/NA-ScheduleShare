-- These approved half-credit electives can be scheduled either as a semester
-- course meeting every day or as a full-year course meeting on one A/B day.
do $$
declare
  updated_count integer;
begin
  update public.course_names
  set term_policy = 'sectioned_attendance'
  where normalized_name in (
    'journalism - naeye news',
    'executive functioning',
    '9th grade chorus',
    '10th grade chorus'
  );

  get diagnostics updated_count = row_count;
  if updated_count <> 4 then
    raise exception 'Expected to update 4 full-year/part-time electives, updated %', updated_count;
  end if;
end;
$$;
