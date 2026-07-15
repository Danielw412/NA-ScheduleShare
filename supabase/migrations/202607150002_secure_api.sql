-- Security helpers live in the non-exposed private schema. Public RPCs are invoker wrappers only.

create or replace function private.is_active_user(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select check_user_id is not null
    and exists (
      select 1
      from public.profiles p
      join private.account_moderation m on m.user_id = p.id
      where p.id = check_user_id
        and m.suspended_at is null
        and m.deleted_at is null
    );
$$;

create or replace function private.is_admin(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user(check_user_id)
    and exists (
      select 1 from private.user_roles r
      where r.user_id = check_user_id and r.role = 'administrator'
    );
$$;

create or replace function private.has_active_enrollment(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_enrollments e
    where e.student_id = check_user_id and e.active
  );
$$;

create or replace function private.is_enrolled_in_class(check_user_id uuid, check_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_enrollments e
    where e.student_id = check_user_id and e.class_id = check_class_id and e.active
  );
$$;

create or replace function private.shares_active_class(viewer_id uuid, owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer_id is not null and owner_id is not null and exists (
    select 1
    from public.class_enrollments viewer_enrollment
    join public.class_enrollments owner_enrollment
      on owner_enrollment.class_id = viewer_enrollment.class_id
     and owner_enrollment.active
    where viewer_enrollment.student_id = viewer_id
      and owner_enrollment.student_id = owner_id
      and viewer_enrollment.active
  );
$$;

create or replace function private.can_view_full_schedule(viewer_id uuid, owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user(viewer_id) and (
    viewer_id = owner_id
    or private.is_admin(viewer_id)
    or exists (
      select 1 from public.profiles p
      where p.id = owner_id
        and (
          p.privacy_setting = 'school'
          or (p.privacy_setting = 'classmates' and private.shares_active_class(viewer_id, owner_id))
        )
    )
  );
$$;

create or replace function private.require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not private.is_active_user(current_user_id) then
    raise exception 'active_account_required' using errcode = '42501';
  end if;
  return current_user_id;
end;
$$;

create or replace function private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not private.is_admin(current_user_id) then
    raise exception 'administrator_access_required' using errcode = '42501';
  end if;
  return current_user_id;
end;
$$;

create or replace function private.consume_rate_limit(
  actor_id uuid,
  action_name text,
  maximum_events integer,
  event_window interval
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  delete from private.rate_limit_events where created_at < now() - interval '8 days';
  select count(*) into recent_count
  from private.rate_limit_events
  where user_id = actor_id and action_key = action_name and created_at >= now() - event_window;
  if recent_count >= maximum_events then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
  insert into private.rate_limit_events (user_id, action_key) values (actor_id, action_name);
end;
$$;

create or replace function private.terms_overlap(left_term public.academic_term, right_term public.academic_term)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select left_term = 'full_year' or right_term = 'full_year' or left_term = right_term;
$$;

create or replace function private.assert_no_schedule_conflict(
  target_student_id uuid,
  target_class_id uuid,
  target_term public.academic_term,
  excluded_enrollment_id uuid default null,
  allow_conflict boolean default false
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if allow_conflict then return; end if;
  if exists (
    select 1
    from public.class_enrollments existing
    join public.class_meeting_slots existing_slot on existing_slot.class_id = existing.class_id
    join public.class_meeting_slots next_slot
      on next_slot.class_id = target_class_id
     and next_slot.day_type = existing_slot.day_type
     and next_slot.period_number = existing_slot.period_number
    where existing.student_id = target_student_id
      and existing.active
      and existing.id is distinct from excluded_enrollment_id
      and private.terms_overlap(existing.academic_term, target_term)
  ) then
    raise exception 'schedule_conflict' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.write_audit(
  actor_id uuid,
  action_name text,
  target_kind text,
  target_value text,
  before_data jsonb,
  after_data jsonb,
  action_reason text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    administrator_id, action_type, target_type, target_id, before_values, after_values, reason
  ) values (
    actor_id, action_name, target_kind, target_value, before_data, after_data, nullif(trim(action_reason), '')
  );
$$;

create or replace function private.add_enrollment_for_student(
  target_student_id uuid,
  target_class_id uuid,
  target_term public.academic_term,
  actor_id uuid,
  history_action public.schedule_action,
  allow_conflict boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  enrollment_id uuid;
  class_snapshot jsonb;
begin
  if not exists (select 1 from public.classes c where c.id = target_class_id and c.status = 'active') then
    raise exception 'active_class_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_no_schedule_conflict(target_student_id, target_class_id, target_term, null, allow_conflict);

  insert into public.class_enrollments (student_id, class_id, academic_term, active)
  values (target_student_id, target_class_id, target_term, true)
  on conflict (student_id, class_id) do update
    set academic_term = excluded.academic_term, active = true, updated_at = now()
  returning id into enrollment_id;

  select jsonb_build_object(
    'enrollment_id', enrollment_id,
    'class_id', c.id,
    'class_name', c.class_name,
    'teacher_name', c.teacher_name,
    'academic_term', target_term
  ) into class_snapshot from public.classes c where c.id = target_class_id;

  insert into public.schedule_change_history (student_id, action, new_value, changed_by)
  values (target_student_id, history_action, class_snapshot, actor_id);
  return enrollment_id;
end;
$$;

create or replace function private.get_my_account_state()
returns table (suspended boolean, suspension_reason text, deleted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.suspended_at is not null, m.suspension_reason, m.deleted_at is not null
  from private.account_moderation m
  where m.user_id = auth.uid();
$$;

create or replace function public.get_my_account_state()
returns table (suspended boolean, suspension_reason text, deleted boolean)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_my_account_state(); $$;

create or replace function private.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.is_admin(auth.uid()); $$;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_current_user_admin(); $$;

create or replace function private.search_classes(
  search_query text default '',
  search_day_type public.day_type default null,
  search_period_number smallint default null,
  result_limit integer default 20
)
returns table (
  class_id uuid,
  class_name text,
  teacher_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  score real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  normalized_query text := private.normalize_search(search_query);
begin
  actor_id := private.require_active_user();
  return query
  select c.id,
         c.class_name,
         c.teacher_name,
         c.default_academic_term,
         c.is_double_period,
         jsonb_agg(jsonb_build_object('day_type', s.day_type, 'period_number', s.period_number) order by s.day_type, s.period_number),
         (
           case when search_day_type is not null and search_period_number is not null
             and bool_or(s.day_type = search_day_type and s.period_number = search_period_number) then 50 else 0 end
           + case when normalized_query = '' then 10 else greatest(
             extensions.similarity(c.normalized_class_name, normalized_query),
             extensions.similarity(c.normalized_teacher_name, normalized_query)
           ) * 40 end
           + case when c.normalized_class_name = normalized_query then 30 else 0 end
         )::real as score
  from public.classes c
  join public.class_meeting_slots s on s.class_id = c.id
  where c.status = 'active'
    and (normalized_query = ''
      or c.normalized_class_name like '%' || normalized_query || '%'
      or c.normalized_teacher_name like '%' || normalized_query || '%'
      or c.normalized_class_name % normalized_query
      or c.normalized_teacher_name % normalized_query)
    and (search_day_type is null or exists (
      select 1 from public.class_meeting_slots filter_slot
      where filter_slot.class_id = c.id and filter_slot.day_type = search_day_type
    ))
    and (search_period_number is null or exists (
      select 1 from public.class_meeting_slots filter_slot
      where filter_slot.class_id = c.id and filter_slot.period_number = search_period_number
    ))
  group by c.id
  order by score desc, c.class_name, c.teacher_name
  limit least(greatest(result_limit, 1), 50);
end;
$$;

create or replace function public.search_classes(
  p_query text default '',
  p_day_type public.day_type default null,
  p_period_number smallint default null,
  p_limit integer default 20
)
returns table (
  class_id uuid,
  class_name text,
  teacher_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  score real
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.search_classes(p_query, p_day_type, p_period_number, p_limit); $$;

create or replace function private.enroll_in_class(
  target_class_id uuid,
  target_term public.academic_term,
  allow_conflict boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  return private.add_enrollment_for_student(actor_id, target_class_id, target_term, actor_id, 'class_added', allow_conflict);
end;
$$;

create or replace function public.enroll_in_class(
  p_class_id uuid,
  p_academic_term public.academic_term,
  p_allow_conflict boolean default false
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select private.enroll_in_class(p_class_id, p_academic_term, p_allow_conflict); $$;

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
  if jsonb_typeof(input_meeting_slots) <> 'array' or jsonb_array_length(input_meeting_slots) = 0 then
    raise exception 'meeting_slots_required' using errcode = '23514';
  end if;

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

create or replace function public.create_class_and_enroll(
  p_class_name text,
  p_teacher_name text,
  p_academic_term public.academic_term,
  p_is_double_period boolean,
  p_meeting_slots jsonb,
  p_confirmed_no_match boolean
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select private.create_class_and_enroll(p_class_name, p_teacher_name, p_academic_term, p_is_double_period, p_meeting_slots, p_confirmed_no_match); $$;

create or replace function private.remove_enrollment(target_enrollment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing public.class_enrollments%rowtype;
  previous_snapshot jsonb;
begin
  actor_id := private.require_active_user();
  select * into existing from public.class_enrollments
  where id = target_enrollment_id and student_id = actor_id and active for update;
  if not found then raise exception 'active_enrollment_not_found' using errcode = 'P0002'; end if;
  select jsonb_build_object('enrollment_id', existing.id, 'class_id', c.id, 'class_name', c.class_name, 'academic_term', existing.academic_term)
    into previous_snapshot from public.classes c where c.id = existing.class_id;
  update public.class_enrollments set active = false where id = existing.id;
  insert into public.schedule_change_history (student_id, action, previous_value, changed_by)
  values (actor_id, 'class_removed', previous_snapshot, actor_id);
end;
$$;

create or replace function public.remove_enrollment(p_enrollment_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.remove_enrollment(p_enrollment_id); $$;

create or replace function private.update_enrollment_term(target_enrollment_id uuid, next_term public.academic_term)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing public.class_enrollments%rowtype;
  class_name_value text;
begin
  actor_id := private.require_active_user();
  select * into existing from public.class_enrollments
  where id = target_enrollment_id and student_id = actor_id and active for update;
  if not found then raise exception 'active_enrollment_not_found' using errcode = 'P0002'; end if;
  perform private.assert_no_schedule_conflict(actor_id, existing.class_id, next_term, existing.id, false);
  select c.class_name into class_name_value from public.classes c where c.id = existing.class_id;
  update public.class_enrollments set academic_term = next_term where id = existing.id;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  values (
    actor_id, 'term_changed',
    jsonb_build_object('enrollment_id', existing.id, 'class_id', existing.class_id, 'class_name', class_name_value, 'academic_term', existing.academic_term),
    jsonb_build_object('enrollment_id', existing.id, 'class_id', existing.class_id, 'class_name', class_name_value, 'academic_term', next_term),
    actor_id
  );
end;
$$;

create or replace function public.update_enrollment_term(p_enrollment_id uuid, p_academic_term public.academic_term)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.update_enrollment_term(p_enrollment_id, p_academic_term); $$;

create or replace function private.replace_enrollment(
  target_enrollment_id uuid,
  replacement_class_id uuid,
  replacement_term public.academic_term,
  allow_conflict boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing public.class_enrollments%rowtype;
  next_enrollment_id uuid;
  previous_snapshot jsonb;
  next_snapshot jsonb;
begin
  actor_id := private.require_active_user();
  select * into existing from public.class_enrollments
  where id = target_enrollment_id and student_id = actor_id and active for update;
  if not found then raise exception 'active_enrollment_not_found' using errcode = 'P0002'; end if;
  if existing.class_id = replacement_class_id then
    perform private.update_enrollment_term(existing.id, replacement_term);
    return existing.id;
  end if;
  perform private.assert_no_schedule_conflict(actor_id, replacement_class_id, replacement_term, existing.id, allow_conflict);
  select jsonb_build_object('enrollment_id', existing.id, 'class_id', c.id, 'class_name', c.class_name, 'academic_term', existing.academic_term)
    into previous_snapshot from public.classes c where c.id = existing.class_id;
  update public.class_enrollments set active = false where id = existing.id;
  insert into public.class_enrollments (student_id, class_id, academic_term, active)
  values (actor_id, replacement_class_id, replacement_term, true)
  on conflict (student_id, class_id) do update
    set academic_term = excluded.academic_term, active = true, updated_at = now()
  returning id into next_enrollment_id;
  select jsonb_build_object('enrollment_id', next_enrollment_id, 'class_id', c.id, 'class_name', c.class_name, 'academic_term', replacement_term)
    into next_snapshot from public.classes c where c.id = replacement_class_id;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  values (actor_id, 'class_replaced', previous_snapshot, next_snapshot, actor_id);
  return next_enrollment_id;
end;
$$;

create or replace function public.replace_enrollment(
  p_enrollment_id uuid,
  p_new_class_id uuid,
  p_academic_term public.academic_term,
  p_allow_conflict boolean default false
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select private.replace_enrollment(p_enrollment_id, p_new_class_id, p_academic_term, p_allow_conflict); $$;

create or replace function private.search_student_directory(
  name_query text default null,
  grade_filter smallint default null,
  class_filter text default null,
  teacher_filter text default null
)
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_class_count bigint,
  can_view_schedule boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  if not private.has_active_enrollment(actor_id) and not private.is_admin(actor_id) then
    raise exception 'schedule_required_for_discovery' using errcode = '42501';
  end if;
  return query
  select p.id,
         p.full_name,
         p.grade,
         p.privacy_setting,
         (
           select count(distinct mine.class_id)
           from public.class_enrollments mine
           join public.class_enrollments theirs on theirs.class_id = mine.class_id and theirs.active
           where mine.student_id = actor_id and mine.active and theirs.student_id = p.id
         ),
         private.can_view_full_schedule(actor_id, p.id)
  from public.profiles p
  where p.id <> actor_id
    and private.is_active_user(p.id)
    and p.grade is not null
    and (
      p.privacy_setting = 'school'
      or (p.privacy_setting = 'classmates' and private.shares_active_class(actor_id, p.id))
      or private.is_admin(actor_id)
    )
    and (name_query is null or p.normalized_name like '%' || private.normalize_search(name_query) || '%')
    and (grade_filter is null or p.grade = grade_filter)
    and (class_filter is null or exists (
      select 1 from public.class_enrollments e join public.classes c on c.id = e.class_id
      where e.student_id = p.id and e.active and c.normalized_class_name like '%' || private.normalize_search(class_filter) || '%'
    ))
    and (teacher_filter is null or exists (
      select 1 from public.class_enrollments e join public.classes c on c.id = e.class_id
      where e.student_id = p.id and e.active and c.normalized_teacher_name like '%' || private.normalize_search(teacher_filter) || '%'
    ))
  order by p.full_name
  limit 200;
end;
$$;

create or replace function public.search_student_directory(
  p_query text default null,
  p_grade smallint default null,
  p_class_name text default null,
  p_teacher_name text default null
)
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_class_count bigint,
  can_view_schedule boolean
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.search_student_directory(p_query, p_grade, p_class_name, p_teacher_name); $$;

create or replace function private.get_classmates()
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_class_names jsonb,
  can_view_schedule boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  if not private.has_active_enrollment(actor_id) and not private.is_admin(actor_id) then
    raise exception 'schedule_required_for_discovery' using errcode = '42501';
  end if;
  return query
  select p.id,
         p.full_name,
         p.grade,
         p.privacy_setting,
         jsonb_agg(distinct c.class_name order by c.class_name),
         private.can_view_full_schedule(actor_id, p.id)
  from public.class_enrollments mine
  join public.class_enrollments theirs
    on theirs.class_id = mine.class_id
   and theirs.active
   and theirs.student_id <> actor_id
  join public.classes c on c.id = mine.class_id and c.status = 'active'
  join public.profiles p on p.id = theirs.student_id
  where mine.student_id = actor_id
    and mine.active
    and private.is_active_user(p.id)
  group by p.id, p.full_name, p.grade, p.privacy_setting
  order by count(distinct mine.class_id) desc, p.full_name;
end;
$$;

create or replace function public.get_classmates()
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_class_names jsonb,
  can_view_schedule boolean
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_classmates(); $$;

create or replace function private.get_visible_schedule(target_student_id uuid)
returns table (
  enrollment_id uuid,
  class_id uuid,
  class_name text,
  teacher_name text,
  academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  if not private.can_view_full_schedule(actor_id, target_student_id) then
    raise exception 'schedule_not_visible' using errcode = '42501';
  end if;
  return query
  select e.id, c.id, c.class_name, c.teacher_name, e.academic_term, c.is_double_period,
         jsonb_agg(jsonb_build_object('day_type', s.day_type, 'period_number', s.period_number) order by s.day_type, s.period_number),
         e.created_at
  from public.class_enrollments e
  join public.classes c on c.id = e.class_id and c.status = 'active'
  join public.class_meeting_slots s on s.class_id = c.id
  where e.student_id = target_student_id and e.active
  group by e.id, c.id
  order by min(s.period_number), c.class_name;
end;
$$;

create or replace function public.get_visible_schedule(p_student_id uuid)
returns table (
  enrollment_id uuid,
  class_id uuid,
  class_name text,
  teacher_name text,
  academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_visible_schedule(p_student_id); $$;

create or replace function private.get_class_members(target_class_id uuid)
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  can_view_schedule boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  if not private.has_active_enrollment(actor_id) and not private.is_admin(actor_id) then
    raise exception 'schedule_required_for_discovery' using errcode = '42501';
  end if;
  if not exists (select 1 from public.classes c where c.id = target_class_id and c.status = 'active') then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;
  return query
  select p.id, p.full_name, p.grade, p.privacy_setting, private.can_view_full_schedule(actor_id, p.id)
  from public.class_enrollments e
  join public.profiles p on p.id = e.student_id
  where e.class_id = target_class_id and e.active and private.is_active_user(p.id)
  order by p.full_name;
end;
$$;

create or replace function public.get_class_members(p_class_id uuid)
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  can_view_schedule boolean
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_class_members(p_class_id); $$;

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
declare actor_id uuid; report_id uuid;
begin
  actor_id := private.require_active_user();
  perform private.consume_rate_limit(actor_id, 'report_create', 10, interval '1 day');
  if char_length(coalesce(target_explanation, '')) > 2000 then
    raise exception 'report_explanation_too_long' using errcode = '22001';
  end if;
  insert into public.reports (reporter_id, reported_user_id, reported_class_id, reason_category, explanation)
  values (actor_id, target_user_id, target_class_id, target_reason, nullif(trim(target_explanation), ''))
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.create_report(
  p_reason_category public.report_reason,
  p_explanation text default null,
  p_reported_user_id uuid default null,
  p_reported_class_id uuid default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select private.create_report(p_reason_category, p_explanation, p_reported_user_id, p_reported_class_id); $$;

-- Administrative API
create or replace function private.admin_list_users(search_query text default '', grade_filter smallint default null, status_filter text default null)
returns table (
  user_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  status text,
  is_admin boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select p.id, p.full_name, p.grade, p.privacy_setting,
         case when m.deleted_at is not null then 'deleted' when m.suspended_at is not null then 'suspended' else 'active' end,
         exists (select 1 from private.user_roles r where r.user_id = p.id and r.role = 'administrator'),
         p.created_at
  from public.profiles p
  join private.account_moderation m on m.user_id = p.id
  where (search_query = '' or p.normalized_name like '%' || private.normalize_search(search_query) || '%')
    and (grade_filter is null or p.grade = grade_filter)
    and (status_filter is null or status_filter = '' or status_filter = case when m.deleted_at is not null then 'deleted' when m.suspended_at is not null then 'suspended' else 'active' end)
  order by p.full_name
  limit 500;
end;
$$;

create or replace function public.admin_list_users(p_query text default '', p_grade smallint default null, p_status text default null)
returns table (user_id uuid, full_name text, grade smallint, privacy_setting public.privacy_setting, status text, is_admin boolean, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.admin_list_users(p_query, p_grade, p_status); $$;

create or replace function private.admin_suspend_user(target_user_id uuid, action_reason text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; before_data jsonb;
begin
  actor_id := private.require_admin();
  if target_user_id = actor_id then raise exception 'administrators_cannot_suspend_themselves' using errcode = '42501'; end if;
  if char_length(trim(coalesce(action_reason, ''))) < 3 then raise exception 'suspension_reason_required' using errcode = '23514'; end if;
  select to_jsonb(m) into before_data from private.account_moderation m where m.user_id = target_user_id for update;
  if not found then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  update private.account_moderation set suspended_at = now(), suspended_by = actor_id, suspension_reason = trim(action_reason) where user_id = target_user_id;
  perform private.write_audit(actor_id, 'user_suspended', 'user', target_user_id::text, before_data, jsonb_build_object('suspended', true), action_reason);
end;
$$;

create or replace function public.admin_suspend_user(p_user_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_suspend_user(p_user_id, p_reason); $$;

create or replace function private.admin_restore_user(target_user_id uuid, action_reason text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; before_data jsonb;
begin
  actor_id := private.require_admin();
  select to_jsonb(m) into before_data from private.account_moderation m where m.user_id = target_user_id for update;
  if not found then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  update private.account_moderation set suspended_at = null, suspended_by = null, suspension_reason = null where user_id = target_user_id;
  perform private.write_audit(actor_id, 'user_restored', 'user', target_user_id::text, before_data, jsonb_build_object('suspended', false), action_reason);
end;
$$;

create or replace function public.admin_restore_user(p_user_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_restore_user(p_user_id, p_reason); $$;

create or replace function private.admin_update_user(
  target_user_id uuid,
  next_full_name text,
  next_grade smallint,
  next_privacy public.privacy_setting,
  action_reason text
)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; after_data jsonb;
begin
  actor_id := private.require_admin();
  select to_jsonb(p) into before_data from public.profiles p where p.id = target_user_id for update;
  if not found then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  update public.profiles set full_name = next_full_name, grade = next_grade, privacy_setting = next_privacy where id = target_user_id;
  select to_jsonb(p) into after_data from public.profiles p where p.id = target_user_id;
  perform private.write_audit(actor_id, 'profile_changed', 'user', target_user_id::text, before_data, after_data, action_reason);
end;
$$;

create or replace function public.admin_update_user(p_user_id uuid, p_full_name text, p_grade smallint, p_privacy_setting public.privacy_setting, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_update_user(p_user_id, p_full_name, p_grade, p_privacy_setting, p_reason); $$;

create or replace function private.admin_delete_user(target_user_id uuid, action_reason text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; target_is_admin boolean;
begin
  actor_id := private.require_admin();
  select jsonb_build_object('profile', to_jsonb(p), 'moderation', to_jsonb(m)) into before_data
  from public.profiles p join private.account_moderation m on m.user_id = p.id where p.id = target_user_id for update of p, m;
  if not found then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  select exists (select 1 from private.user_roles r where r.user_id = target_user_id and r.role = 'administrator') into target_is_admin;
  if target_is_admin and (select count(*) from private.user_roles where role = 'administrator') <= 1 then
    raise exception 'cannot_delete_last_administrator' using errcode = '42501';
  end if;
  update private.account_moderation set deleted_at = now(), suspended_at = now(), suspended_by = actor_id, suspension_reason = 'Account deleted by administrator' where user_id = target_user_id;
  update public.class_enrollments set active = false where student_id = target_user_id and active;
  perform private.write_audit(actor_id, 'user_deleted', 'user', target_user_id::text, before_data, jsonb_build_object('deleted', true), action_reason);
  delete from auth.sessions where user_id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
$$;

create or replace function public.admin_delete_user(p_user_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_delete_user(p_user_id, p_reason); $$;

create or replace function private.admin_archive_class(target_class_id uuid, action_reason text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; before_data jsonb;
begin
  actor_id := private.require_admin();
  select to_jsonb(c) into before_data from public.classes c where c.id = target_class_id for update;
  if not found then raise exception 'class_not_found' using errcode = 'P0002'; end if;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id, 'admin_schedule_change',
         jsonb_build_object('enrollment_id', e.id, 'class_id', c.id, 'class_name', c.class_name, 'active', true),
         jsonb_build_object('enrollment_id', e.id, 'class_id', c.id, 'class_name', c.class_name, 'active', false, 'reason', action_reason),
         actor_id
  from public.class_enrollments e join public.classes c on c.id = e.class_id
  where e.class_id = target_class_id and e.active;
  update public.class_enrollments set active = false where class_id = target_class_id and active;
  update public.classes set status = 'archived' where id = target_class_id;
  perform private.write_audit(actor_id, 'class_deleted', 'class', target_class_id::text, before_data, jsonb_build_object('status', 'archived'), action_reason);
end;
$$;

create or replace function public.admin_archive_class(p_class_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_archive_class(p_class_id, p_reason); $$;

create or replace function private.admin_update_class(
  target_class_id uuid,
  next_class_name text,
  next_teacher_name text,
  next_term public.academic_term,
  next_is_double boolean,
  next_slots jsonb,
  action_reason text
)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; after_data jsonb;
begin
  actor_id := private.require_admin();
  select jsonb_build_object('class', to_jsonb(c), 'meeting_slots', (select jsonb_agg(to_jsonb(s)) from public.class_meeting_slots s where s.class_id = c.id)) into before_data
  from public.classes c where c.id = target_class_id for update;
  if not found then raise exception 'class_not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(next_slots) <> 'array' or jsonb_array_length(next_slots) = 0 then raise exception 'meeting_slots_required' using errcode = '23514'; end if;
  update public.classes set class_name = next_class_name, teacher_name = next_teacher_name, default_academic_term = next_term, is_double_period = next_is_double where id = target_class_id;
  delete from public.class_meeting_slots where class_id = target_class_id;
  insert into public.class_meeting_slots (class_id, day_type, period_number)
  select target_class_id, requested.day_type, requested.period_number
  from jsonb_to_recordset(next_slots) requested(day_type public.day_type, period_number smallint);
  select jsonb_build_object('class', to_jsonb(c), 'meeting_slots', (select jsonb_agg(to_jsonb(s)) from public.class_meeting_slots s where s.class_id = c.id)) into after_data
  from public.classes c where c.id = target_class_id;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id, 'meeting_slots_changed', before_data, after_data, actor_id
  from public.class_enrollments e where e.class_id = target_class_id and e.active;
  perform private.write_audit(actor_id, 'class_edited', 'class', target_class_id::text, before_data, after_data, action_reason);
end;
$$;

create or replace function public.admin_update_class(p_class_id uuid, p_class_name text, p_teacher_name text, p_academic_term public.academic_term, p_is_double_period boolean, p_meeting_slots jsonb, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_update_class(p_class_id, p_class_name, p_teacher_name, p_academic_term, p_is_double_period, p_meeting_slots, p_reason); $$;

create or replace function private.admin_merge_classes(canonical_class_id uuid, duplicate_class_id uuid, action_reason text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; duplicate_status public.class_status;
begin
  actor_id := private.require_admin();
  if canonical_class_id = duplicate_class_id then raise exception 'merge_requires_two_classes' using errcode = '23514'; end if;
  perform 1 from public.classes where id in (canonical_class_id, duplicate_class_id) for update;
  if (select count(*) from public.classes where id in (canonical_class_id, duplicate_class_id)) <> 2 then raise exception 'class_not_found' using errcode = 'P0002'; end if;
  select status into duplicate_status from public.classes where id = duplicate_class_id;
  if duplicate_status <> 'active' then raise exception 'duplicate_class_must_be_active' using errcode = '23514'; end if;
  select jsonb_build_object(
    'canonical', (select to_jsonb(c) from public.classes c where c.id = canonical_class_id),
    'duplicate', (select to_jsonb(c) from public.classes c where c.id = duplicate_class_id),
    'duplicate_enrollment_count', (select count(*) from public.class_enrollments e where e.class_id = duplicate_class_id)
  ) into before_data;

  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id, 'admin_schedule_change',
         jsonb_build_object('class_id', duplicate_class_id, 'enrollment_id', e.id, 'academic_term', e.academic_term),
         jsonb_build_object('class_id', canonical_class_id, 'merge_from', duplicate_class_id, 'academic_term', e.academic_term),
         actor_id
  from public.class_enrollments e where e.class_id = duplicate_class_id and e.active;

  insert into public.class_enrollments (student_id, class_id, academic_term, active, created_at, updated_at)
  select e.student_id, canonical_class_id, e.academic_term, e.active, e.created_at, now()
  from public.class_enrollments e where e.class_id = duplicate_class_id
  on conflict (student_id, class_id) do update set
    active = public.class_enrollments.active or excluded.active,
    academic_term = case
      when public.class_enrollments.academic_term = excluded.academic_term then public.class_enrollments.academic_term
      when public.class_enrollments.academic_term = 'full_year' or excluded.academic_term = 'full_year' then 'full_year'::public.academic_term
      else 'full_year'::public.academic_term
    end,
    updated_at = now();

  delete from public.class_enrollments where class_id = duplicate_class_id;
  update public.classes set status = 'merged' where id = duplicate_class_id;
  perform private.write_audit(actor_id, 'class_merged', 'class', canonical_class_id::text, before_data, jsonb_build_object('canonical_class_id', canonical_class_id, 'duplicate_class_id', duplicate_class_id, 'duplicate_status', 'merged'), action_reason);
end;
$$;

create or replace function public.admin_merge_classes(p_canonical_class_id uuid, p_duplicate_class_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_merge_classes(p_canonical_class_id, p_duplicate_class_id, p_reason); $$;

create or replace function private.admin_promote_user(target_user_id uuid, action_reason text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_admin();
  if not private.is_active_user(target_user_id) then raise exception 'active_user_not_found' using errcode = 'P0002'; end if;
  insert into private.user_roles (user_id, role, granted_by) values (target_user_id, 'administrator', actor_id)
  on conflict (user_id) do update set role = excluded.role, granted_by = actor_id, granted_at = now();
  perform private.write_audit(actor_id, 'admin_promoted', 'role', target_user_id::text, null, jsonb_build_object('role', 'administrator'), action_reason);
end;
$$;

create or replace function public.admin_promote_user(p_user_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_promote_user(p_user_id, p_reason); $$;

create or replace function private.admin_remove_user_role(target_user_id uuid, action_reason text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; admin_count integer;
begin
  actor_id := private.require_admin();
  select count(*) into admin_count from private.user_roles where role = 'administrator';
  if target_user_id = actor_id and admin_count <= 1 then raise exception 'last_administrator_cannot_remove_self' using errcode = '42501'; end if;
  delete from private.user_roles where user_id = target_user_id and role = 'administrator';
  if not found then raise exception 'administrator_role_not_found' using errcode = 'P0002'; end if;
  perform private.write_audit(actor_id, 'admin_removed', 'role', target_user_id::text, jsonb_build_object('role', 'administrator'), null, action_reason);
end;
$$;

create or replace function public.admin_remove_user_role(p_user_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_remove_user_role(p_user_id, p_reason); $$;

create or replace function private.admin_resolve_report(target_report_id uuid, next_status public.report_status, notes text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; after_data jsonb;
begin
  actor_id := private.require_admin();
  if next_status not in ('resolved', 'dismissed') then raise exception 'final_report_status_required' using errcode = '23514'; end if;
  if char_length(trim(coalesce(notes, ''))) < 3 then raise exception 'resolution_notes_required' using errcode = '23514'; end if;
  select to_jsonb(r) into before_data from public.reports r where r.id = target_report_id for update;
  if not found then raise exception 'report_not_found' using errcode = 'P0002'; end if;
  update public.reports set status = next_status, assigned_admin_id = actor_id, resolution_notes = notes, resolved_at = now() where id = target_report_id;
  select to_jsonb(r) into after_data from public.reports r where r.id = target_report_id;
  perform private.write_audit(actor_id, 'report_resolved', 'report', target_report_id::text, before_data, after_data, notes);
end;
$$;

create or replace function public.admin_resolve_report(p_report_id uuid, p_status public.report_status, p_resolution_notes text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_resolve_report(p_report_id, p_status, p_resolution_notes); $$;

create or replace function private.admin_set_enrollment(target_student_id uuid, target_class_id uuid, target_term public.academic_term, next_active boolean, allow_conflict boolean, action_reason text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare actor_id uuid; enrollment_id uuid;
begin
  actor_id := private.require_admin();
  if next_active then
    enrollment_id := private.add_enrollment_for_student(target_student_id, target_class_id, target_term, actor_id, 'admin_schedule_change', allow_conflict);
  else
    select id into enrollment_id from public.class_enrollments where student_id = target_student_id and class_id = target_class_id and active for update;
    if enrollment_id is null then raise exception 'active_enrollment_not_found' using errcode = 'P0002'; end if;
    update public.class_enrollments set active = false where id = enrollment_id;
    insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
    values (target_student_id, 'admin_schedule_change', jsonb_build_object('enrollment_id', enrollment_id, 'class_id', target_class_id, 'active', true), jsonb_build_object('active', false, 'reason', action_reason), actor_id);
  end if;
  perform private.write_audit(actor_id, 'administrative_schedule_change', 'enrollment', enrollment_id::text, null, jsonb_build_object('student_id', target_student_id, 'class_id', target_class_id, 'active', next_active), action_reason);
end;
$$;

create or replace function public.admin_set_enrollment(p_student_id uuid, p_class_id uuid, p_academic_term public.academic_term, p_active boolean, p_allow_conflict boolean, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_set_enrollment(p_student_id, p_class_id, p_academic_term, p_active, p_allow_conflict, p_reason); $$;

-- Remove default PUBLIC execution immediately, then grant only authenticated callers.
revoke all on function public.get_my_account_state() from public, anon;
revoke all on function public.is_current_user_admin() from public, anon;
revoke all on function public.search_classes(text, public.day_type, smallint, integer) from public, anon;
revoke all on function public.enroll_in_class(uuid, public.academic_term, boolean) from public, anon;
revoke all on function public.create_class_and_enroll(text, text, public.academic_term, boolean, jsonb, boolean) from public, anon;
revoke all on function public.remove_enrollment(uuid) from public, anon;
revoke all on function public.update_enrollment_term(uuid, public.academic_term) from public, anon;
revoke all on function public.replace_enrollment(uuid, uuid, public.academic_term, boolean) from public, anon;
revoke all on function public.search_student_directory(text, smallint, text, text) from public, anon;
revoke all on function public.get_classmates() from public, anon;
revoke all on function public.get_visible_schedule(uuid) from public, anon;
revoke all on function public.get_class_members(uuid) from public, anon;
revoke all on function public.create_report(public.report_reason, text, uuid, uuid) from public, anon;
revoke all on function public.admin_list_users(text, smallint, text) from public, anon;
revoke all on function public.admin_suspend_user(uuid, text) from public, anon;
revoke all on function public.admin_restore_user(uuid, text) from public, anon;
revoke all on function public.admin_update_user(uuid, text, smallint, public.privacy_setting, text) from public, anon;
revoke all on function public.admin_delete_user(uuid, text) from public, anon;
revoke all on function public.admin_archive_class(uuid, text) from public, anon;
revoke all on function public.admin_update_class(uuid, text, text, public.academic_term, boolean, jsonb, text) from public, anon;
revoke all on function public.admin_merge_classes(uuid, uuid, text) from public, anon;
revoke all on function public.admin_promote_user(uuid, text) from public, anon;
revoke all on function public.admin_remove_user_role(uuid, text) from public, anon;
revoke all on function public.admin_resolve_report(uuid, public.report_status, text) from public, anon;
revoke all on function public.admin_set_enrollment(uuid, uuid, public.academic_term, boolean, boolean, text) from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.is_active_user(uuid) to authenticated;
grant execute on function private.is_admin(uuid) to authenticated;
grant execute on function private.has_active_enrollment(uuid) to authenticated;
grant execute on function private.is_enrolled_in_class(uuid, uuid) to authenticated;
grant execute on function private.shares_active_class(uuid, uuid) to authenticated;
grant execute on function private.can_view_full_schedule(uuid, uuid) to authenticated;
grant execute on function private.get_my_account_state() to authenticated;
grant execute on function private.is_current_user_admin() to authenticated;
grant execute on function private.search_classes(text, public.day_type, smallint, integer) to authenticated;
grant execute on function private.enroll_in_class(uuid, public.academic_term, boolean) to authenticated;
grant execute on function private.create_class_and_enroll(text, text, public.academic_term, boolean, jsonb, boolean) to authenticated;
grant execute on function private.remove_enrollment(uuid) to authenticated;
grant execute on function private.update_enrollment_term(uuid, public.academic_term) to authenticated;
grant execute on function private.replace_enrollment(uuid, uuid, public.academic_term, boolean) to authenticated;
grant execute on function private.search_student_directory(text, smallint, text, text) to authenticated;
grant execute on function private.get_classmates() to authenticated;
grant execute on function private.get_visible_schedule(uuid) to authenticated;
grant execute on function private.get_class_members(uuid) to authenticated;
grant execute on function private.create_report(public.report_reason, text, uuid, uuid) to authenticated;
grant execute on function private.admin_list_users(text, smallint, text) to authenticated;
grant execute on function private.admin_suspend_user(uuid, text) to authenticated;
grant execute on function private.admin_restore_user(uuid, text) to authenticated;
grant execute on function private.admin_update_user(uuid, text, smallint, public.privacy_setting, text) to authenticated;
grant execute on function private.admin_delete_user(uuid, text) to authenticated;
grant execute on function private.admin_archive_class(uuid, text) to authenticated;
grant execute on function private.admin_update_class(uuid, text, text, public.academic_term, boolean, jsonb, text) to authenticated;
grant execute on function private.admin_merge_classes(uuid, uuid, text) to authenticated;
grant execute on function private.admin_promote_user(uuid, text) to authenticated;
grant execute on function private.admin_remove_user_role(uuid, text) to authenticated;
grant execute on function private.admin_resolve_report(uuid, public.report_status, text) to authenticated;
grant execute on function private.admin_set_enrollment(uuid, uuid, public.academic_term, boolean, boolean, text) to authenticated;

grant execute on function public.get_my_account_state() to authenticated;
grant execute on function public.is_current_user_admin() to authenticated;
grant execute on function public.search_classes(text, public.day_type, smallint, integer) to authenticated;
grant execute on function public.enroll_in_class(uuid, public.academic_term, boolean) to authenticated;
grant execute on function public.create_class_and_enroll(text, text, public.academic_term, boolean, jsonb, boolean) to authenticated;
grant execute on function public.remove_enrollment(uuid) to authenticated;
grant execute on function public.update_enrollment_term(uuid, public.academic_term) to authenticated;
grant execute on function public.replace_enrollment(uuid, uuid, public.academic_term, boolean) to authenticated;
grant execute on function public.search_student_directory(text, smallint, text, text) to authenticated;
grant execute on function public.get_classmates() to authenticated;
grant execute on function public.get_visible_schedule(uuid) to authenticated;
grant execute on function public.get_class_members(uuid) to authenticated;
grant execute on function public.create_report(public.report_reason, text, uuid, uuid) to authenticated;
grant execute on function public.admin_list_users(text, smallint, text) to authenticated;
grant execute on function public.admin_suspend_user(uuid, text) to authenticated;
grant execute on function public.admin_restore_user(uuid, text) to authenticated;
grant execute on function public.admin_update_user(uuid, text, smallint, public.privacy_setting, text) to authenticated;
grant execute on function public.admin_delete_user(uuid, text) to authenticated;
grant execute on function public.admin_archive_class(uuid, text) to authenticated;
grant execute on function public.admin_update_class(uuid, text, text, public.academic_term, boolean, jsonb, text) to authenticated;
grant execute on function public.admin_merge_classes(uuid, uuid, text) to authenticated;
grant execute on function public.admin_promote_user(uuid, text) to authenticated;
grant execute on function public.admin_remove_user_role(uuid, text) to authenticated;
grant execute on function public.admin_resolve_report(uuid, public.report_status, text) to authenticated;
grant execute on function public.admin_set_enrollment(uuid, uuid, public.academic_term, boolean, boolean, text) to authenticated;

revoke all on all functions in schema private from public, anon;
