-- Refine protected activity data, remove exact duplicate event records, and
-- enforce shared class-term rules at the database boundary.

drop function if exists public.admin_list_users(text, smallint, text);
drop function if exists private.admin_list_users(text, smallint, text);

create function private.admin_list_users(
  search_query text default '',
  grade_filter smallint default null,
  status_filter text default null
)
returns table (
  user_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  status text,
  is_admin boolean,
  created_at timestamptz,
  last_login_at timestamptz,
  last_active_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select
    profile.id,
    profile.full_name,
    profile.grade,
    profile.privacy_setting,
    case
      when moderation.deleted_at is not null then 'deleted'
      when moderation.suspended_at is not null then 'suspended'
      else 'active'
    end,
    exists (
      select 1 from private.user_roles role_record
      where role_record.user_id = profile.id and role_record.role = 'administrator'
    ),
    profile.created_at,
    profile.last_login_at,
    profile.last_active_at
  from public.profiles profile
  join private.account_moderation moderation on moderation.user_id = profile.id
  where (search_query = '' or profile.normalized_name like '%' || private.normalize_search(search_query) || '%')
    and (grade_filter is null or profile.grade = grade_filter)
    and (
      status_filter is null or status_filter = ''
      or status_filter = case
        when moderation.deleted_at is not null then 'deleted'
        when moderation.suspended_at is not null then 'suspended'
        else 'active'
      end
    )
  order by profile.full_name
  limit 500;
end;
$$;

create function public.admin_list_users(
  p_query text default '',
  p_grade smallint default null,
  p_status text default null
)
returns table (
  user_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  status text,
  is_admin boolean,
  created_at timestamptz,
  last_login_at timestamptz,
  last_active_at timestamptz
)
language sql
stable
set search_path = ''
as $$ select * from private.admin_list_users(p_query, p_grade, p_status); $$;

revoke all on function private.admin_list_users(text, smallint, text) from public, anon;
revoke all on function public.admin_list_users(text, smallint, text) from public, anon;
grant execute on function private.admin_list_users(text, smallint, text) to authenticated;
grant execute on function public.admin_list_users(text, smallint, text) to authenticated;

create or replace function private.record_authenticated_event(event_name text, event_result text, event_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if event_name not in (
    'login_succeeded', 'login_blocked_suspended', 'logout_all_devices', 'password_reset_completed', 'password_reset_failed',
    'profile_picture_changed', 'profile_picture_removed', 'profile_picture_rejected',
    'schedule_cleared', 'schedule_replaced', 'authorization_denied', 'admin_action_denied'
  ) then raise exception 'unsupported_authenticated_event' using errcode = '22023'; end if;
  perform private.write_event_log(
    case when event_name like 'profile_%' or event_name like 'schedule_%' then 'audit' else 'security' end,
    event_name, actor_id, actor_id, 'user', actor_id::text, nullif(event_result, ''), event_metadata
  );
  if event_name = 'login_succeeded' then
    update public.profiles set last_login_at = now(), last_active_at = now() where id = actor_id;
  elsif event_name in ('profile_picture_changed', 'profile_picture_removed') then
    update public.profiles set updated_at = clock_timestamp() where id = actor_id;
  end if;
end;
$$;

create or replace function private.admin_record_profile_picture_removed(target_user_id uuid, action_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := private.require_admin();
begin
  update public.profiles set updated_at = clock_timestamp() where id = target_user_id;
  if not found then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  perform private.write_audit(
    actor_id, 'profile_picture_removed', 'user', target_user_id::text,
    jsonb_build_object('profile_picture', 'present_or_unknown'),
    jsonb_build_object('profile_picture', 'removed'), action_reason
  );
  perform private.write_event_log(
    'audit', 'profile_picture_removed', actor_id, target_user_id, 'user', target_user_id::text,
    'succeeded', jsonb_build_object('removed_by_administrator', true)
  );
end;
$$;

create or replace function private.is_term_flexible_course(normalized_course_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    normalized_course_name ~ '(^|[ -])gym([ -]|$)'
    or normalized_course_name ~ '^study hall( -|$)'
    or normalized_course_name = 'wellness for life',
    false
  );
$$;

create or replace function private.is_lunch_course(normalized_course_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select coalesce(normalized_course_name ~ '^lunch( -|$)', false); $$;

create or replace function private.assert_enrollment_term_allowed(target_class_id uuid, requested_term public.academic_term)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  class_term public.academic_term;
  normalized_course_name text;
begin
  select class_record.default_academic_term, course_name.normalized_name
  into class_term, normalized_course_name
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = target_class_id;
  if not found then raise exception 'class_not_found' using errcode = 'P0002'; end if;
  if private.is_lunch_course(normalized_course_name) and requested_term = 'full_year' then
    raise exception 'lunch_requires_semester' using errcode = '23514';
  end if;
  if not private.is_term_flexible_course(normalized_course_name) and requested_term <> class_term then
    raise exception 'class_term_locked' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.enforce_class_term_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare normalized_course_name text;
begin
  if tg_op = 'UPDATE' and old.default_academic_term is distinct from new.default_academic_term then
    raise exception 'class_term_locked' using errcode = '23514';
  end if;
  select course_name.normalized_name into normalized_course_name
  from public.course_names course_name where course_name.id = new.course_name_id;
  if private.is_lunch_course(normalized_course_name) and new.default_academic_term = 'full_year' then
    raise exception 'lunch_requires_semester' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists classes_enforce_term_rules on public.classes;
create trigger classes_enforce_term_rules
before insert or update of course_name_id, default_academic_term on public.classes
for each row execute function private.enforce_class_term_rules();

create or replace function private.enforce_enrollment_term_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_enrollment_term_allowed(new.class_id, new.academic_term);
  return new;
end;
$$;

drop trigger if exists class_enrollments_enforce_term_rules on public.class_enrollments;
create trigger class_enrollments_enforce_term_rules
before insert or update of class_id, academic_term on public.class_enrollments
for each row execute function private.enforce_enrollment_term_rules();

revoke all on function private.is_term_flexible_course(text) from public, anon, authenticated;
revoke all on function private.is_lunch_course(text) from public, anon, authenticated;
revoke all on function private.assert_enrollment_term_allowed(uuid, public.academic_term) from public, anon, authenticated;
revoke all on function private.enforce_class_term_rules() from public, anon, authenticated;
revoke all on function private.enforce_enrollment_term_rules() from public, anon, authenticated;

create or replace function private.update_enrollment_term(target_enrollment_id uuid, next_term public.academic_term)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing public.class_enrollments%rowtype;
  course_name_value text;
begin
  actor_id := private.require_active_user();
  select * into existing from public.class_enrollments
  where id = target_enrollment_id and student_id = actor_id and active for update;
  if not found then raise exception 'active_enrollment_not_found' using errcode = 'P0002'; end if;
  if existing.academic_term = next_term then return; end if;
  perform private.assert_enrollment_term_allowed(existing.class_id, next_term);
  perform private.assert_no_schedule_conflict(actor_id, existing.class_id, next_term, existing.id, false);
  select course_name.name into course_name_value
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = existing.class_id;
  update public.class_enrollments set academic_term = next_term where id = existing.id;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  values (
    actor_id, 'term_changed',
    jsonb_build_object('enrollment_id', existing.id, 'class_id', existing.class_id, 'course_name', course_name_value, 'academic_term', existing.academic_term),
    jsonb_build_object('enrollment_id', existing.id, 'class_id', existing.class_id, 'course_name', course_name_value, 'academic_term', next_term),
    actor_id
  );
end;
$$;

create or replace function private.capture_enrollment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  enrollment public.class_enrollments%rowtype;
  actor_id uuid := auth.uid();
  event_name text;
  class_metadata jsonb;
begin
  if tg_op = 'DELETE' then enrollment := old; else enrollment := new; end if;
  if tg_op = 'INSERT' and new.active then event_name := 'user_joined_class';
  elsif tg_op = 'DELETE' and old.active then event_name := case when actor_id = old.student_id then 'user_left_class' else 'user_removed_from_class' end;
  elsif tg_op = 'UPDATE' and old.active and not new.active then event_name := case when actor_id = new.student_id then 'user_left_class' else 'user_removed_from_class' end;
  elsif tg_op = 'UPDATE' and not old.active and new.active then event_name := 'user_joined_class';
  elsif tg_op = 'DELETE' then return old;
  else return new; end if;

  select jsonb_build_object(
    'class_id', class_record.id,
    'course_name_id', course_name.id,
    'course_name', course_name.name,
    'teacher_last_name', class_record.teacher_last_name,
    'class_default_academic_term', class_record.default_academic_term,
    'enrollment_academic_term', enrollment.academic_term,
    'meeting_slots', coalesce((
      select jsonb_agg(
        jsonb_build_object('day_type', slot.day_type, 'period_number', slot.period_number)
        order by slot.day_type, slot.period_number
      )
      from public.class_meeting_slots slot where slot.class_id = class_record.id
    ), '[]'::jsonb)
  ) into class_metadata
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  where class_record.id = enrollment.class_id;

  perform private.write_event_log(
    'audit', event_name, actor_id, enrollment.student_id, 'class', enrollment.class_id::text,
    'succeeded', coalesce(class_metadata, '{}'::jsonb) || jsonb_build_object('enrollment_id', enrollment.id)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.capture_schedule_history_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mapped_event text;
  class_id text := coalesce(new.new_value ->> 'class_id', new.previous_value ->> 'class_id');
begin
  if new.action::text = 'class_added' then
    if not exists (
      select 1 from public.schedule_change_history earlier
      where earlier.student_id = new.student_id and earlier.id <> new.id and earlier.created_at <= new.created_at
    ) then
      perform private.write_event_log('audit', 'schedule_created', new.changed_by, new.student_id, 'schedule', new.student_id::text, 'succeeded', '{}'::jsonb);
    end if;
    return new;
  end if;
  if new.action::text = 'class_removed' then return new; end if;
  mapped_event := case new.action::text
    when 'class_replaced' then 'schedule_class_changed'
    when 'term_changed' then 'schedule_term_changed'
    when 'meeting_slots_changed' then 'schedule_period_changed'
    else 'schedule_manually_edited'
  end;
  perform private.write_event_log(
    'audit', mapped_event, new.changed_by, new.student_id, 'class', class_id,
    'succeeded', jsonb_build_object('old_value', new.previous_value, 'new_value', new.new_value)
  );
  return new;
end;
$$;

create or replace function private.capture_access_request_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  actor_id uuid := auth.uid();
  subject_id uuid;
  event_result text;
begin
  if tg_op = 'INSERT' then
    event_name := 'schedule_access_requested';
    subject_id := new.owner_id;
    event_result := 'pending';
    insert into private.user_activity_metrics (user_id, schedule_access_request_count)
    values (new.requester_id, 1)
    on conflict (user_id) do update
      set schedule_access_request_count = private.user_activity_metrics.schedule_access_request_count + 1,
          updated_at = now();
  elsif old.status is distinct from new.status then
    subject_id := new.requester_id;
    event_name := case new.status::text
      when 'approved' then 'schedule_access_allowed'
      when 'declined' then 'schedule_access_denied'
      else 'schedule_access_request_cancelled'
    end;
    event_result := case new.status::text
      when 'approved' then 'allowed'
      when 'declined' then 'denied'
      else 'cancelled'
    end;
  else return new; end if;
  perform private.write_event_log(
    'audit', event_name, actor_id, subject_id, 'schedule_access_request', new.id::text,
    event_result,
    jsonb_build_object(
      'request_id', new.id,
      'requester_id', new.requester_id,
      'schedule_owner_id', new.owner_id,
      'access_type', 'full_schedule',
      'allowed', case when new.status::text = 'approved' then true when new.status::text = 'declined' then false else null end,
      'decided_by', case when new.status::text in ('approved', 'declined') then actor_id else null end
    )
  );
  return new;
end;
$$;

drop trigger if exists class_meeting_slots_capture_event on public.class_meeting_slots;
drop function if exists private.capture_meeting_slot_event();

do $$
declare
  removed_schedule_duplicates bigint;
  removed_slot_duplicates bigint;
begin
  with deleted as (
    delete from public.event_logs
    where event_type in ('schedule_class_added', 'schedule_class_removed')
    returning 1
  ) select count(*) into removed_schedule_duplicates from deleted;

  with deleted as (
    delete from public.event_logs
    where event_type = 'class_updated'
      and metadata ->> 'operation' in ('insert', 'delete', 'update')
      and metadata -> 'changed_fields' @> '["meeting_slots"]'::jsonb
    returning 1
  ) select count(*) into removed_slot_duplicates from deleted;

  perform private.write_event_log(
    'admin', 'redundant_logs_pruned', null, null, 'event_logs', null, 'succeeded',
    jsonb_build_object(
      'schedule_membership_duplicates', removed_schedule_duplicates,
      'meeting_slot_duplicates', removed_slot_duplicates
    )
  );
end;
$$;
