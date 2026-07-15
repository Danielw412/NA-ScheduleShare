-- pg_trgm is installed in the extensions schema while this security-definer
-- function intentionally has an empty search_path. Qualify the trigram
-- operators explicitly so PostgreSQL can resolve them at execution time.
-- When both slot filters are supplied, require one meeting-slot row to match
-- the complete day/period pair used by the Add Class dialog.
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
      or c.normalized_class_name operator(extensions.%) normalized_query
      or c.normalized_teacher_name operator(extensions.%) normalized_query)
    and (
      (search_day_type is null and search_period_number is null)
      or exists (
        select 1
        from public.class_meeting_slots filter_slot
        where filter_slot.class_id = c.id
          and (search_day_type is null or filter_slot.day_type = search_day_type)
          and (search_period_number is null or filter_slot.period_number = search_period_number)
      )
    )
  group by c.id
  order by score desc, c.class_name, c.teacher_name
  limit least(greatest(result_limit, 1), 50);
end;
$$;
