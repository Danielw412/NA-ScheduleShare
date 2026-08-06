-- Add reusable alternate names for each catalogue course and learn aliases from
-- reviewed schedule imports when the user's final correction identifies one
-- unambiguous canonical course.

create table public.course_name_aliases (
  id uuid primary key default gen_random_uuid(),
  course_name_id uuid not null references public.course_names(id) on delete cascade,
  alias text not null check (char_length(alias) between 2 and 160),
  normalized_alias text not null,
  source text not null default 'admin' check (source in ('admin', 'import_correction', 'migration', 'system')),
  source_import_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  learned_count integer not null default 1 check (learned_count > 0),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index course_name_aliases_normalized_alias_key
  on public.course_name_aliases(normalized_alias);
create index course_name_aliases_course_name_id_idx
  on public.course_name_aliases(course_name_id);
create index course_name_aliases_normalized_alias_trgm_idx
  on public.course_name_aliases using gin (normalized_alias extensions.gin_trgm_ops);

alter table public.course_name_aliases enable row level security;
revoke all on table public.course_name_aliases from public, anon, authenticated;
grant select on table public.course_name_aliases to anon, authenticated;

create policy course_name_aliases_select_active_catalogue
on public.course_name_aliases
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.course_names course
    where course.id = course_name_aliases.course_name_id
      and course.status = 'active'
  )
);

create or replace function private.normalize_course_alias_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  conflicting_course_id uuid;
begin
  new.alias := private.normalize_course_display(new.alias);
  if char_length(new.alias) not between 2 and 160 then
    raise exception 'invalid_course_alias' using errcode = '23514';
  end if;
  new.normalized_alias := private.normalize_search(new.alias);
  if new.normalized_alias = '' then
    raise exception 'invalid_course_alias' using errcode = '23514';
  end if;

  select course.id
    into conflicting_course_id
  from public.course_names course
  where course.normalized_name = new.normalized_alias
    and course.status <> 'merged'
  limit 1;

  if conflicting_course_id = new.course_name_id then
    raise exception 'alias_matches_canonical_name' using errcode = '23505';
  elsif conflicting_course_id is not null then
    raise exception 'alias_conflicts_with_course_name' using errcode = '23505';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger normalize_course_name_alias_fields
before insert or update of alias, course_name_id on public.course_name_aliases
for each row execute function private.normalize_course_alias_fields();

create or replace function private.prevent_course_name_alias_collision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'merged' and exists (
    select 1
    from public.course_name_aliases alias_record
    where alias_record.normalized_alias = new.normalized_name
      and alias_record.course_name_id <> new.id
  ) then
    raise exception 'course_name_conflicts_with_alias' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger prevent_course_name_alias_collision
before insert or update of name, normalized_name, status on public.course_names
for each row execute function private.prevent_course_name_alias_collision();

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
    target_course_name_id, display_alias, normalized_input, alias_source, import_id, actor_id
  )
  returning id into existing_alias_id;

  if write_learning_event then
    perform private.write_event_log(
      'import',
      'course_alias_learned',
      actor_id,
      actor_id,
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
    'course_name_alias',
    created_alias_id::text,
    null,
    jsonb_build_object('course_name_id', target_course_name_id, 'alias', private.normalize_course_display(input_alias)),
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
begin
  if char_length(trim(coalesce(action_reason, ''))) < 3 then
    raise exception 'course_alias_reason_required' using errcode = '23514';
  end if;
  select to_jsonb(alias_record)
    into before_data
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
    'course_name_alias',
    target_alias_id::text,
    before_data,
    null,
    action_reason
  );
end;
$$;

create or replace function public.admin_add_course_name_alias(
  p_course_name_id uuid,
  p_alias text,
  p_reason text
)
returns uuid
language sql
set search_path = ''
as $$
  select private.admin_add_course_name_alias(p_course_name_id, p_alias, p_reason);
$$;

create or replace function public.admin_delete_course_name_alias(
  p_alias_id uuid,
  p_reason text
)
returns void
language sql
set search_path = ''
as $$
  select private.admin_delete_course_name_alias(p_alias_id, p_reason);
$$;

revoke all on function public.admin_add_course_name_alias(uuid, text, text) from public, anon;
revoke all on function public.admin_delete_course_name_alias(uuid, text) from public, anon;
grant execute on function public.admin_add_course_name_alias(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_delete_course_name_alias(uuid, text) to authenticated, service_role;

-- The return type changes to include aliases, so replace both layers explicitly.
drop function public.admin_list_course_names();
drop function private.admin_list_course_names();

create function private.admin_list_course_names()
returns table(
  course_name_id uuid,
  course_name text,
  status public.course_name_status,
  source text,
  section_count bigint,
  active_section_count bigint,
  alias_count bigint,
  aliases jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select course.id,
         course.name,
         course.status,
         course.source,
         count(distinct class_record.id),
         count(distinct class_record.id) filter (where class_record.status = 'active'),
         count(distinct alias_record.id),
         coalesce(
           jsonb_agg(
             distinct jsonb_build_object(
               'id', alias_record.id,
               'alias', alias_record.alias,
               'source', alias_record.source,
               'source_import_id', alias_record.source_import_id,
               'learned_count', alias_record.learned_count,
               'last_seen_at', alias_record.last_seen_at,
               'created_at', alias_record.created_at
             )
           ) filter (where alias_record.id is not null),
           '[]'::jsonb
         ),
         course.created_at,
         course.updated_at
  from public.course_names course
  left join public.classes class_record on class_record.course_name_id = course.id
  left join public.course_name_aliases alias_record on alias_record.course_name_id = course.id
  group by course.id
  order by course.name;
end;
$$;

create function public.admin_list_course_names()
returns table(
  course_name_id uuid,
  course_name text,
  status public.course_name_status,
  source text,
  section_count bigint,
  active_section_count bigint,
  alias_count bigint,
  aliases jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select * from private.admin_list_course_names();
$$;

revoke all on function public.admin_list_course_names() from public, anon;
grant execute on function public.admin_list_course_names() to authenticated, service_role;

-- Preserve previous canonical labels when an administrator renames a course.
create or replace function private.admin_rename_course_name(
  target_course_name_id uuid,
  next_name text,
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
  after_data jsonb;
  old_name text;
  next_normalized text := private.normalize_search(next_name);
begin
  if char_length(trim(coalesce(action_reason, ''))) < 3 then
    raise exception 'course_name_reason_required' using errcode = '23514';
  end if;
  select to_jsonb(course), course.name
    into before_data, old_name
  from public.course_names course
  where course.id = target_course_name_id
  for update;
  if not found then
    raise exception 'course_name_not_found' using errcode = 'P0002';
  end if;

  -- A course may be renamed back to one of its own aliases.
  delete from public.course_name_aliases alias_record
  where alias_record.course_name_id = target_course_name_id
    and alias_record.normalized_alias = next_normalized;

  update public.course_names set name = next_name where id = target_course_name_id;
  perform private.upsert_course_name_alias(
    target_course_name_id,
    old_name,
    'system',
    null,
    actor_id,
    false
  );

  select to_jsonb(course) into after_data
  from public.course_names course where course.id = target_course_name_id;
  perform private.write_audit(
    actor_id,
    'course_name_renamed',
    'course_name',
    target_course_name_id::text,
    before_data,
    after_data,
    action_reason
  );
end;
$$;

-- Merge all aliases and preserve the duplicate canonical label as another alias.
create or replace function private.admin_merge_course_names(
  canonical_course_name_id uuid,
  duplicate_course_name_id uuid,
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
  canonical_status public.course_name_status;
  duplicate_status public.course_name_status;
  canonical_normalized text;
  duplicate_name text;
begin
  if canonical_course_name_id = duplicate_course_name_id then
    raise exception 'merge_requires_two_course_names' using errcode = '23514';
  end if;
  perform 1 from public.course_names
  where id in (canonical_course_name_id, duplicate_course_name_id)
  order by id for update;
  if (select count(*) from public.course_names where id in (canonical_course_name_id, duplicate_course_name_id)) <> 2 then
    raise exception 'course_name_not_found' using errcode = 'P0002';
  end if;
  select status, normalized_name into canonical_status, canonical_normalized
  from public.course_names where id = canonical_course_name_id;
  select status, name into duplicate_status, duplicate_name
  from public.course_names where id = duplicate_course_name_id;
  if canonical_status <> 'active' or duplicate_status = 'merged' then
    raise exception 'invalid_course_name_merge_status' using errcode = '23514';
  end if;
  if char_length(trim(coalesce(action_reason, ''))) < 3 then
    raise exception 'course_name_reason_required' using errcode = '23514';
  end if;

  select jsonb_build_object(
    'canonical', (select to_jsonb(course) from public.course_names course where course.id = canonical_course_name_id),
    'duplicate', (select to_jsonb(course) from public.course_names course where course.id = duplicate_course_name_id),
    'section_count', (select count(*) from public.classes class_record where class_record.course_name_id = duplicate_course_name_id),
    'alias_count', (select count(*) from public.course_name_aliases alias_record where alias_record.course_name_id = duplicate_course_name_id)
  ) into before_data;

  delete from public.course_name_aliases alias_record
  where alias_record.course_name_id = duplicate_course_name_id
    and alias_record.normalized_alias = canonical_normalized;
  update public.course_name_aliases
     set course_name_id = canonical_course_name_id,
         updated_at = now()
   where course_name_id = duplicate_course_name_id;
  update public.classes set course_name_id = canonical_course_name_id
  where course_name_id = duplicate_course_name_id;
  update public.course_names set status = 'merged'
  where id = duplicate_course_name_id;
  perform private.upsert_course_name_alias(
    canonical_course_name_id,
    duplicate_name,
    'system',
    null,
    actor_id,
    false
  );

  perform private.write_audit(
    actor_id,
    'course_names_merged',
    'course_name',
    canonical_course_name_id::text,
    before_data,
    jsonb_build_object(
      'canonical_course_name_id', canonical_course_name_id,
      'duplicate_course_name_id', duplicate_course_name_id
    ),
    action_reason
  );
end;
$$;
