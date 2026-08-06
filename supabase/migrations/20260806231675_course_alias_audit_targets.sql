-- Alias changes belong to their parent catalogue course in the existing audit
-- schema. Keep the alias id and value inside the before/after payload.
create or replace function private.admin_add_course_name_alias(
  target_course_name_id uuid,
  input_alias text,
  action_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  normalized_input text := private.normalize_search(input_alias);
  created_alias_id uuid;
begin
  if char_length(trim(coalesce(action_reason, ''))) < 3 then
    raise exception 'course_alias_reason_required' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.course_names course
    where course.id = target_course_name_id and course.status <> 'merged'
  ) then
    raise exception 'course_name_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.course_names course
    where course.normalized_name = normalized_input and course.status <> 'merged'
  ) then
    raise exception 'alias_conflicts_with_course_name' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.course_name_aliases alias_record
    where alias_record.normalized_alias = normalized_input
  ) then
    raise exception 'course_alias_already_exists' using errcode = '23505';
  end if;

  created_alias_id := private.upsert_course_name_alias(
    target_course_name_id,
    input_alias,
    'admin',
    null,
    actor_id,
    false
  );
  if created_alias_id is null then
    raise exception 'invalid_course_alias' using errcode = '23514';
  end if;

  perform private.write_audit(
    actor_id,
    'course_alias_created',
    'course_name',
    target_course_name_id::text,
    null,
    jsonb_build_object(
      'alias_id', created_alias_id,
      'alias', private.normalize_course_display(input_alias)
    ),
    action_reason
  );
  return created_alias_id;
end;
$$;

create or replace function private.admin_delete_course_name_alias(
  target_alias_id uuid,
  action_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  before_data jsonb;
  parent_course_name_id uuid;
begin
  if char_length(trim(coalesce(action_reason, ''))) < 3 then
    raise exception 'course_alias_reason_required' using errcode = '23514';
  end if;
  select to_jsonb(alias_record), alias_record.course_name_id
    into before_data, parent_course_name_id
  from public.course_name_aliases alias_record
  where alias_record.id = target_alias_id
  for update;
  if not found then
    raise exception 'course_alias_not_found' using errcode = 'P0002';
  end if;

  delete from public.course_name_aliases where id = target_alias_id;
  perform private.write_audit(
    actor_id,
    'course_alias_deleted',
    'course_name',
    parent_course_name_id::text,
    before_data,
    null,
    action_reason
  );
end;
$$;
