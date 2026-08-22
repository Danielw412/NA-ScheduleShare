-- Avoid PL/pgSQL variable/column ambiguity in the calendar assignment upsert.
-- The original migration is already applied remotely, so preserve its history
-- and correct the function in this follow-up migration.

create or replace function private.admin_bulk_assign_school_days(
  school_dates date[], campuses text[], next_day_type text, next_no_school boolean, next_schedule_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  settings private.school_year_settings%rowtype;
  schedule private.bell_schedule_definitions%rowtype;
  target_school_date date;
  campus_name text;
  changed_count integer := 0;
begin
  if school_dates is null or cardinality(school_dates) < 1 or cardinality(school_dates) > 62
    or campuses is null or cardinality(campuses) < 1 or cardinality(campuses) > 2 then
    raise exception 'school_day_bulk_assignment_out_of_bounds' using errcode = '22023';
  end if;
  if next_day_type is not null and next_day_type not in ('A', 'B') then
    raise exception 'invalid_school_day_type' using errcode = '22023';
  end if;
  if next_no_school and next_schedule_id is not null then
    raise exception 'no_school_cannot_have_schedule' using errcode = '22023';
  end if;
  if not next_no_school and next_schedule_id is null then
    raise exception 'schedule_required_for_school_day' using errcode = '22023';
  end if;
  select * into settings from private.school_year_settings where singleton;
  if next_schedule_id is not null then
    select * into schedule from private.bell_schedule_definitions
    where id = next_schedule_id and archived_at is null;
    if not found then raise exception 'bell_schedule_not_found' using errcode = 'P0002'; end if;
  end if;
  foreach target_school_date in array school_dates loop
    if target_school_date < settings.school_year_start or target_school_date > settings.school_year_end then
      raise exception 'school_day_outside_configured_year' using errcode = '22023';
    end if;
    foreach campus_name in array campuses loop
      campus_name := upper(campus_name);
      if campus_name not in ('NAI', 'NASH') then
        raise exception 'invalid_school_day_campus' using errcode = '22023';
      end if;
      if next_schedule_id is not null and schedule.campus_scope not in ('BOTH', campus_name) then
        raise exception 'bell_schedule_campus_mismatch' using errcode = '22023';
      end if;
      insert into private.school_day_assignments (
        school_date, campus, day_type, no_school, schedule_id, source, manual_locked, evidence, updated_by
      ) values (
        target_school_date, campus_name, next_day_type, next_no_school, next_schedule_id, 'manual', true,
        'Assigned manually in ScheduleShare', actor_id
      )
      on conflict on constraint school_day_assignments_pkey do update
      set day_type = excluded.day_type,
          no_school = excluded.no_school,
          schedule_id = excluded.schedule_id,
          source = 'manual',
          manual_locked = true,
          evidence = excluded.evidence,
          sync_run_id = null,
          updated_by = actor_id,
          updated_at = clock_timestamp();
      changed_count := changed_count + 1;
    end loop;
  end loop;
  perform private.write_event_log(
    'admin', 'school_days_assigned', actor_id, null, 'school_calendar', null, 'succeeded',
    jsonb_build_object('date_count', cardinality(school_dates), 'campuses', campuses, 'row_count', changed_count)
  );
  return changed_count;
end;
$$;

comment on function private.admin_bulk_assign_school_days(date[], text[], text, boolean, uuid) is
  'Bulk-assigns and manually locks bounded school dates without PL/pgSQL column-name ambiguity.';

notify pgrst, 'reload schema';
