create index course_name_aliases_created_by_idx
  on public.course_name_aliases(created_by)
  where created_by is not null;
