-- NA ClassMatch core schema. Public tables are API-facing and receive RLS in a later migration.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create type public.privacy_setting as enum ('private', 'classmates', 'school');
create type public.academic_term as enum ('full_year', 'semester_1', 'semester_2');
create type public.day_type as enum ('A', 'B');
create type public.class_status as enum ('active', 'archived', 'merged');
create type public.schedule_action as enum (
  'class_added',
  'class_removed',
  'class_replaced',
  'term_changed',
  'meeting_slots_changed',
  'admin_schedule_change'
);
create type public.report_reason as enum (
  'suspicious_user',
  'inappropriate_name',
  'incorrect_class_information',
  'duplicate_class',
  'other'
);
create type public.report_status as enum ('open', 'in_review', 'resolved', 'dismissed');
create type private.app_role as enum ('administrator');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'New Student' check (char_length(full_name) between 2 and 100),
  normalized_name text not null default 'new student',
  grade smallint check (grade in (9, 10, 11, 12)),
  privacy_setting public.privacy_setting not null default 'classmates',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.account_moderation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  suspended_at timestamptz,
  suspended_by uuid references public.profiles(id) on delete set null,
  suspension_reason text check (suspension_reason is null or char_length(suspension_reason) <= 1000),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((suspended_at is null) = (suspension_reason is null))
);

create table private.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role private.app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  class_name text not null check (char_length(class_name) between 2 and 120),
  normalized_class_name text not null,
  teacher_name text not null check (char_length(teacher_name) between 2 and 120),
  normalized_teacher_name text not null,
  default_academic_term public.academic_term not null default 'full_year',
  is_double_period boolean not null default false,
  status public.class_status not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.class_meeting_slots (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  day_type public.day_type not null,
  period_number smallint not null check (period_number between 1 and 8),
  created_at timestamptz not null default now(),
  unique (class_id, day_type, period_number)
);

create table public.class_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  academic_term public.academic_term not null default 'full_year',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, class_id)
);

create table public.schedule_change_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles(id) on delete set null,
  action public.schedule_action not null,
  previous_value jsonb,
  new_value jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reported_class_id uuid references public.classes(id) on delete set null,
  reason_category public.report_reason not null,
  explanation text check (explanation is null or char_length(explanation) <= 2000),
  status public.report_status not null default 'open',
  assigned_admin_id uuid references public.profiles(id) on delete set null,
  resolution_notes text check (resolution_notes is null or char_length(resolution_notes) <= 4000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (reported_user_id is not null or reported_class_id is not null or reason_category = 'other'),
  check ((status in ('resolved', 'dismissed')) = (resolved_at is not null))
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  administrator_id uuid references public.profiles(id) on delete set null,
  action_type text not null check (char_length(action_type) between 2 and 100),
  target_type text not null check (target_type in ('user', 'class', 'report', 'role', 'enrollment')),
  target_id text,
  before_values jsonb,
  after_values jsonb,
  reason text check (reason is null or char_length(reason) <= 2000),
  created_at timestamptz not null default now()
);

create table private.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_key text not null check (char_length(action_key) between 2 and 80),
  created_at timestamptz not null default now()
);

create index profiles_grade_idx on public.profiles(grade);
create index profiles_normalized_name_trgm_idx on public.profiles using gin (normalized_name extensions.gin_trgm_ops);
create index classes_normalized_name_trgm_idx on public.classes using gin (normalized_class_name extensions.gin_trgm_ops);
create index classes_normalized_teacher_trgm_idx on public.classes using gin (normalized_teacher_name extensions.gin_trgm_ops);
create index classes_active_name_idx on public.classes(normalized_class_name) where status = 'active';
create index class_slots_lookup_idx on public.class_meeting_slots(day_type, period_number, class_id);
create index enrollments_student_active_idx on public.class_enrollments(student_id, active, class_id);
create index enrollments_class_active_idx on public.class_enrollments(class_id, active, student_id);
create index enrollments_shared_class_idx on public.class_enrollments(student_id, class_id) where active;
create index history_student_created_idx on public.schedule_change_history(student_id, created_at desc);
create index reports_open_created_idx on public.reports(created_at desc) where status in ('open', 'in_review');
create index reports_user_idx on public.reports(reported_user_id, created_at desc) where reported_user_id is not null;
create index reports_class_idx on public.reports(reported_class_id, created_at desc) where reported_class_id is not null;
create index audit_created_idx on public.audit_logs(created_at desc);
create index audit_target_idx on public.audit_logs(target_type, target_id, created_at desc);
create index rate_limit_user_action_idx on private.rate_limit_events(user_id, action_key, created_at desc);

create or replace function private.normalize_search(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(trim(coalesce(value, '')), '\s+', ' ', 'g'));
$$;

create or replace function private.normalize_display(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized text;
begin
  normalized := initcap(regexp_replace(trim(coalesce(value, '')), '\s+', ' ', 'g'));
  normalized := regexp_replace(normalized, '\mAp\M', 'AP', 'g');
  normalized := regexp_replace(normalized, '\mIb\M', 'IB', 'g');
  normalized := regexp_replace(normalized, '\mUs\M', 'US', 'g');
  normalized := regexp_replace(normalized, '\mIii\M', 'III', 'g');
  normalized := regexp_replace(normalized, '\mIi\M', 'II', 'g');
  normalized := regexp_replace(normalized, '\mIv\M', 'IV', 'g');
  return normalized;
end;
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger classes_set_updated_at before update on public.classes
for each row execute function private.set_updated_at();
create trigger enrollments_set_updated_at before update on public.class_enrollments
for each row execute function private.set_updated_at();
create trigger moderation_set_updated_at before update on private.account_moderation
for each row execute function private.set_updated_at();

create or replace function private.normalize_profile_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := private.normalize_display(new.full_name);
  new.normalized_name := private.normalize_search(new.full_name);
  return new;
end;
$$;

create trigger profiles_normalize before insert or update of full_name on public.profiles
for each row execute function private.normalize_profile_fields();

create or replace function private.normalize_class_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.class_name := private.normalize_display(new.class_name);
  new.teacher_name := private.normalize_display(new.teacher_name);
  new.normalized_class_name := private.normalize_search(new.class_name);
  new.normalized_teacher_name := private.normalize_search(new.teacher_name);
  return new;
end;
$$;

create trigger classes_normalize before insert or update of class_name, teacher_name on public.classes
for each row execute function private.normalize_class_fields();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_name text;
begin
  initial_name := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), 'New Student');
  insert into public.profiles (id, full_name)
  values (new.id, initial_name)
  on conflict (id) do nothing;

  insert into private.account_moderation (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function private.validate_double_period_slots()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_class_id uuid;
  target_is_double boolean;
begin
  if tg_table_name = 'classes' then
    target_class_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_class_id := case when tg_op = 'DELETE' then old.class_id else new.class_id end;
  end if;
  select is_double_period into target_is_double from public.classes where id = target_class_id and status = 'active';
  if coalesce(target_is_double, false) and not exists (
    select 1
    from public.class_meeting_slots first_slot
    join public.class_meeting_slots second_slot
      on second_slot.class_id = first_slot.class_id
     and second_slot.day_type = first_slot.day_type
     and second_slot.period_number = first_slot.period_number + 1
    where first_slot.class_id = target_class_id
  ) then
    raise exception 'double_period_requires_consecutive_slots' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger validate_slots_after_class_change
after insert or update of is_double_period on public.classes
deferrable initially deferred
for each row execute function private.validate_double_period_slots();

create constraint trigger validate_slots_after_slot_change
after insert or update or delete on public.class_meeting_slots
deferrable initially deferred
for each row execute function private.validate_double_period_slots();

comment on table public.classes is 'Shared class definitions. Student membership is stored separately in class_enrollments.';
comment on table public.class_meeting_slots is 'Validated A/B-day period rows; meeting slots are never stored as free-form text.';
comment on table public.class_enrollments is 'Student membership in a shared class, including the student-specific academic term.';
comment on schema private is 'Non-exposed roles, moderation state, rate limits, and privileged implementation functions.';
