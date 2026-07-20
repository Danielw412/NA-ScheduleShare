-- Targeted schedule access is an additive, one-way permission layer. Existing
-- profile privacy and administrator access continue to apply independently.

create type public.schedule_access_request_status as enum (
  'pending',
  'approved',
  'declined',
  'canceled'
);

create table public.schedule_access_grants (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  granted_via text not null default 'manual' check (granted_via in ('manual', 'request')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);

create table public.schedule_access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status public.schedule_access_request_status not null default 'pending',
  requester_read_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> owner_id),
  check ((status = 'pending') = (responded_at is null))
);

create index schedule_access_grants_viewer_active_idx
  on public.schedule_access_grants(viewer_id, owner_id)
  where revoked_at is null;
create index schedule_access_grants_owner_active_idx
  on public.schedule_access_grants(owner_id, viewer_id)
  where revoked_at is null;
create unique index schedule_access_requests_pending_pair_idx
  on public.schedule_access_requests(requester_id, owner_id)
  where status = 'pending';
create index schedule_access_requests_owner_pending_idx
  on public.schedule_access_requests(owner_id, updated_at desc)
  where status = 'pending';
create index schedule_access_requests_requester_updates_idx
  on public.schedule_access_requests(requester_id, updated_at desc)
  where status in ('approved', 'declined');

alter table public.schedule_access_grants enable row level security;
alter table public.schedule_access_requests enable row level security;

create policy schedule_access_grants_select_parties
on public.schedule_access_grants
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and ((select auth.uid()) = owner_id or (select auth.uid()) = viewer_id)
);

create policy schedule_access_requests_select_parties
on public.schedule_access_requests
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and ((select auth.uid()) = owner_id or (select auth.uid()) = requester_id)
);

-- Resolve the strongest currently relevant explanation for a viewer's access.
-- Privacy/shared-class reasons intentionally take precedence over a stored grant
-- so the UI does not offer redundant manual actions. The grant remains stored.
create or replace function private.schedule_access_reason(viewer_id uuid, owner_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when $1 is null or $2 is null then 'private'
    when not private.is_active_user($1) then 'private'
    when $1 = $2 then 'self'
    when private.is_admin($1) then 'admin'
    when not private.is_active_user($2) then 'private'
    when exists (
      select 1
      from public.profiles profile
      where profile.id = $2
        and profile.privacy_setting = 'school'
    ) then 'everyone_allowed'
    when exists (
      select 1
      from public.profiles profile
      where profile.id = $2
        and profile.privacy_setting = 'classmates'
        and private.shares_active_class($1, $2)
    ) then 'shared_class'
    when exists (
      select 1
      from public.schedule_access_grants access_grant
      where access_grant.owner_id = $2
        and access_grant.viewer_id = $1
        and access_grant.revoked_at is null
    ) then 'approved'
    else 'private'
  end;
$$;

create or replace function private.can_view_roster_member(viewer_id uuid, member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.schedule_access_reason(viewer_id, member_id) <> 'private';
$$;

create or replace function private.can_view_full_schedule(viewer_id uuid, owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_view_roster_member(viewer_id, owner_id);
$$;

-- Keep the existing shared-class roster behavior while preserving the
-- administrator exception for suspended roster members.
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
  if not exists (
    select 1
    from public.classes class_record
    where class_record.id = target_class_id
      and class_record.status = 'active'
  ) then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;

  return query
  select profile.id,
         profile.full_name,
         profile.grade,
         profile.privacy_setting,
         private.can_view_full_schedule(actor_id, profile.id)
  from public.class_enrollments enrollment
  join public.profiles profile on profile.id = enrollment.student_id
  where enrollment.class_id = target_class_id
    and enrollment.active
    and (
      private.is_admin(actor_id)
      or (
        private.is_active_user(profile.id)
        and (
          private.can_view_roster_member(actor_id, profile.id)
          or private.is_enrolled_in_class(actor_id, target_class_id)
        )
      )
    )
  order by profile.full_name;
end;
$$;

-- Direct student-detail loads use this lookup after the schedule permission
-- check, so manually approved viewers must be able to resolve the heading too.
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
  select profile.id, profile.full_name, profile.grade
  from public.profiles profile
  where profile.id <> actor_id
    and profile.onboarding_completed
    and private.is_active_user(profile.id)
    and (target_user_id is null or profile.id = target_user_id)
    and (target_user_id is not null or normalized_query = '' or profile.normalized_name like '%' || normalized_query || '%')
    and private.can_view_roster_member(actor_id, profile.id)
  order by profile.full_name
  limit least(greatest(result_limit, 1), 50);
end;
$$;

create or replace function private.allow_schedule_access(target_viewer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_user();
  pending_request_id uuid;
begin
  if target_viewer_id is null or target_viewer_id = actor_id then
    raise exception 'invalid_schedule_access_target' using errcode = '22023';
  end if;
  if not private.is_active_user(target_viewer_id) then
    raise exception 'schedule_access_target_unavailable' using errcode = 'P0002';
  end if;

  select request.id into pending_request_id
  from public.schedule_access_requests request
  where request.requester_id = target_viewer_id
    and request.owner_id = actor_id
    and request.status = 'pending'
  order by request.created_at
  limit 1
  for update;

  insert into public.schedule_access_grants (
    owner_id,
    viewer_id,
    granted_via,
    granted_at,
    revoked_at,
    updated_at
  ) values (
    actor_id,
    target_viewer_id,
    case when pending_request_id is null then 'manual' else 'request' end,
    now(),
    null,
    now()
  )
  on conflict (owner_id, viewer_id) do update
  set granted_via = excluded.granted_via,
      granted_at = excluded.granted_at,
      revoked_at = null,
      updated_at = now();

  if pending_request_id is not null then
    update public.schedule_access_requests
    set status = 'approved',
        requester_read_at = null,
        responded_at = now(),
        updated_at = now()
    where id = pending_request_id;
  end if;
end;
$$;

create or replace function private.remove_schedule_access(target_viewer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid := private.require_active_user();
begin
  if target_viewer_id is null or target_viewer_id = actor_id then
    raise exception 'invalid_schedule_access_target' using errcode = '22023';
  end if;

  update public.schedule_access_grants
  set revoked_at = now(),
      updated_at = now()
  where owner_id = actor_id
    and viewer_id = target_viewer_id
    and revoked_at is null;
end;
$$;

create or replace function private.request_schedule_access(target_owner_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_user();
  request_id uuid;
begin
  if target_owner_id is null or target_owner_id = actor_id then
    raise exception 'invalid_schedule_access_target' using errcode = '22023';
  end if;
  if not private.is_active_user(target_owner_id) then
    raise exception 'schedule_access_target_unavailable' using errcode = 'P0002';
  end if;
  if private.can_view_full_schedule(actor_id, target_owner_id) then
    raise exception 'schedule_access_already_available' using errcode = '42501';
  end if;

  select request.id into request_id
  from public.schedule_access_requests request
  where request.requester_id = actor_id
    and request.owner_id = target_owner_id
    and request.status = 'pending'
  order by request.created_at
  limit 1;

  if request_id is not null then
    return request_id;
  end if;

  insert into public.schedule_access_requests (requester_id, owner_id)
  values (actor_id, target_owner_id)
  returning id into request_id;

  return request_id;
end;
$$;

create or replace function private.cancel_schedule_access_request(target_owner_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_user();
  changed_count integer;
begin
  update public.schedule_access_requests
  set status = 'canceled',
      responded_at = now(),
      updated_at = now()
  where requester_id = actor_id
    and owner_id = target_owner_id
    and status = 'pending';

  get diagnostics changed_count = row_count;
  if changed_count = 0 then
    raise exception 'schedule_access_request_not_pending' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function private.respond_schedule_access_request(
  target_request_id uuid,
  allow_request boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_user();
  access_request public.schedule_access_requests%rowtype;
begin
  select request.* into access_request
  from public.schedule_access_requests request
  where request.id = target_request_id
    and request.owner_id = actor_id
  for update;

  if access_request.id is null or access_request.status <> 'pending' then
    raise exception 'schedule_access_request_not_pending' using errcode = 'P0002';
  end if;

  if allow_request then
    if not private.is_active_user(access_request.requester_id) then
      raise exception 'schedule_access_target_unavailable' using errcode = 'P0002';
    end if;

    insert into public.schedule_access_grants (
      owner_id,
      viewer_id,
      granted_via,
      granted_at,
      revoked_at,
      updated_at
    ) values (
      actor_id,
      access_request.requester_id,
      'request',
      now(),
      null,
      now()
    )
    on conflict (owner_id, viewer_id) do update
    set granted_via = 'request',
        granted_at = excluded.granted_at,
        revoked_at = null,
        updated_at = now();
  end if;

  update public.schedule_access_requests
  set status = case when allow_request then 'approved' else 'declined' end::public.schedule_access_request_status,
      requester_read_at = null,
      responded_at = now(),
      updated_at = now()
  where id = access_request.id;
end;
$$;

create or replace function private.search_student_access_directory(
  name_query text default null,
  grade_filter smallint default null,
  course_filter text default null,
  teacher_filter text default null
)
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_class_count bigint,
  can_view_schedule boolean,
  they_can_view_yours text,
  you_can_view_theirs text,
  outgoing_request_pending boolean
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
  select profile.id,
         case
           when access_to_student.reason <> 'private' then profile.full_name
           else split_part(trim(profile.full_name), ' ', 1)
         end,
         profile.grade,
         profile.privacy_setting,
         case
           when access_to_student.reason <> 'private' then (
             select count(distinct mine.class_id)
             from public.class_enrollments mine
             join public.class_enrollments theirs
               on theirs.class_id = mine.class_id
              and theirs.active
             where mine.student_id = actor_id
               and mine.active
               and theirs.student_id = profile.id
           )
           else 0::bigint
         end,
         access_to_student.reason <> 'private',
         case access_from_student.reason
           when 'approved' then 'approved_by_you'
           when 'private' then 'no_access'
           else access_from_student.reason
         end,
         case access_to_student.reason
           when 'approved' then 'approved_by_them'
           else access_to_student.reason
         end,
         access_to_student.reason = 'private' and exists (
           select 1
           from public.schedule_access_requests request
           where request.requester_id = actor_id
             and request.owner_id = profile.id
             and request.status = 'pending'
         )
  from public.profiles profile
  cross join lateral (
    select private.schedule_access_reason(actor_id, profile.id) as reason
  ) access_to_student
  cross join lateral (
    select private.schedule_access_reason(profile.id, actor_id) as reason
  ) access_from_student
  where profile.id <> actor_id
    and private.is_active_user(profile.id)
    and profile.grade is not null
    and (
      name_query is null
      or private.normalize_search(
        case
          when access_to_student.reason <> 'private' then profile.full_name
          else split_part(trim(profile.full_name), ' ', 1)
        end
      ) like '%' || private.normalize_search(name_query) || '%'
    )
    and (grade_filter is null or profile.grade = grade_filter)
    and (
      course_filter is null
      or (
        access_to_student.reason <> 'private'
        and exists (
          select 1
          from public.class_enrollments enrollment
          join public.classes class on class.id = enrollment.class_id
          join public.course_names course_name on course_name.id = class.course_name_id
          where enrollment.student_id = profile.id
            and enrollment.active
            and course_name.normalized_name like '%' || private.normalize_search(course_filter) || '%'
        )
      )
    )
    and (
      teacher_filter is null
      or (
        access_to_student.reason <> 'private'
        and exists (
          select 1
          from public.class_enrollments enrollment
          join public.classes class on class.id = enrollment.class_id
          where enrollment.student_id = profile.id
            and enrollment.active
            and class.normalized_teacher_last_name like '%' || private.normalize_search(teacher_filter) || '%'
        )
      )
    )
  order by 2, profile.id
  limit 200;
end;
$$;

create or replace function private.get_schedule_access_notifications(result_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_user();
  result jsonb;
begin
  select jsonb_build_object(
    'count',
      (
        select count(*)
        from public.schedule_access_requests request
        where request.owner_id = actor_id
          and request.status = 'pending'
          and private.schedule_access_reason(request.requester_id, request.owner_id) = 'private'
      )
      +
      (
        select count(*)
        from public.schedule_access_requests request
        where request.requester_id = actor_id
          and request.status in ('approved', 'declined')
          and request.requester_read_at is null
      ),
    'notifications', coalesce(
      (
        select jsonb_agg(feed.item order by feed.sort_group, feed.sort_time desc)
        from (
          select jsonb_build_object(
                   'request_id', request.id,
                   'kind', 'incoming_request',
                   'status', request.status,
                   'student_id', request.requester_id,
                   'full_name', requester.full_name,
                   'created_at', request.created_at,
                   'updated_at', request.updated_at,
                   'read', false
                 ) as item,
                 0 as sort_group,
                 request.updated_at as sort_time
          from public.schedule_access_requests request
          join public.profiles requester on requester.id = request.requester_id
          where request.owner_id = actor_id
            and request.status = 'pending'
            and private.is_active_user(request.requester_id)
            and private.schedule_access_reason(request.requester_id, request.owner_id) = 'private'

          union all

          select jsonb_build_object(
                   'request_id', request.id,
                   'kind', 'request_update',
                   'status', request.status,
                   'student_id', request.owner_id,
                   'full_name', case
                     when private.can_view_full_schedule(actor_id, request.owner_id) then owner.full_name
                     else split_part(trim(owner.full_name), ' ', 1)
                   end,
                   'created_at', request.created_at,
                   'updated_at', request.updated_at,
                   'read', request.requester_read_at is not null
                 ) as item,
                 1 as sort_group,
                 request.updated_at as sort_time
          from public.schedule_access_requests request
          join public.profiles owner on owner.id = request.owner_id
          where request.requester_id = actor_id
            and request.status in ('approved', 'declined')
          order by sort_group, sort_time desc
          limit least(greatest(coalesce(result_limit, 30), 1), 50)
        ) feed
      ),
      '[]'::jsonb
    )
  ) into result;

  return result;
end;
$$;

create or replace function private.mark_schedule_access_notifications_read()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid := private.require_active_user();
begin
  update public.schedule_access_requests
  set requester_read_at = now()
  where requester_id = actor_id
    and status in ('approved', 'declined')
    and requester_read_at is null;
end;
$$;

create or replace function public.search_student_access_directory(
  p_query text default null,
  p_grade smallint default null,
  p_course_name text default null,
  p_teacher_last_name text default null
)
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_class_count bigint,
  can_view_schedule boolean,
  they_can_view_yours text,
  you_can_view_theirs text,
  outgoing_request_pending boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.search_student_access_directory(p_query, p_grade, p_course_name, p_teacher_last_name);
$$;

create or replace function public.allow_schedule_access(p_viewer_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.allow_schedule_access(p_viewer_id); $$;

create or replace function public.remove_schedule_access(p_viewer_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.remove_schedule_access(p_viewer_id); $$;

create or replace function public.request_schedule_access(p_owner_id uuid)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select private.request_schedule_access(p_owner_id); $$;

create or replace function public.cancel_schedule_access_request(p_owner_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.cancel_schedule_access_request(p_owner_id); $$;

create or replace function public.respond_schedule_access_request(p_request_id uuid, p_allow boolean)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.respond_schedule_access_request(p_request_id, p_allow); $$;

create or replace function public.get_schedule_access_notifications(p_limit integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_schedule_access_notifications(p_limit); $$;

create or replace function public.mark_schedule_access_notifications_read()
returns void
language sql
volatile
security invoker
set search_path = ''
as $$ select private.mark_schedule_access_notifications_read(); $$;

-- An explicit capability URL is independent from directory privacy. This new
-- migration corrects production, where the prior migration version had already
-- been recorded before its SQL was edited. Teacher last names are retained
-- because they are required by the public schedule row contract.
create or replace function public.get_public_schedule_share(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'available', true,
        'schedule', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'day_type', slots.day_type,
                'period_number', slots.period_number,
                'course_name', course_names.name,
                'teacher_last_name', classes.teacher_last_name,
                'academic_term', enrollments.academic_term
              )
              order by slots.day_type, slots.period_number, enrollments.academic_term, course_names.name
            )
            from public.class_enrollments enrollments
            join public.classes classes
              on classes.id = enrollments.class_id
             and classes.status = 'active'
            join public.course_names course_names
              on course_names.id = classes.course_name_id
            join public.class_meeting_slots slots
              on slots.class_id = classes.id
            where enrollments.student_id = links.owner_id
              and enrollments.active
          ),
          '[]'::jsonb
        )
      )
      from public.schedule_share_links links
      join private.account_moderation moderation on moderation.user_id = links.owner_id
      where links.token = p_token
        and links.enabled
        and moderation.suspended_at is null
        and moderation.deleted_at is null
        and exists (
          select 1
          from public.class_enrollments active_enrollment
          where active_enrollment.student_id = links.owner_id
            and active_enrollment.active
        )
    ),
    jsonb_build_object('available', false, 'schedule', '[]'::jsonb)
  );
$$;

revoke all on table public.schedule_access_grants from public, anon, authenticated;
revoke all on table public.schedule_access_requests from public, anon, authenticated;
grant select on table public.schedule_access_grants to authenticated;
grant select on table public.schedule_access_requests to authenticated;

revoke all on function private.schedule_access_reason(uuid, uuid) from public, anon, authenticated;
revoke all on function private.allow_schedule_access(uuid) from public, anon;
revoke all on function private.remove_schedule_access(uuid) from public, anon;
revoke all on function private.request_schedule_access(uuid) from public, anon;
revoke all on function private.cancel_schedule_access_request(uuid) from public, anon;
revoke all on function private.respond_schedule_access_request(uuid, boolean) from public, anon;
revoke all on function private.search_student_access_directory(text, smallint, text, text) from public, anon;
revoke all on function private.get_schedule_access_notifications(integer) from public, anon;
revoke all on function private.mark_schedule_access_notifications_read() from public, anon;

grant execute on function private.allow_schedule_access(uuid) to authenticated;
grant execute on function private.remove_schedule_access(uuid) to authenticated;
grant execute on function private.request_schedule_access(uuid) to authenticated;
grant execute on function private.cancel_schedule_access_request(uuid) to authenticated;
grant execute on function private.respond_schedule_access_request(uuid, boolean) to authenticated;
grant execute on function private.search_student_access_directory(text, smallint, text, text) to authenticated;
grant execute on function private.get_schedule_access_notifications(integer) to authenticated;
grant execute on function private.mark_schedule_access_notifications_read() to authenticated;

revoke all on function public.search_student_access_directory(text, smallint, text, text) from public, anon, authenticated;
revoke all on function public.allow_schedule_access(uuid) from public, anon, authenticated;
revoke all on function public.remove_schedule_access(uuid) from public, anon, authenticated;
revoke all on function public.request_schedule_access(uuid) from public, anon, authenticated;
revoke all on function public.cancel_schedule_access_request(uuid) from public, anon, authenticated;
revoke all on function public.respond_schedule_access_request(uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_schedule_access_notifications(integer) from public, anon, authenticated;
revoke all on function public.mark_schedule_access_notifications_read() from public, anon, authenticated;

grant execute on function public.search_student_access_directory(text, smallint, text, text) to authenticated;
grant execute on function public.allow_schedule_access(uuid) to authenticated;
grant execute on function public.remove_schedule_access(uuid) to authenticated;
grant execute on function public.request_schedule_access(uuid) to authenticated;
grant execute on function public.cancel_schedule_access_request(uuid) to authenticated;
grant execute on function public.respond_schedule_access_request(uuid, boolean) to authenticated;
grant execute on function public.get_schedule_access_notifications(integer) to authenticated;
grant execute on function public.mark_schedule_access_notifications_read() to authenticated;

revoke all on function public.get_public_schedule_share(uuid) from public, anon, authenticated;
grant execute on function public.get_public_schedule_share(uuid) to anon, authenticated;

-- Realtime is used only as an invalidation signal. RLS still determines which
-- request/grant rows each signed-in client is eligible to receive.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'schedule_access_requests'
    ) then
      alter publication supabase_realtime add table public.schedule_access_requests;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'schedule_access_grants'
    ) then
      alter publication supabase_realtime add table public.schedule_access_grants;
    end if;
  end if;
end;
$$;

comment on table public.schedule_access_grants is
  'One-way schedule viewer permissions that remain active until explicitly revoked.';
comment on table public.schedule_access_requests is
  'Schedule access request lifecycle and requester notification-read state.';
comment on function private.can_view_full_schedule(uuid, uuid) is
  'Allows self, active administrators, profile privacy, qualifying shared classes, or an active one-way manual grant.';
comment on function public.get_public_schedule_share(uuid) is
  'Token-gated API returning course names, teacher last names, A/B days, periods, and academic terms independently of directory privacy.';

notify pgrst, 'reload schema';
