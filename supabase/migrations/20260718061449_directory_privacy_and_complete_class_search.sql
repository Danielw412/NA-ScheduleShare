-- Return the complete active class catalog to authenticated class browsing.
-- The Data API is configured for at most 1,000 rows, which is sufficient for
-- the school's complete catalog while still bounding the query.
create or replace function private.search_classes(
  search_query text default '',
  search_day_type public.day_type default null,
  search_period_number smallint default null,
  result_limit integer default 20
)
returns table (
  class_id uuid,
  course_name_id uuid,
  course_name text,
  teacher_last_name text,
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
declare normalized_query text := private.normalize_search(search_query);
begin
  perform private.require_active_user();
  return query
  select c.id,
         cn.id,
         cn.name,
         c.teacher_last_name,
         c.default_academic_term,
         c.is_double_period,
         jsonb_agg(jsonb_build_object('day_type', s.day_type, 'period_number', s.period_number) order by s.day_type, s.period_number),
         (
           case when search_day_type is not null and search_period_number is not null
             and bool_or(s.day_type = search_day_type and s.period_number = search_period_number) then 50 else 0 end
           + case when normalized_query = '' then 10 else greatest(
             extensions.similarity(cn.normalized_name, normalized_query),
             extensions.similarity(c.normalized_teacher_last_name, normalized_query)
           ) * 40 end
           + case when cn.normalized_name = normalized_query then 30 else 0 end
         )::real
  from public.classes c
  join public.course_names cn on cn.id = c.course_name_id
  join public.class_meeting_slots s on s.class_id = c.id
  where c.status = 'active'
    and (
      normalized_query = ''
      or cn.normalized_name like '%' || normalized_query || '%'
      or c.normalized_teacher_last_name like '%' || normalized_query || '%'
      or cn.normalized_name operator(extensions.%) normalized_query
      or c.normalized_teacher_last_name operator(extensions.%) normalized_query
    )
    and (
      (search_day_type is null and search_period_number is null)
      or exists (
        select 1 from public.class_meeting_slots filter_slot
        where filter_slot.class_id = c.id
          and (search_day_type is null or filter_slot.day_type = search_day_type)
          and (search_period_number is null or filter_slot.period_number = search_period_number)
      )
    )
  group by c.id, cn.id
  order by 8 desc, cn.name, c.teacher_last_name
  limit least(greatest(coalesce(result_limit, 20), 1), 1000);
end;
$$;

comment on function private.search_classes(text, public.day_type, smallint, integer)
  is 'Searches up to the complete 1,000-row active class catalog for an authenticated student.';

-- Keep every active student discoverable in the student directory while
-- revealing only the first name when the caller cannot view that schedule.
-- Schedule-derived filters are evaluated only for authorized viewers so they
-- cannot be used to infer a private student's classes.
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
         case
           when visibility.allowed then p.full_name
           else split_part(trim(p.full_name), ' ', 1)
         end,
         p.grade,
         p.privacy_setting,
         case
           when visibility.allowed then (
             select count(distinct mine.class_id)
             from public.class_enrollments mine
             join public.class_enrollments theirs
               on theirs.class_id = mine.class_id
              and theirs.active
             where mine.student_id = actor_id
               and mine.active
               and theirs.student_id = p.id
           )
           else 0::bigint
         end,
         visibility.allowed
  from public.profiles p
  cross join lateral (
    select private.can_view_full_schedule(actor_id, p.id) as allowed
  ) visibility
  where p.id <> actor_id
    and private.is_active_user(p.id)
    and p.grade is not null
    and (
      name_query is null
      or private.normalize_search(
        case
          when visibility.allowed then p.full_name
          else split_part(trim(p.full_name), ' ', 1)
        end
      ) like '%' || private.normalize_search(name_query) || '%'
    )
    and (grade_filter is null or p.grade = grade_filter)
    and (
      class_filter is null
      or (
        visibility.allowed
        and exists (
          select 1
          from public.class_enrollments e
          join public.classes c on c.id = e.class_id
          join public.course_names cn on cn.id = c.course_name_id
          where e.student_id = p.id
            and e.active
            and cn.normalized_name like '%' || private.normalize_search(class_filter) || '%'
        )
      )
    )
    and (
      teacher_filter is null
      or (
        visibility.allowed
        and exists (
          select 1
          from public.class_enrollments e
          join public.classes c on c.id = e.class_id
          where e.student_id = p.id
            and e.active
            and c.normalized_teacher_last_name like '%' || private.normalize_search(teacher_filter) || '%'
        )
      )
    )
  order by 2, p.id
  limit 200;
end;
$$;

comment on function private.search_student_directory(text, smallint, text, text)
  is 'Lists active students, masking unauthorized entries to first name and preventing schedule-filter inference.';

notify pgrst, 'reload schema';
