-- Complete the meeting-day, reporting, and administrative class-management APIs.
-- Public functions remain thin invoker wrappers; privileged implementations stay private
-- and derive the actor from auth.uid().

alter table public.class_meeting_slots
  drop constraint if exists class_meeting_slots_period_number_check;
alter table public.class_meeting_slots
  add constraint class_meeting_slots_period_number_check check (period_number between 1 and 9);

create or replace function private.assert_valid_meeting_slots(
  input_meeting_slots jsonb,
  input_is_double boolean
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  meeting_day text;
  day_period_count integer;
  first_period integer;
  last_period integer;
begin
  if input_is_double is null then
    raise exception 'double_period_selection_required' using errcode = '23514';
  end if;
  if jsonb_typeof(input_meeting_slots) <> 'array' or jsonb_array_length(input_meeting_slots) = 0 then
    raise exception 'meeting_slots_required' using errcode = '23514';
  end if;
  if jsonb_array_length(input_meeting_slots) > 4 then
    raise exception 'too_many_meeting_slots' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(input_meeting_slots) item
    where jsonb_typeof(item) <> 'object'
       or not (item ? 'day_type')
       or not (item ? 'period_number')
  ) then
    raise exception 'invalid_meeting_slot' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
    where requested.day_type not in ('A', 'B')
       or requested.period_number not between 1 and 9
       or requested.day_type is null
       or requested.period_number is null
  ) then
    raise exception 'invalid_meeting_slot' using errcode = '23514';
  end if;
  if (
    select count(*)
    from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
  ) <> (
    select count(distinct requested.day_type || ':' || requested.period_number::text)
    from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
  ) then
    raise exception 'duplicate_meeting_slot' using errcode = '23514';
  end if;

  for meeting_day in
    select distinct requested.day_type
    from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
  loop
    select count(*), min(requested.period_number), max(requested.period_number)
      into day_period_count, first_period, last_period
    from jsonb_to_recordset(input_meeting_slots) requested(day_type text, period_number integer)
    where requested.day_type = meeting_day;

    if input_is_double and (day_period_count <> 2 or last_period <> first_period + 1) then
      raise exception 'double_period_requires_two_consecutive_slots_per_day' using errcode = '23514';
    end if;
    if not input_is_double and day_period_count <> 1 then
      raise exception 'single_period_requires_one_slot_per_day' using errcode = '23514';
    end if;
  end loop;
end;
$$;

create or replace function private.create_class_and_enroll(
  input_class_name text,
  input_teacher_name text,
  input_term public.academic_term,
  input_is_double boolean,
  input_meeting_slots jsonb,
  confirmed_no_match boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  new_class_id uuid;
  normalized_class text := private.normalize_search(input_class_name);
  normalized_teacher text := private.normalize_search(input_teacher_name);
begin
  actor_id := private.require_active_user();
  perform private.consume_rate_limit(actor_id, 'class_create', 8, interval '1 hour');
  if not confirmed_no_match then
    raise exception 'duplicate_confirmation_required' using errcode = '23514';
  end if;
  if char_length(trim(input_class_name)) < 2 or char_length(trim(input_teacher_name)) < 2 then
    raise exception 'class_and_teacher_required' using errcode = '23514';
  end if;
  perform private.assert_valid_meeting_slots(input_meeting_slots, input_is_double);

  if exists (
    select 1
    from public.classes c
    where c.status = 'active'
      and c.normalized_class_name = normalized_class
      and c.normalized_teacher_name = normalized_teacher
      and c.default_academic_term = input_term
      and exists (
        select 1
        from public.class_meeting_slots s
        join jsonb_to_recordset(input_meeting_slots) requested(day_type public.day_type, period_number smallint)
          on requested.day_type = s.day_type and requested.period_number = s.period_number
        where s.class_id = c.id
      )
  ) then
    raise exception 'exact_duplicate_class_exists' using errcode = '23505';
  end if;

  insert into public.classes (
    class_name, teacher_name, normalized_class_name, normalized_teacher_name,
    default_academic_term, is_double_period, created_by
  ) values (
    input_class_name, input_teacher_name, normalized_class, normalized_teacher,
    input_term, input_is_double, actor_id
  ) returning id into new_class_id;

  insert into public.class_meeting_slots (class_id, day_type, period_number)
  select new_class_id, requested.day_type, requested.period_number
  from jsonb_to_recordset(input_meeting_slots) requested(day_type public.day_type, period_number smallint);

  return private.add_enrollment_for_student(actor_id, new_class_id, input_term, actor_id, 'class_added', false);
end;
$$;

create or replace function private.search_reportable_users(
  name_query text default '',
  target_user_id uuid default null,
  result_limit integer default 20
)
returns table (
  student_id uuid,
  full_name text,
  grade smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  normalized_query text := private.normalize_search(name_query);
begin
  actor_id := private.require_active_user();
  return query
  select p.id, p.full_name, p.grade
  from public.profiles p
  where p.id <> actor_id
    and p.onboarding_completed
    and private.is_active_user(p.id)
    and (target_user_id is null or p.id = target_user_id)
    and (target_user_id is not null or normalized_query = '' or p.normalized_name like '%' || normalized_query || '%')
    and (
      private.is_admin(actor_id)
      or p.privacy_setting = 'school'
      or private.shares_active_class(actor_id, p.id)
    )
  order by p.full_name
  limit least(greatest(result_limit, 1), 50);
end;
$$;

create or replace function public.search_reportable_users(
  p_query text default '',
  p_user_id uuid default null,
  p_limit integer default 20
)
returns table (
  student_id uuid,
  full_name text,
  grade smallint
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.search_reportable_users(p_query, p_user_id, p_limit); $$;

create or replace function private.create_report(
  target_reason public.report_reason,
  target_explanation text default null,
  target_user_id uuid default null,
  target_class_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  report_id uuid;
begin
  actor_id := private.require_active_user();
  perform private.consume_rate_limit(actor_id, 'report_create', 10, interval '1 day');
  if char_length(coalesce(target_explanation, '')) > 2000 then
    raise exception 'report_explanation_too_long' using errcode = '22001';
  end if;
  if target_user_id is not null and target_class_id is not null then
    raise exception 'single_report_target_required' using errcode = '23514';
  end if;
  if target_user_id = actor_id then
    raise exception 'cannot_report_self' using errcode = '23514';
  end if;
  if target_user_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = target_user_id
      and p.onboarding_completed
      and private.is_active_user(p.id)
      and (
        private.is_admin(actor_id)
        or p.privacy_setting = 'school'
        or private.shares_active_class(actor_id, p.id)
      )
  ) then
    raise exception 'reported_user_not_found' using errcode = 'P0002';
  end if;
  if target_class_id is not null and not exists (
    select 1
    from public.classes c
    where c.id = target_class_id
      and c.status = 'active'
      and (private.has_active_enrollment(actor_id) or private.is_admin(actor_id))
  ) then
    raise exception 'reported_class_not_found' using errcode = 'P0002';
  end if;

  insert into public.reports (reporter_id, reported_user_id, reported_class_id, reason_category, explanation)
  values (actor_id, target_user_id, target_class_id, target_reason, nullif(trim(target_explanation), ''))
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function private.admin_list_reports()
returns table (
  report_id uuid,
  reason_category public.report_reason,
  explanation text,
  status public.report_status,
  reporter_id uuid,
  reporter_name text,
  reported_user_id uuid,
  reported_user_name text,
  reported_class_id uuid,
  reported_class_name text,
  assigned_admin_id uuid,
  assigned_admin_name text,
  resolution_notes text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select r.id,
         r.reason_category,
         r.explanation,
         r.status,
         r.reporter_id,
         reporter.full_name,
         r.reported_user_id,
         reported_user.full_name,
         r.reported_class_id,
         reported_class.class_name,
         r.assigned_admin_id,
         assigned_admin.full_name,
         r.resolution_notes,
         r.created_at,
         r.resolved_at
  from public.reports r
  left join public.profiles reporter on reporter.id = r.reporter_id
  left join public.profiles reported_user on reported_user.id = r.reported_user_id
  left join public.classes reported_class on reported_class.id = r.reported_class_id
  left join public.profiles assigned_admin on assigned_admin.id = r.assigned_admin_id
  order by r.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_list_reports()
returns table (
  report_id uuid,
  reason_category public.report_reason,
  explanation text,
  status public.report_status,
  reporter_id uuid,
  reporter_name text,
  reported_user_id uuid,
  reported_user_name text,
  reported_class_id uuid,
  reported_class_name text,
  assigned_admin_id uuid,
  assigned_admin_name text,
  resolution_notes text,
  created_at timestamptz,
  resolved_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_list_reports(); $$;

create or replace function private.admin_list_classes()
returns table (
  class_id uuid,
  class_name text,
  teacher_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  status public.class_status,
  meeting_slots jsonb,
  enrollment_count bigint,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select c.id,
         c.class_name,
         c.teacher_name,
         c.default_academic_term,
         c.is_double_period,
         c.status,
         coalesce(
           jsonb_agg(
             jsonb_build_object('day_type', s.day_type, 'period_number', s.period_number)
             order by s.day_type, s.period_number
           ) filter (where s.id is not null),
           '[]'::jsonb
         ),
         count(distinct e.id) filter (where e.active),
         c.created_by,
         c.created_at,
         c.updated_at
  from public.classes c
  left join public.class_meeting_slots s on s.class_id = c.id
  left join public.class_enrollments e on e.class_id = c.id
  group by c.id
  order by c.class_name, c.teacher_name;
end;
$$;

create or replace function public.admin_list_classes()
returns table (
  class_id uuid,
  class_name text,
  teacher_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  status public.class_status,
  meeting_slots jsonb,
  enrollment_count bigint,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_list_classes(); $$;

create or replace function private.admin_update_class(
  target_class_id uuid,
  next_class_name text,
  next_teacher_name text,
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
begin
  actor_id := private.require_admin();
  select c.status,
         jsonb_build_object(
           'class', to_jsonb(c),
           'meeting_slots', coalesce((
             select jsonb_agg(to_jsonb(s) order by s.day_type, s.period_number)
             from public.class_meeting_slots s
             where s.class_id = c.id
           ), '[]'::jsonb)
         )
    into current_status, before_data
  from public.classes c
  where c.id = target_class_id
  for update;
  if not found then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;
  if current_status <> 'active' then
    raise exception 'only_active_classes_can_be_edited' using errcode = '23514';
  end if;
  if char_length(trim(coalesce(next_class_name, ''))) < 2
     or char_length(trim(coalesce(next_teacher_name, ''))) < 2 then
    raise exception 'class_and_teacher_required' using errcode = '23514';
  end if;
  if char_length(trim(coalesce(action_reason, ''))) < 3 then
    raise exception 'class_edit_reason_required' using errcode = '23514';
  end if;
  perform private.assert_valid_meeting_slots(next_slots, next_is_double);

  if exists (
    select 1
    from public.class_enrollments edited_enrollment
    join public.class_enrollments other_enrollment
      on other_enrollment.student_id = edited_enrollment.student_id
     and other_enrollment.active
     and other_enrollment.class_id <> target_class_id
     and private.terms_overlap(edited_enrollment.academic_term, other_enrollment.academic_term)
    join public.class_meeting_slots other_slot on other_slot.class_id = other_enrollment.class_id
    join jsonb_to_recordset(next_slots) requested(day_type public.day_type, period_number smallint)
      on requested.day_type = other_slot.day_type
     and requested.period_number = other_slot.period_number
    where edited_enrollment.class_id = target_class_id
      and edited_enrollment.active
      and not exists (
        select 1
        from public.class_meeting_slots current_slot
        where current_slot.class_id = target_class_id
          and current_slot.day_type = requested.day_type
          and current_slot.period_number = requested.period_number
      )
  ) then
    raise exception 'class_edit_schedule_conflict' using errcode = '23514';
  end if;

  update public.classes
  set class_name = next_class_name,
      teacher_name = next_teacher_name,
      default_academic_term = next_term,
      is_double_period = next_is_double
  where id = target_class_id;

  delete from public.class_meeting_slots where class_id = target_class_id;
  insert into public.class_meeting_slots (class_id, day_type, period_number)
  select target_class_id, requested.day_type, requested.period_number
  from jsonb_to_recordset(next_slots) requested(day_type public.day_type, period_number smallint);

  select jsonb_build_object(
           'class', to_jsonb(c),
           'meeting_slots', coalesce((
             select jsonb_agg(to_jsonb(s) order by s.day_type, s.period_number)
             from public.class_meeting_slots s
             where s.class_id = c.id
           ), '[]'::jsonb)
         )
    into after_data
  from public.classes c
  where c.id = target_class_id;

  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id, 'meeting_slots_changed', before_data, after_data, actor_id
  from public.class_enrollments e
  where e.class_id = target_class_id and e.active;

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

revoke all on function private.assert_valid_meeting_slots(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.search_reportable_users(text, uuid, integer) from public, anon;
revoke all on function private.admin_list_reports() from public, anon;
revoke all on function private.admin_list_classes() from public, anon;

revoke all on function public.search_reportable_users(text, uuid, integer) from public, anon;
revoke all on function public.admin_list_reports() from public, anon;
revoke all on function public.admin_list_classes() from public, anon;

grant execute on function private.search_reportable_users(text, uuid, integer) to authenticated;
grant execute on function private.admin_list_reports() to authenticated;
grant execute on function private.admin_list_classes() to authenticated;

grant execute on function public.search_reportable_users(text, uuid, integer) to authenticated;
grant execute on function public.admin_list_reports() to authenticated;
grant execute on function public.admin_list_classes() to authenticated;

comment on function public.search_reportable_users(text, uuid, integer) is
  'Returns active users whose names are already visible to the caller; IDs are for internal report targeting only.';
comment on function public.admin_list_reports() is
  'Administrator-only report details including the submitted explanation and human-readable actor/target names.';
comment on function public.admin_update_class(uuid, text, text, public.academic_term, boolean, jsonb, text) is
  'Atomically edits an active shared class in place, rejects schedule conflicts, and records history and audit rows.';
