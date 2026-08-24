-- Anonymous visitors need the same real bell/calendar data as signed-in
-- students, but never receive enrollment or profile data. Keep the source
-- tables private and expose only a bounded, campus-scoped JSON window.

create or replace function private.get_bell_schedule_window(
  start_date date,
  requested_days integer,
  requested_campus text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  campus_key text := upper(trim(coalesce(requested_campus, '')));
  settings private.school_year_settings%rowtype;
begin
  if start_date is null or requested_days is null or requested_days < 1 or requested_days > 21 then
    raise exception 'bell_schedule_window_out_of_bounds' using errcode = '22023';
  end if;
  if campus_key not in ('NAI', 'NASH') then
    raise exception 'invalid_bell_schedule_campus' using errcode = '22023';
  end if;

  select * into settings from private.school_year_settings where singleton;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', day.school_date,
      'campus', campus_key,
      'day_type', assignment.day_type,
      'semester', case when day.school_date >= settings.semester_2_start then 'semester_2' else 'semester_1' end,
      'no_school', case
        when day.school_date < settings.school_year_start or day.school_date > settings.school_year_end then true
        when extract(isodow from day.school_date) in (6, 7) then true
        else coalesce(assignment.no_school, false)
      end,
      'source', coalesce(assignment.source, 'default'),
      'schedule', case
        when day.school_date < settings.school_year_start or day.school_date > settings.school_year_end then null
        when extract(isodow from day.school_date) in (6, 7) then null
        when assignment.no_school then null
        else private.bell_schedule_json(coalesce(assignment.schedule_id, settings.default_schedule_id))
      end
    ) order by day.school_date), '[]'::jsonb)
    from (
      select generate_series(start_date, start_date + requested_days - 1, interval '1 day')::date as school_date
    ) day
    left join private.school_day_assignments assignment
      on assignment.school_date = day.school_date and assignment.campus = campus_key
  );
end;
$$;

create or replace function private.get_my_bell_schedule_window(start_date date, requested_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_grade smallint;
  actor_campus text;
begin
  if not private.is_active_user(actor_id) then
    raise exception 'active_account_required' using errcode = '42501';
  end if;
  select profile.grade into actor_grade from public.profiles profile where profile.id = actor_id;
  if actor_grade not in (9, 10, 11, 12) then
    raise exception 'profile_grade_required' using errcode = '22023';
  end if;
  actor_campus := case when actor_grade in (9, 10) then 'NAI' else 'NASH' end;
  return private.get_bell_schedule_window(start_date, requested_days, actor_campus);
end;
$$;

create or replace function public.get_guest_bell_schedule_window(
  p_start_date date,
  p_days integer,
  p_campus text default 'NASH'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.get_bell_schedule_window(p_start_date, p_days, p_campus);
$$;

revoke all on function private.get_bell_schedule_window(date, integer, text) from public, anon, authenticated;
revoke all on function public.get_guest_bell_schedule_window(date, integer, text) from public, anon, authenticated;
grant execute on function public.get_guest_bell_schedule_window(date, integer, text) to anon, authenticated;

comment on function public.get_guest_bell_schedule_window(date, integer, text) is
  'Returns at most 21 days of public bell/calendar data for one validated campus; contains no student or enrollment data.';

notify pgrst, 'reload schema';
