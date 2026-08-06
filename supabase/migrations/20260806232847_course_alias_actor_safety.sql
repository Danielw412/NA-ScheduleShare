-- Historical import logs can outlive the user profile that created them. Keep
-- the import source while leaving created_by and event actors null in that case.
create or replace function private.upsert_course_name_alias(
  target_course_name_id uuid,
  input_alias text,
  alias_source text,
  import_id uuid default null,
  actor_id uuid default null,
  write_learning_event boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  display_alias text := private.normalize_course_display(input_alias);
  normalized_input text := private.normalize_search(input_alias);
  canonical_normalized text;
  canonical_status public.course_name_status;
  existing_alias_id uuid;
  existing_course_id uuid;
  effective_actor_id uuid := case
    when exists (select 1 from public.profiles profile where profile.id = actor_id) then actor_id
    else null
  end;
begin
  if alias_source not in ('admin', 'import_correction', 'migration', 'system') then
    raise exception 'invalid_course_alias_source' using errcode = '23514';
  end if;
  if char_length(display_alias) not between 2 and 160 or normalized_input = '' then
    return null;
  end if;

  select course.normalized_name, course.status
    into canonical_normalized, canonical_status
  from public.course_names course
  where course.id = target_course_name_id;

  if not found or canonical_status = 'merged' or normalized_input = canonical_normalized then
    return null;
  end if;

  if exists (
    select 1
    from public.course_names course
    where course.normalized_name = normalized_input
      and course.status <> 'merged'
  ) then
    return null;
  end if;

  select alias_record.id, alias_record.course_name_id
    into existing_alias_id, existing_course_id
  from public.course_name_aliases alias_record
  where alias_record.normalized_alias = normalized_input
  for update;

  if existing_alias_id is not null then
    if existing_course_id <> target_course_name_id then
      return null;
    end if;
    update public.course_name_aliases
       set learned_count = learned_count + case when alias_source = 'import_correction' then 1 else 0 end,
           last_seen_at = now(),
           source_import_id = coalesce(import_id, source_import_id),
           updated_at = now()
     where id = existing_alias_id;
    return existing_alias_id;
  end if;

  insert into public.course_name_aliases (
    course_name_id, alias, normalized_alias, source, source_import_id, created_by
  ) values (
    target_course_name_id, display_alias, normalized_input, alias_source, import_id, effective_actor_id
  )
  returning id into existing_alias_id;

  if write_learning_event then
    perform private.write_event_log(
      'import',
      'course_alias_learned',
      effective_actor_id,
      effective_actor_id,
      'course_name',
      target_course_name_id::text,
      'succeeded',
      jsonb_build_object(
        'alias_id', existing_alias_id,
        'alias', display_alias,
        'import_id', import_id,
        'source', alias_source
      )
    );
  end if;

  return existing_alias_id;
end;
$$;

revoke all on function private.upsert_course_name_alias(uuid, text, text, uuid, uuid, boolean)
  from public, anon, authenticated;
