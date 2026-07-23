-- Make permission grants the single authoritative access-allowed event and
-- preserve class-term invariants when administrators rename or recategorize courses.

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
  if not private.is_term_flexible_course(normalized_course_name) and exists (
    select 1 from public.class_enrollments enrollment
    where enrollment.class_id = new.id
      and enrollment.active
      and enrollment.academic_term <> new.default_academic_term
  ) then
    raise exception 'class_term_enrollment_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_course_name_term_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_lunch_course(new.normalized_name) and exists (
    select 1 from public.classes class_record
    where class_record.course_name_id = new.id
      and class_record.default_academic_term = 'full_year'
  ) then
    raise exception 'lunch_requires_semester' using errcode = '23514';
  end if;
  if not private.is_term_flexible_course(new.normalized_name) and exists (
    select 1
    from public.classes class_record
    join public.class_enrollments enrollment on enrollment.class_id = class_record.id
    where class_record.course_name_id = new.id
      and enrollment.active
      and enrollment.academic_term <> class_record.default_academic_term
  ) then
    raise exception 'class_term_enrollment_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists course_names_enforce_term_rules on public.course_names;
create trigger course_names_enforce_term_rules
after update of name, normalized_name on public.course_names
for each row execute function private.enforce_course_name_term_rules();

revoke all on function private.enforce_course_name_term_rules() from public, anon, authenticated;

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
    if new.status::text = 'approved' then return new; end if;
    if new.status::text = 'declined' then
      event_name := 'schedule_access_denied';
      subject_id := new.requester_id;
      event_result := 'denied';
    else
      event_name := 'schedule_access_request_cancelled';
      subject_id := new.owner_id;
      event_result := 'cancelled';
    end if;
  else return new; end if;
  perform private.write_event_log(
    'audit', event_name, actor_id, subject_id, 'schedule_access_request', new.id::text,
    event_result,
    jsonb_build_object(
      'request_id', new.id,
      'requester_id', new.requester_id,
      'schedule_owner_id', new.owner_id,
      'access_type', 'full_schedule',
      'allowed', case when new.status::text = 'declined' then false else null end,
      'decided_by', case when new.status::text = 'declined' then actor_id else null end
    )
  );
  return new;
end;
$$;

create or replace function private.capture_access_grant_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare request_id uuid;
begin
  if tg_op = 'INSERT' or (old.revoked_at is not null and new.revoked_at is null) then
    if new.granted_via::text = 'request' then
      select request_record.id into request_id
      from public.schedule_access_requests request_record
      where request_record.owner_id = new.owner_id
        and request_record.requester_id = new.viewer_id
        and request_record.status = 'pending'
      order by request_record.created_at
      limit 1;
    end if;
    perform private.write_event_log(
      'audit', 'schedule_access_allowed', auth.uid(), new.viewer_id,
      'schedule_access_grant', new.owner_id::text || ':' || new.viewer_id::text,
      'allowed',
      jsonb_build_object(
        'request_id', request_id,
        'requester_id', new.viewer_id,
        'schedule_owner_id', new.owner_id,
        'access_type', 'full_schedule',
        'allowed', true,
        'decided_by', auth.uid(),
        'granted_via', new.granted_via
      )
    );
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform private.write_event_log(
      'audit', 'schedule_access_revoked', auth.uid(), new.viewer_id,
      'schedule_access_grant', new.owner_id::text || ':' || new.viewer_id::text,
      'revoked',
      jsonb_build_object(
        'viewer_id', new.viewer_id,
        'owner_id', new.owner_id,
        'access_type', 'full_schedule',
        'granted_via', new.granted_via
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_access_grants_capture_event on public.schedule_access_grants;
create trigger schedule_access_grants_capture_event
after insert or update on public.schedule_access_grants
for each row execute function private.capture_access_grant_event();
