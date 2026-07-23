alter table public.profiles
add column students_visited_at timestamptz;

grant update (students_visited_at) on table public.profiles to authenticated;

comment on column public.profiles.students_visited_at is
  'First time the student opened the Students tab; used to choose the next schedule-page prompt.';
