-- Keep masked student-directory entries identifiable without exposing the
-- hidden last name. Authorized entries continue to return the full name.
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
           when strpos(trim(profile.full_name), ' ') > 0 then split_part(trim(profile.full_name), ' ', 1) || ' ' || left(regexp_replace(trim(profile.full_name), '^.*\s+', ''), 1) || '.'
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
          when strpos(trim(profile.full_name), ' ') > 0 then split_part(trim(profile.full_name), ' ', 1) || ' ' || left(regexp_replace(trim(profile.full_name), '^.*\s+', ''), 1) || '.'
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

comment on function private.search_student_access_directory(text, smallint, text, text)
  is 'Lists active students with full names for authorized entries and first name plus last initial for masked entries.';

notify pgrst, 'reload schema';
