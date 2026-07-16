-- Use one owner-based predicate for roster RPCs, profile discovery, and direct
-- enrollment reads. This prevents class membership from bypassing the owner's
-- privacy setting while allowing a classmate relationship from any active class
-- to authorize every roster row owned by that student.

create or replace function private.can_view_roster_member(viewer_id uuid, member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user(viewer_id)
    and (
      viewer_id = member_id
      or private.is_admin(viewer_id)
      or (
        private.is_active_user(member_id)
        and exists (
          select 1
          from public.profiles p
          where p.id = member_id
            and (
              p.privacy_setting = 'school'
              or (
                p.privacy_setting = 'classmates'
                and private.shares_active_class(viewer_id, member_id)
              )
            )
        )
      )
    );
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

drop policy if exists profiles_select_permitted on public.profiles;
create policy profiles_select_permitted
on public.profiles
for select
to authenticated
using (private.can_view_roster_member((select auth.uid()), id));

drop policy if exists enrollments_select_privacy_enforced on public.class_enrollments;
create policy enrollments_select_privacy_enforced
on public.class_enrollments
for select
to authenticated
using (private.can_view_roster_member((select auth.uid()), student_id));

-- Class definitions and meeting slots are not student-private data. Active users
-- may inspect them even before creating a schedule; roster rows remain filtered.
drop policy if exists classes_select_after_schedule_started on public.classes;
drop policy if exists classes_select_active_users on public.classes;
create policy classes_select_active_users
on public.classes
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and status = 'active'
);

drop policy if exists class_slots_select_after_schedule_started on public.class_meeting_slots;
drop policy if exists class_slots_select_active_users on public.class_meeting_slots;
create policy class_slots_select_active_users
on public.class_meeting_slots
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and exists (
    select 1
    from public.classes c
    where c.id = class_id and c.status = 'active'
  )
);

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
    from public.classes c
    where c.id = target_class_id and c.status = 'active'
  ) then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;

  return query
  select p.id,
         p.full_name,
         p.grade,
         p.privacy_setting,
         private.can_view_full_schedule(actor_id, p.id)
  from public.class_enrollments e
  join public.profiles p on p.id = e.student_id
  where e.class_id = target_class_id
    and e.active
    and private.can_view_roster_member(actor_id, p.id)
  order by p.full_name;
end;
$$;

create or replace function private.get_classmates()
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_course_names jsonb,
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
         jsonb_agg(distinct cn.name order by cn.name),
         private.can_view_full_schedule(actor_id, p.id)
  from public.class_enrollments mine
  join public.class_enrollments theirs
    on theirs.class_id = mine.class_id
   and theirs.active
   and theirs.student_id <> actor_id
  join public.classes c on c.id = mine.class_id and c.status = 'active'
  join public.course_names cn on cn.id = c.course_name_id
  join public.profiles p on p.id = theirs.student_id
  where mine.student_id = actor_id
    and mine.active
    and private.can_view_roster_member(actor_id, p.id)
  group by p.id, p.full_name, p.grade, p.privacy_setting
  order by count(distinct mine.class_id) desc, p.full_name;
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
    and private.can_view_roster_member(actor_id, p.id)
    and (target_user_id is null or p.id = target_user_id)
    and (
      target_user_id is not null
      or normalized_query = ''
      or p.normalized_name like '%' || normalized_query || '%'
    )
  order by p.full_name
  limit least(greatest(result_limit, 1), 50);
end;
$$;

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
      and private.can_view_roster_member(actor_id, p.id)
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

  insert into public.reports (
    reporter_id,
    reported_user_id,
    reported_class_id,
    reason_category,
    explanation
  )
  values (
    actor_id,
    target_user_id,
    target_class_id,
    target_reason,
    nullif(trim(target_explanation), '')
  )
  returning id into report_id;
  return report_id;
end;
$$;

revoke all on function private.can_view_roster_member(uuid, uuid) from public, anon;
grant execute on function private.can_view_roster_member(uuid, uuid) to authenticated;

comment on function private.can_view_roster_member(uuid, uuid) is
  'Owner-based roster visibility: self/admin; Anyone; or Classmates when the viewer shares any active class. Private members remain hidden from other regular users.';
comment on policy enrollments_select_privacy_enforced on public.class_enrollments is
  'Direct enrollment reads use the same owner-based privacy predicate as roster RPCs; class membership never bypasses Private.';
