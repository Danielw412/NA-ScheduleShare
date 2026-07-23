-- Lunch and Study Hall do not have a classroom teacher. Enforce N/A at
-- the database boundary so manual entry, imports, and admin edits stay consistent.

create or replace function private.special_course_teacher_not_applicable(target_course_name_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    regexp_replace(
      replace(lower(trim(course_name.name)), '-', ' '),
      '[[:space:]]+',
      ' ',
      'g'
    ) in (
      'lunch',
      'lunch nai',
      'lunch nash',
      'study hall',
      'study hall nai',
      'study hall nash'
    ),
    false
  )
  from public.course_names course_name
  where course_name.id = target_course_name_id;
$$;

create or replace function private.force_special_course_teacher_na()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.special_course_teacher_not_applicable(new.course_name_id) then
    new.teacher_last_name := 'N/A';
    new.normalized_teacher_last_name := private.normalize_search('N/A');
  end if;
  return new;
end;
$$;

drop trigger if exists force_special_course_teacher_na on public.classes;
create trigger force_special_course_teacher_na
before insert or update of course_name_id, teacher_last_name, normalized_teacher_last_name
on public.classes
for each row execute function private.force_special_course_teacher_na();

update public.classes class_record
set teacher_last_name = 'N/A',
    normalized_teacher_last_name = private.normalize_search('N/A')
where private.special_course_teacher_not_applicable(class_record.course_name_id)
  and (
    class_record.teacher_last_name is distinct from 'N/A'
    or class_record.normalized_teacher_last_name is distinct from private.normalize_search('N/A')
  );

revoke all on function private.special_course_teacher_not_applicable(uuid) from public, anon, authenticated;
revoke all on function private.force_special_course_teacher_na() from public, anon, authenticated;

comment on function private.special_course_teacher_not_applicable(uuid) is
  'Returns true for campus Lunch and Study Hall catalogue entries whose class teacher must be N/A.';
