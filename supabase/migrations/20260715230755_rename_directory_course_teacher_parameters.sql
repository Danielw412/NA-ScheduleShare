drop function if exists public.search_student_directory(text, smallint, text, text);

create function public.search_student_directory(
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
  can_view_schedule boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.search_student_directory(p_query, p_grade, p_course_name, p_teacher_last_name);
$$;

revoke all on function public.search_student_directory(text, smallint, text, text) from public, anon;
grant execute on function public.search_student_directory(text, smallint, text, text) to authenticated;

comment on function public.search_student_directory(text, smallint, text, text)
  is 'Searches discoverable students by name, grade, linked course name, or teacher last name.';

notify pgrst, 'reload schema';
