-- Guest-safe discovery, configurable real homepage statistics, and grade-change enforcement.
-- Anonymous callers receive only deliberately shaped aggregate or redacted data from these RPCs.

create table private.homepage_statistic_settings (
  singleton boolean primary key default true check (singleton),
  shown boolean not null default false,
  statistic_key text not null default 'students_joined'
    check (statistic_key in ('students_joined', 'schedules_uploaded', 'class_connections')),
  minimum_value bigint not null default 25 check (minimum_value between 0 and 1000000000),
  activity_scope text not null default 'total'
    check (activity_scope in ('total', 'recent')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table private.homepage_statistic_settings enable row level security;
revoke all on table private.homepage_statistic_settings from public, anon, authenticated;

insert into private.homepage_statistic_settings (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.audit_logs drop constraint if exists audit_logs_target_type_check;
alter table public.audit_logs add constraint audit_logs_target_type_check
check (target_type in (
  'user',
  'class',
  'course_name',
  'report',
  'role',
  'enrollment',
  'ai_model_config',
  'ai_diagnostic_log',
  'homepage_settings'
));

create or replace function private.guest_search_students(
  first_name_query text,
  result_limit integer default 12
)
returns table (
  first_name text,
  last_initial text,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text := trim(coalesce(first_name_query, ''));
  safe_limit integer := least(greatest(coalesce(result_limit, 12), 1), 20);
begin
  if char_length(normalized_query) < 2 or char_length(normalized_query) > 40 then
    raise exception 'guest_first_name_query_length' using errcode = '22023';
  end if;
  if normalized_query !~ '^[[:alpha:]''-]+$' then
    raise exception 'guest_first_name_query_invalid' using errcode = '22023';
  end if;

  return query
  select split_part(trim(p.full_name), ' ', 1),
         case
           when strpos(trim(p.full_name), ' ') > 0
             then left(regexp_replace(trim(p.full_name), '^.*\s+', ''), 1)
           else ''
         end,
         split_part(trim(p.full_name), ' ', 1)
           || case
                when strpos(trim(p.full_name), ' ') > 0
                  then ' ' || left(regexp_replace(trim(p.full_name), '^.*\s+', ''), 1) || '.'
                else ''
              end
  from public.profiles p
  join private.account_moderation moderation on moderation.user_id = p.id
  where p.onboarding_completed
    and p.grade is not null
    and p.privacy_setting = 'school'
    and moderation.suspended_at is null
    and moderation.deleted_at is null
    and lower(split_part(trim(p.full_name), ' ', 1)) = lower(normalized_query)
  order by lower(split_part(trim(p.full_name), ' ', 1)), p.id
  limit safe_limit;
end;
$$;

create or replace function public.guest_search_students(
  p_first_name text,
  p_limit integer default 12
)
returns table (
  first_name text,
  last_initial text,
  display_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.guest_search_students(p_first_name, p_limit);
$$;

create or replace function private.get_homepage_statistic()
returns table (
  statistic_key text,
  activity_scope text,
  statistic_value bigint,
  statistic_label text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings private.homepage_statistic_settings%rowtype;
  calculated_value bigint := 0;
  recent_cutoff timestamptz := now() - interval '30 days';
begin
  select * into settings
  from private.homepage_statistic_settings
  where singleton;

  if not found or not settings.shown then
    return;
  end if;

  if settings.statistic_key = 'students_joined' then
    select count(*) into calculated_value
    from public.profiles profile
    join private.account_moderation moderation on moderation.user_id = profile.id
    where profile.onboarding_completed
      and profile.grade is not null
      and moderation.suspended_at is null
      and moderation.deleted_at is null
      and (settings.activity_scope = 'total' or profile.created_at >= recent_cutoff);
  elsif settings.statistic_key = 'schedules_uploaded' then
    select count(distinct enrollment.student_id) into calculated_value
    from public.class_enrollments enrollment
    join public.profiles profile on profile.id = enrollment.student_id
    join private.account_moderation moderation on moderation.user_id = profile.id
    where enrollment.active
      and profile.onboarding_completed
      and moderation.suspended_at is null
      and moderation.deleted_at is null
      and (
        settings.activity_scope = 'total'
        or greatest(enrollment.created_at, enrollment.updated_at) >= recent_cutoff
      );
  else
    select count(*) into calculated_value
    from (
      select first_enrollment.class_id, first_enrollment.student_id, second_enrollment.student_id
      from public.class_enrollments first_enrollment
      join public.class_enrollments second_enrollment
        on second_enrollment.class_id = first_enrollment.class_id
       and second_enrollment.student_id > first_enrollment.student_id
       and second_enrollment.active
      join public.classes class_record
        on class_record.id = first_enrollment.class_id
       and class_record.status = 'active'
      join public.profiles first_profile on first_profile.id = first_enrollment.student_id
      join public.profiles second_profile on second_profile.id = second_enrollment.student_id
      join private.account_moderation first_moderation on first_moderation.user_id = first_profile.id
      join private.account_moderation second_moderation on second_moderation.user_id = second_profile.id
      where first_enrollment.active
        and first_profile.onboarding_completed
        and second_profile.onboarding_completed
        and first_moderation.suspended_at is null
        and first_moderation.deleted_at is null
        and second_moderation.suspended_at is null
        and second_moderation.deleted_at is null
        and (
          settings.activity_scope = 'total'
          or greatest(first_enrollment.updated_at, second_enrollment.updated_at) >= recent_cutoff
        )
    ) connections;
  end if;

  if calculated_value < settings.minimum_value then
    return;
  end if;

  return query
  select settings.statistic_key,
         settings.activity_scope,
         calculated_value,
         case settings.statistic_key
           when 'students_joined' then 'NA students joined'
           when 'schedules_uploaded' then 'schedules uploaded'
           else 'class connections found'
         end;
end;
$$;

create or replace function public.get_homepage_statistic()
returns table (
  statistic_key text,
  activity_scope text,
  statistic_value bigint,
  statistic_label text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_homepage_statistic();
$$;

create or replace function private.admin_get_homepage_statistic_settings()
returns table (
  shown boolean,
  statistic_key text,
  minimum_value bigint,
  activity_scope text,
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
  select settings.shown,
         settings.statistic_key,
         settings.minimum_value,
         settings.activity_scope,
         settings.updated_at
  from private.homepage_statistic_settings settings
  where settings.singleton;
end;
$$;

create or replace function public.admin_get_homepage_statistic_settings()
returns table (
  shown boolean,
  statistic_key text,
  minimum_value bigint,
  activity_scope text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_get_homepage_statistic_settings();
$$;

create or replace function private.admin_update_homepage_statistic_settings(
  next_shown boolean,
  next_statistic_key text,
  next_minimum_value bigint,
  next_activity_scope text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  before_data jsonb;
  after_data jsonb;
begin
  actor_id := private.require_admin();
  if next_statistic_key not in ('students_joined', 'schedules_uploaded', 'class_connections') then
    raise exception 'invalid_homepage_statistic' using errcode = '22023';
  end if;
  if next_activity_scope not in ('total', 'recent') then
    raise exception 'invalid_homepage_activity_scope' using errcode = '22023';
  end if;
  if next_minimum_value < 0 or next_minimum_value > 1000000000 then
    raise exception 'invalid_homepage_minimum' using errcode = '22023';
  end if;

  select to_jsonb(settings) into before_data
  from private.homepage_statistic_settings settings
  where settings.singleton
  for update;

  update private.homepage_statistic_settings
  set shown = next_shown,
      statistic_key = next_statistic_key,
      minimum_value = next_minimum_value,
      activity_scope = next_activity_scope,
      updated_by = actor_id,
      updated_at = now()
  where singleton;

  select to_jsonb(settings) into after_data
  from private.homepage_statistic_settings settings
  where settings.singleton;

  perform private.write_audit(
    actor_id,
    'homepage_statistic_settings_changed',
    'homepage_settings',
    'homepage-statistic',
    before_data,
    after_data,
    'Updated homepage social-proof settings'
  );
end;
$$;

create or replace function public.admin_update_homepage_statistic_settings(
  p_shown boolean,
  p_statistic_key text,
  p_minimum_value bigint,
  p_activity_scope text
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_update_homepage_statistic_settings(
    p_shown,
    p_statistic_key,
    p_minimum_value,
    p_activity_scope
  );
$$;

create or replace function private.enforce_admin_only_grade_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if old.grade is not distinct from new.grade then
    return new;
  end if;

  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if actor_id = new.id
    and old.grade is null
    and new.grade is not null
    and not old.onboarding_completed
    and new.onboarding_completed then
    return new;
  end if;

  if actor_id is not null and private.is_admin(actor_id) then
    return new;
  end if;

  raise exception 'grade_changes_require_administrator' using errcode = '42501';
end;
$$;

drop trigger if exists profiles_enforce_admin_grade_changes on public.profiles;
create trigger profiles_enforce_admin_grade_changes
before update of grade on public.profiles
for each row execute function private.enforce_admin_only_grade_changes();

revoke all on function private.guest_search_students(text, integer) from public, anon, authenticated;
revoke all on function private.get_homepage_statistic() from public, anon, authenticated;
revoke all on function private.admin_get_homepage_statistic_settings() from public, anon, authenticated;
revoke all on function private.admin_update_homepage_statistic_settings(boolean, text, bigint, text) from public, anon, authenticated;
revoke all on function private.enforce_admin_only_grade_changes() from public, anon, authenticated;

revoke all on function public.guest_search_students(text, integer) from public, anon, authenticated;
revoke all on function public.get_homepage_statistic() from public, anon, authenticated;
revoke all on function public.admin_get_homepage_statistic_settings() from public, anon, authenticated;
revoke all on function public.admin_update_homepage_statistic_settings(boolean, text, bigint, text) from public, anon, authenticated;

grant usage on schema private to anon;
grant execute on function private.guest_search_students(text, integer) to anon;
grant execute on function private.get_homepage_statistic() to anon, authenticated;
grant execute on function private.admin_get_homepage_statistic_settings() to authenticated;
grant execute on function private.admin_update_homepage_statistic_settings(boolean, text, bigint, text) to authenticated;

grant execute on function public.guest_search_students(text, integer) to anon;
grant execute on function public.get_homepage_statistic() to anon, authenticated;
grant execute on function public.admin_get_homepage_statistic_settings() to authenticated;
grant execute on function public.admin_update_homepage_statistic_settings(boolean, text, bigint, text) to authenticated;

comment on function public.guest_search_students(text, integer) is
  'Guest-only bounded exact first-name search. Returns no stable user identifier and only redacted first-name/last-initial display fields for active Anyone profiles.';
comment on function public.get_homepage_statistic() is
  'Returns at most one configured social-proof aggregate, calculated from real database activity and hidden below the configured threshold.';
comment on trigger profiles_enforce_admin_grade_changes on public.profiles is
  'Students may set their initial grade while completing onboarding; later grade changes require an administrator.';
