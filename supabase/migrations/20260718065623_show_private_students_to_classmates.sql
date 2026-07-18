-- Private schedules remain hidden, but students who share an active class may
-- still identify one another and see only the course names they have in common.

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
    and private.is_active_user(p.id)
    and (
      private.can_view_roster_member(actor_id, p.id)
      or private.is_enrolled_in_class(actor_id, target_class_id)
    )
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
    and private.is_active_user(p.id)
  group by p.id, p.full_name, p.grade, p.privacy_setting
  order by count(distinct mine.class_id) desc, p.full_name;
end;
$$;
comment on function private.get_class_members(uuid) is
  'Returns a class roster. Private students are identified only to members of that same class, and can_view_schedule remains false.';
comment on function private.get_classmates() is
  'Returns active classmates and only their shared course names. Private students remain unable to expose their full schedules.';
