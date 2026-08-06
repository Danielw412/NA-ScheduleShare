-- Search canonical labels and aliases, but always return the canonical course.
create or replace function private.search_course_names(search_query text default '', result_limit integer default 20)
returns table(course_name_id uuid, course_name text, course_term_policy public.course_term_policy, score real)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text := private.normalize_search(left(coalesce(search_query, ''), 100));
begin
  perform private.require_active_user();
  return query
  with searchable_names as (
    select course.id, course.name, course.term_policy, course.normalized_name as searchable_name
    from public.course_names course
    where course.status = 'active'
    union all
    select course.id, course.name, course.term_policy, alias_record.normalized_alias
    from public.course_names course
    join public.course_name_aliases alias_record on alias_record.course_name_id = course.id
    where course.status = 'active'
  ), ranked as (
    select candidate.id,
           candidate.name,
           candidate.term_policy,
           max((
             case when normalized_query = '' then 10
                  else extensions.similarity(candidate.searchable_name, normalized_query) * 40 end
             + case when candidate.searchable_name = normalized_query then 50 else 0 end
             + case when candidate.searchable_name like normalized_query || '%' then 20 else 0 end
           )::real) as match_score
    from searchable_names candidate
    where normalized_query = ''
       or candidate.searchable_name like '%' || normalized_query || '%'
       or candidate.searchable_name operator(extensions.%) normalized_query
    group by candidate.id, candidate.name, candidate.term_policy
  )
  select ranked.id, ranked.name, ranked.term_policy, ranked.match_score
  from ranked
  order by ranked.match_score desc, ranked.name
  limit least(greatest(coalesce(result_limit, 20), 1), 50);
end;
$$;

create or replace function public.guest_search_course_names(p_query text default '', p_limit integer default 20)
returns table(course_name_id uuid, course_name text, course_term_policy public.course_term_policy, score real)
language sql
stable
security definer
set search_path = ''
as $$
  with input as (
    select private.normalize_search(left(coalesce(p_query, ''), 100)) as normalized_query
  ), searchable_names as (
    select course.id, course.name, course.term_policy, course.normalized_name as searchable_name
    from public.course_names course
    where course.status = 'active'
    union all
    select course.id, course.name, course.term_policy, alias_record.normalized_alias
    from public.course_names course
    join public.course_name_aliases alias_record on alias_record.course_name_id = course.id
    where course.status = 'active'
  ), ranked as (
    select candidate.id,
           candidate.name,
           candidate.term_policy,
           max((
             case when input.normalized_query = '' then 10
                  else extensions.similarity(candidate.searchable_name, input.normalized_query) * 40 end
             + case when candidate.searchable_name = input.normalized_query then 50 else 0 end
           )::real) as match_score
    from searchable_names candidate
    cross join input
    where input.normalized_query = ''
       or candidate.searchable_name like '%' || input.normalized_query || '%'
       or candidate.searchable_name operator(extensions.%) input.normalized_query
    group by candidate.id, candidate.name, candidate.term_policy
  )
  select ranked.id, ranked.name, ranked.term_policy, ranked.match_score
  from ranked
  order by ranked.match_score desc, ranked.name
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
