-- Bell schedules, school-day overrides, and bounded newsletter-sync history.
-- The underlying tables live in the non-exposed private schema. Browser and
-- Edge Function callers use the narrow public wrappers defined below.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table private.bell_schedule_definitions (
  id uuid primary key default gen_random_uuid(),
  schedule_key text not null unique
    check (schedule_key ~ '^[a-z0-9][a-z0-9_]{1,62}$'),
  display_name text not null check (char_length(trim(display_name)) between 2 and 100),
  campus_scope text not null check (campus_scope in ('BOTH', 'NAI', 'NASH')),
  warning_time time without time zone,
  is_builtin boolean not null default false,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table private.bell_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references private.bell_schedule_definitions(id) on delete cascade,
  position smallint not null check (position between 1 and 30),
  block_kind text not null check (block_kind in ('class', 'non_class')),
  label text not null check (char_length(trim(label)) between 1 and 80),
  period_number smallint check (period_number between 1 and 9),
  start_time time without time zone not null,
  end_time time without time zone not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint bell_schedule_block_time_order check (start_time < end_time),
  constraint bell_schedule_period_kind check (
    (block_kind = 'class' and period_number is not null)
    or (block_kind = 'non_class' and period_number is null)
  ),
  unique (schedule_id, position)
);

create unique index bell_schedule_blocks_unique_period_idx
  on private.bell_schedule_blocks(schedule_id, period_number)
  where period_number is not null;

create table private.school_year_settings (
  singleton boolean primary key default true check (singleton),
  school_year_start date not null,
  semester_2_start date not null,
  school_year_end date not null,
  default_schedule_id uuid not null references private.bell_schedule_definitions(id),
  school_timezone text not null default 'America/New_York'
    check (school_timezone = 'America/New_York'),
  sync_enabled boolean not null default false,
  sync_time time without time zone not null default time '06:00',
  bell_schedule_document_url text not null,
  newsletter_document_url text not null,
  last_scheduled_claim_date date,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint school_year_date_order check (
    school_year_start < semester_2_start and semester_2_start <= school_year_end
  )
);

create table private.school_day_assignments (
  school_date date not null,
  campus text not null check (campus in ('NAI', 'NASH')),
  day_type text check (day_type in ('A', 'B')),
  no_school boolean not null default false,
  schedule_id uuid references private.bell_schedule_definitions(id),
  source text not null check (source in ('manual', 'ai')),
  manual_locked boolean not null default false,
  evidence text,
  sync_run_id uuid,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (school_date, campus),
  constraint school_day_schedule_state check (
    (no_school and schedule_id is null)
    or (not no_school and schedule_id is not null)
  ),
  constraint school_day_manual_lock_source check (not manual_locked or source = 'manual')
);

create table private.bell_schedule_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (trigger_type in ('scheduled', 'manual', 'preview')),
  status text not null check (status in ('running', 'previewed', 'succeeded', 'skipped', 'failed')),
  actor_id uuid references public.profiles(id) on delete set null,
  claimed_school_date date,
  model_id text,
  source_hash text,
  source_section text,
  raw_gemini_json jsonb,
  validated_extraction jsonb,
  evidence jsonb not null default '[]'::jsonb,
  applied_dates jsonb not null default '[]'::jsonb,
  skipped_dates jsonb not null default '[]'::jsonb,
  error_message text,
  timing_ms integer check (timing_ms is null or timing_ms between 0 and 300000),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

alter table private.school_day_assignments
  add constraint school_day_sync_run_fk foreign key (sync_run_id)
  references private.bell_schedule_sync_runs(id) on delete set null;

create unique index bell_schedule_one_scheduled_claim_per_day_idx
  on private.bell_schedule_sync_runs(claimed_school_date)
  where trigger_type = 'scheduled';
create index school_day_assignments_date_idx on private.school_day_assignments(school_date);
create index bell_schedule_sync_runs_created_idx on private.bell_schedule_sync_runs(created_at desc);

alter table private.bell_schedule_definitions enable row level security;
alter table private.bell_schedule_blocks enable row level security;
alter table private.school_year_settings enable row level security;
alter table private.school_day_assignments enable row level security;
alter table private.bell_schedule_sync_runs enable row level security;

revoke all on table private.bell_schedule_definitions from public, anon, authenticated;
revoke all on table private.bell_schedule_blocks from public, anon, authenticated;
revoke all on table private.school_year_settings from public, anon, authenticated;
revoke all on table private.school_day_assignments from public, anon, authenticated;
revoke all on table private.bell_schedule_sync_runs from public, anon, authenticated;

insert into private.bell_schedule_definitions
  (id, schedule_key, display_name, campus_scope, warning_time, is_builtin)
values
  ('b1000000-0000-4000-8000-000000000001', 'regular', 'Regular', 'BOTH', '07:24', true),
  ('b1000000-0000-4000-8000-000000000002', 'two_hour_delay', '2-Hour Delay', 'BOTH', '09:24', true),
  ('b1000000-0000-4000-8000-000000000003', 'half_day', 'Half-Day', 'BOTH', '07:24', true),
  ('b1000000-0000-4000-8000-000000000004', 'nash_early_dismissal', 'NASH 2-Hour Early Dismissal', 'NASH', '07:24', true),
  ('b1000000-0000-4000-8000-000000000005', 'nai_early_dismissal', 'NAI 2-Hour Early Dismissal', 'NAI', '07:24', true),
  ('b1000000-0000-4000-8000-000000000006', 'activity_1', 'Activity Bell Schedule #1', 'BOTH', '07:24', true),
  ('b1000000-0000-4000-8000-000000000007', 'activity_2', 'Activity Bell Schedule #2', 'BOTH', '07:24', true),
  ('b1000000-0000-4000-8000-000000000008', 'reverse_activity_1', 'Reverse Activity Bell Schedule #1', 'BOTH', '07:24', true),
  ('b1000000-0000-4000-8000-000000000009', 'reverse_activity_2', 'Reverse Activity Bell Schedule #2', 'BOTH', '07:24', true),
  ('b1000000-0000-4000-8000-000000000010', 'reverse_activity_3', 'Reverse Activity Bell Schedule #3', 'BOTH', '07:24', true);

insert into private.bell_schedule_blocks
  (schedule_id, position, block_kind, label, period_number, start_time, end_time)
values
  -- Regular
  ('b1000000-0000-4000-8000-000000000001', 1, 'class', 'Period 1', 1, '07:28', '08:08'),
  ('b1000000-0000-4000-8000-000000000001', 2, 'non_class', 'Homeroom', null, '08:08', '08:21'),
  ('b1000000-0000-4000-8000-000000000001', 3, 'class', 'Period 2', 2, '08:25', '09:05'),
  ('b1000000-0000-4000-8000-000000000001', 4, 'class', 'Period 3', 3, '09:09', '09:49'),
  ('b1000000-0000-4000-8000-000000000001', 5, 'class', 'Period 4', 4, '09:53', '10:33'),
  ('b1000000-0000-4000-8000-000000000001', 6, 'class', 'Period 5', 5, '10:37', '11:17'),
  ('b1000000-0000-4000-8000-000000000001', 7, 'class', 'Period 6', 6, '11:21', '12:01'),
  ('b1000000-0000-4000-8000-000000000001', 8, 'class', 'Period 7', 7, '12:05', '12:45'),
  ('b1000000-0000-4000-8000-000000000001', 9, 'class', 'Period 8', 8, '12:49', '13:29'),
  ('b1000000-0000-4000-8000-000000000001', 10, 'class', 'Period 9', 9, '13:33', '14:15'),
  -- 2-hour delay
  ('b1000000-0000-4000-8000-000000000002', 1, 'class', 'Period 1', 1, '09:28', '09:55'),
  ('b1000000-0000-4000-8000-000000000002', 2, 'non_class', 'Homeroom', null, '09:55', '10:07'),
  ('b1000000-0000-4000-8000-000000000002', 3, 'class', 'Period 2', 2, '10:11', '10:38'),
  ('b1000000-0000-4000-8000-000000000002', 4, 'class', 'Period 3', 3, '10:42', '11:09'),
  ('b1000000-0000-4000-8000-000000000002', 5, 'class', 'Period 4', 4, '11:13', '11:40'),
  ('b1000000-0000-4000-8000-000000000002', 6, 'class', 'Period 5', 5, '11:44', '12:11'),
  ('b1000000-0000-4000-8000-000000000002', 7, 'class', 'Period 6', 6, '12:15', '12:42'),
  ('b1000000-0000-4000-8000-000000000002', 8, 'class', 'Period 7', 7, '12:46', '13:13'),
  ('b1000000-0000-4000-8000-000000000002', 9, 'class', 'Period 8', 8, '13:17', '13:44'),
  ('b1000000-0000-4000-8000-000000000002', 10, 'class', 'Period 9', 9, '13:48', '14:15'),
  -- Half-day
  ('b1000000-0000-4000-8000-000000000003', 1, 'class', 'Period 1', 1, '07:28', '07:51'),
  ('b1000000-0000-4000-8000-000000000003', 2, 'class', 'Period 2', 2, '07:55', '08:18'),
  ('b1000000-0000-4000-8000-000000000003', 3, 'class', 'Period 3', 3, '08:22', '08:45'),
  ('b1000000-0000-4000-8000-000000000003', 4, 'class', 'Period 4', 4, '08:49', '09:12'),
  ('b1000000-0000-4000-8000-000000000003', 5, 'class', 'Period 5', 5, '09:16', '09:39'),
  ('b1000000-0000-4000-8000-000000000003', 6, 'class', 'Period 6', 6, '09:43', '10:06'),
  ('b1000000-0000-4000-8000-000000000003', 7, 'class', 'Period 7', 7, '10:10', '10:33'),
  ('b1000000-0000-4000-8000-000000000003', 8, 'class', 'Period 8', 8, '10:37', '11:00'),
  ('b1000000-0000-4000-8000-000000000003', 9, 'class', 'Period 9', 9, '11:04', '11:25'),
  -- NASH 2-hour early dismissal (periods 8 and 9 occur before 5, 6, and 7)
  ('b1000000-0000-4000-8000-000000000004', 1, 'class', 'Period 1', 1, '07:28', '07:56'),
  ('b1000000-0000-4000-8000-000000000004', 2, 'class', 'Period 2', 2, '08:00', '08:28'),
  ('b1000000-0000-4000-8000-000000000004', 3, 'class', 'Period 3', 3, '08:32', '09:00'),
  ('b1000000-0000-4000-8000-000000000004', 4, 'class', 'Period 4', 4, '09:04', '09:32'),
  ('b1000000-0000-4000-8000-000000000004', 5, 'class', 'Period 8', 8, '09:36', '10:04'),
  ('b1000000-0000-4000-8000-000000000004', 6, 'class', 'Period 9', 9, '10:08', '10:36'),
  ('b1000000-0000-4000-8000-000000000004', 7, 'class', 'Period 5', 5, '10:40', '11:09'),
  ('b1000000-0000-4000-8000-000000000004', 8, 'class', 'Period 6', 6, '11:13', '11:42'),
  ('b1000000-0000-4000-8000-000000000004', 9, 'class', 'Period 7', 7, '11:46', '12:15'),
  -- NAI 2-hour early dismissal
  ('b1000000-0000-4000-8000-000000000005', 1, 'class', 'Period 1', 1, '07:28', '07:55'),
  ('b1000000-0000-4000-8000-000000000005', 2, 'class', 'Period 2', 2, '07:59', '08:26'),
  ('b1000000-0000-4000-8000-000000000005', 3, 'class', 'Period 3', 3, '08:30', '08:57'),
  ('b1000000-0000-4000-8000-000000000005', 4, 'class', 'Period 4', 4, '09:01', '09:28'),
  ('b1000000-0000-4000-8000-000000000005', 5, 'class', 'Period 5', 5, '09:32', '10:02'),
  ('b1000000-0000-4000-8000-000000000005', 6, 'class', 'Period 6', 6, '10:06', '10:36'),
  ('b1000000-0000-4000-8000-000000000005', 7, 'class', 'Period 7', 7, '10:40', '11:10'),
  ('b1000000-0000-4000-8000-000000000005', 8, 'class', 'Period 8', 8, '11:14', '11:44'),
  ('b1000000-0000-4000-8000-000000000005', 9, 'class', 'Period 9', 9, '11:48', '12:15'),
  -- Activity #1
  ('b1000000-0000-4000-8000-000000000006', 1, 'class', 'Period 1', 1, '07:28', '08:06'),
  ('b1000000-0000-4000-8000-000000000006', 2, 'non_class', 'Activity Period', null, '08:06', '08:39'),
  ('b1000000-0000-4000-8000-000000000006', 3, 'class', 'Period 2', 2, '08:43', '09:21'),
  ('b1000000-0000-4000-8000-000000000006', 4, 'class', 'Period 3', 3, '09:25', '10:03'),
  ('b1000000-0000-4000-8000-000000000006', 5, 'class', 'Period 4', 4, '10:07', '10:45'),
  ('b1000000-0000-4000-8000-000000000006', 6, 'class', 'Period 5', 5, '10:49', '11:27'),
  ('b1000000-0000-4000-8000-000000000006', 7, 'class', 'Period 6', 6, '11:31', '12:09'),
  ('b1000000-0000-4000-8000-000000000006', 8, 'class', 'Period 7', 7, '12:13', '12:51'),
  ('b1000000-0000-4000-8000-000000000006', 9, 'class', 'Period 8', 8, '12:55', '13:33'),
  ('b1000000-0000-4000-8000-000000000006', 10, 'class', 'Period 9', 9, '13:37', '14:15'),
  -- Activity #2
  ('b1000000-0000-4000-8000-000000000007', 1, 'class', 'Period 1', 1, '07:28', '08:07'),
  ('b1000000-0000-4000-8000-000000000007', 2, 'non_class', 'Activity Period', null, '08:07', '08:31'),
  ('b1000000-0000-4000-8000-000000000007', 3, 'class', 'Period 2', 2, '08:35', '09:14'),
  ('b1000000-0000-4000-8000-000000000007', 4, 'class', 'Period 3', 3, '09:18', '09:57'),
  ('b1000000-0000-4000-8000-000000000007', 5, 'class', 'Period 4', 4, '10:01', '10:40'),
  ('b1000000-0000-4000-8000-000000000007', 6, 'class', 'Period 5', 5, '10:44', '11:23'),
  ('b1000000-0000-4000-8000-000000000007', 7, 'class', 'Period 6', 6, '11:27', '12:06'),
  ('b1000000-0000-4000-8000-000000000007', 8, 'class', 'Period 7', 7, '12:10', '12:49'),
  ('b1000000-0000-4000-8000-000000000007', 9, 'class', 'Period 8', 8, '12:53', '13:32'),
  ('b1000000-0000-4000-8000-000000000007', 10, 'class', 'Period 9', 9, '13:36', '14:15'),
  -- Reverse Activity #1
  ('b1000000-0000-4000-8000-000000000008', 1, 'class', 'Period 1', 1, '07:28', '08:06'),
  ('b1000000-0000-4000-8000-000000000008', 2, 'class', 'Period 2', 2, '08:10', '08:48'),
  ('b1000000-0000-4000-8000-000000000008', 3, 'class', 'Period 3', 3, '08:52', '09:30'),
  ('b1000000-0000-4000-8000-000000000008', 4, 'class', 'Period 4', 4, '09:34', '10:12'),
  ('b1000000-0000-4000-8000-000000000008', 5, 'class', 'Period 5', 5, '10:16', '10:54'),
  ('b1000000-0000-4000-8000-000000000008', 6, 'class', 'Period 6', 6, '10:58', '11:36'),
  ('b1000000-0000-4000-8000-000000000008', 7, 'class', 'Period 7', 7, '11:40', '12:18'),
  ('b1000000-0000-4000-8000-000000000008', 8, 'class', 'Period 8', 8, '12:22', '13:00'),
  ('b1000000-0000-4000-8000-000000000008', 9, 'class', 'Period 9', 9, '13:04', '13:42'),
  ('b1000000-0000-4000-8000-000000000008', 10, 'non_class', 'Activity Period', null, '13:42', '14:15'),
  -- Reverse Activity #2
  ('b1000000-0000-4000-8000-000000000009', 1, 'class', 'Period 1', 1, '07:28', '08:06'),
  ('b1000000-0000-4000-8000-000000000009', 2, 'non_class', 'Homeroom', null, '08:06', '08:09'),
  ('b1000000-0000-4000-8000-000000000009', 3, 'class', 'Period 2', 2, '08:13', '08:51'),
  ('b1000000-0000-4000-8000-000000000009', 4, 'class', 'Period 3', 3, '08:55', '09:33'),
  ('b1000000-0000-4000-8000-000000000009', 5, 'class', 'Period 4', 4, '09:37', '10:15'),
  ('b1000000-0000-4000-8000-000000000009', 6, 'class', 'Period 5', 5, '10:19', '10:57'),
  ('b1000000-0000-4000-8000-000000000009', 7, 'class', 'Period 6', 6, '11:01', '11:39'),
  ('b1000000-0000-4000-8000-000000000009', 8, 'class', 'Period 7', 7, '11:43', '12:21'),
  ('b1000000-0000-4000-8000-000000000009', 9, 'class', 'Period 8', 8, '12:25', '13:03'),
  ('b1000000-0000-4000-8000-000000000009', 10, 'class', 'Period 9', 9, '13:07', '13:45'),
  ('b1000000-0000-4000-8000-000000000009', 11, 'non_class', 'Activity Period', null, '13:45', '14:15'),
  -- Reverse Activity #3
  ('b1000000-0000-4000-8000-000000000010', 1, 'class', 'Period 1', 1, '07:28', '08:05'),
  ('b1000000-0000-4000-8000-000000000010', 2, 'non_class', 'Homeroom', null, '08:05', '08:07'),
  ('b1000000-0000-4000-8000-000000000010', 3, 'class', 'Period 2', 2, '08:11', '08:48'),
  ('b1000000-0000-4000-8000-000000000010', 4, 'class', 'Period 3', 3, '08:52', '09:29'),
  ('b1000000-0000-4000-8000-000000000010', 5, 'class', 'Period 4', 4, '09:33', '10:10'),
  ('b1000000-0000-4000-8000-000000000010', 6, 'class', 'Period 5', 5, '10:14', '10:51'),
  ('b1000000-0000-4000-8000-000000000010', 7, 'class', 'Period 6', 6, '10:55', '11:32'),
  ('b1000000-0000-4000-8000-000000000010', 8, 'class', 'Period 7', 7, '11:36', '12:13'),
  ('b1000000-0000-4000-8000-000000000010', 9, 'class', 'Period 8', 8, '12:17', '12:54'),
  ('b1000000-0000-4000-8000-000000000010', 10, 'class', 'Period 9', 9, '12:58', '13:35'),
  ('b1000000-0000-4000-8000-000000000010', 11, 'non_class', 'Activity Period', null, '13:35', '14:15');

insert into private.school_year_settings (
  school_year_start,
  semester_2_start,
  school_year_end,
  default_schedule_id,
  sync_time,
  bell_schedule_document_url,
  newsletter_document_url
) values (
  date '2026-08-18',
  date '2027-01-12',
  date '2027-05-28',
  'b1000000-0000-4000-8000-000000000001',
  time '06:00',
  'https://docs.google.com/document/d/1KJr6cJszOP_UQP2ep5GputRwdC4YDYiShc4E-z5naNE/edit',
  'https://docs.google.com/document/d/1eUkh1tDSTTzIVooFoo5JZs0pzUp6GAqdk0DIse96IJU/edit'
);

create or replace function private.validate_bell_schedule_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from private.bell_schedule_blocks block
    where block.schedule_id = new.schedule_id
      and block.id <> new.id
      and new.start_time < block.end_time
      and block.start_time < new.end_time
  ) then
    raise exception 'bell_schedule_blocks_overlap' using errcode = '23514';
  end if;
  if exists (
    select 1
    from private.bell_schedule_blocks block
    where block.schedule_id = new.schedule_id
      and block.id <> new.id
      and (
        (block.position < new.position and block.end_time > new.start_time)
        or (block.position > new.position and block.start_time < new.end_time)
      )
  ) then
    raise exception 'bell_schedule_blocks_out_of_order' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger bell_schedule_blocks_validate
before insert or update on private.bell_schedule_blocks
for each row execute function private.validate_bell_schedule_block();

create or replace function private.bell_schedule_json(schedule_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', schedule.id,
    'schedule_key', schedule.schedule_key,
    'display_name', schedule.display_name,
    'campus_scope', schedule.campus_scope,
    'warning_time', case when schedule.warning_time is null then null else to_char(schedule.warning_time, 'HH24:MI') end,
    'is_builtin', schedule.is_builtin,
    'archived_at', schedule.archived_at,
    'updated_at', schedule.updated_at,
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', block.id,
        'position', block.position,
        'kind', block.block_kind,
        'label', block.label,
        'period_number', block.period_number,
        'start_time', to_char(block.start_time, 'HH24:MI'),
        'end_time', to_char(block.end_time, 'HH24:MI')
      ) order by block.position)
      from private.bell_schedule_blocks block
      where block.schedule_id = schedule.id
    ), '[]'::jsonb)
  )
  from private.bell_schedule_definitions schedule
  where schedule.id = schedule_id;
$$;

create or replace function private.get_my_bell_schedule_window(start_date date, requested_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_grade smallint;
  actor_campus text;
  settings private.school_year_settings%rowtype;
begin
  if not private.is_active_user(actor_id) then
    raise exception 'active_account_required' using errcode = '42501';
  end if;
  if start_date is null or requested_days is null or requested_days < 1 or requested_days > 21 then
    raise exception 'bell_schedule_window_out_of_bounds' using errcode = '22023';
  end if;
  select profile.grade into actor_grade from public.profiles profile where profile.id = actor_id;
  if actor_grade not in (9, 10, 11, 12) then
    raise exception 'profile_grade_required' using errcode = '22023';
  end if;
  actor_campus := case when actor_grade in (9, 10) then 'NAI' else 'NASH' end;
  select * into settings from private.school_year_settings where singleton;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', day.school_date,
      'campus', actor_campus,
      'day_type', assignment.day_type,
      'semester', case when day.school_date >= settings.semester_2_start then 'semester_2' else 'semester_1' end,
      'no_school', case
        when day.school_date < settings.school_year_start or day.school_date > settings.school_year_end then true
        when extract(isodow from day.school_date) in (6, 7) then true
        else coalesce(assignment.no_school, false)
      end,
      'source', coalesce(assignment.source, 'default'),
      'schedule', case
        when day.school_date < settings.school_year_start or day.school_date > settings.school_year_end then null
        when extract(isodow from day.school_date) in (6, 7) then null
        when assignment.no_school then null
        else private.bell_schedule_json(coalesce(assignment.schedule_id, settings.default_schedule_id))
      end
    ) order by day.school_date), '[]'::jsonb)
    from (
      select generate_series(start_date, start_date + requested_days - 1, interval '1 day')::date as school_date
    ) day
    left join private.school_day_assignments assignment
      on assignment.school_date = day.school_date and assignment.campus = actor_campus
  );
end;
$$;

create or replace function public.get_my_bell_schedule_window(p_start_date date, p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select private.get_my_bell_schedule_window(p_start_date, p_days); $$;

create or replace function private.admin_list_bell_schedules()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return (
    select coalesce(jsonb_agg(private.bell_schedule_json(schedule.id)
      order by schedule.is_builtin desc, schedule.display_name), '[]'::jsonb)
    from private.bell_schedule_definitions schedule
  );
end;
$$;

create or replace function public.admin_list_bell_schedules()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select private.admin_list_bell_schedules(); $$;

create or replace function private.admin_save_bell_schedule(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  saved_schedule_id uuid;
  existing private.bell_schedule_definitions%rowtype;
  input_key text := lower(trim(coalesce(payload ->> 'schedule_key', '')));
  input_name text := trim(coalesce(payload ->> 'display_name', ''));
  input_campus text := upper(trim(coalesce(payload ->> 'campus_scope', 'BOTH')));
  warning_text text := nullif(trim(coalesce(payload ->> 'warning_time', '')), '');
  blocks jsonb := payload -> 'blocks';
  block jsonb;
  block_position integer := 0;
  period_value integer;
  start_text text;
  end_text text;
begin
  if payload ? 'id' and nullif(payload ->> 'id', '') is not null then
    saved_schedule_id := (payload ->> 'id')::uuid;
    select * into existing from private.bell_schedule_definitions where id = saved_schedule_id for update;
    if not found then raise exception 'bell_schedule_not_found' using errcode = 'P0002'; end if;
  end if;
  if input_name = '' or char_length(input_name) > 100 then
    raise exception 'invalid_bell_schedule_name' using errcode = '22023';
  end if;
  if input_campus not in ('BOTH', 'NAI', 'NASH') then
    raise exception 'invalid_bell_schedule_campus' using errcode = '22023';
  end if;
  if warning_text is not null and warning_text !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_warning_time' using errcode = '22023';
  end if;
  if jsonb_typeof(blocks) <> 'array' or jsonb_array_length(blocks) < 1 or jsonb_array_length(blocks) > 30 then
    raise exception 'invalid_bell_schedule_blocks' using errcode = '22023';
  end if;

  if saved_schedule_id is null then
    if input_key !~ '^[a-z0-9][a-z0-9_]{1,62}$' then
      raise exception 'invalid_bell_schedule_key' using errcode = '22023';
    end if;
    insert into private.bell_schedule_definitions
      (schedule_key, display_name, campus_scope, warning_time, created_by)
    values (input_key, input_name, input_campus, warning_text::time, actor_id)
    returning id into saved_schedule_id;
  else
    if not existing.is_builtin and input_campus <> existing.campus_scope and exists (
      select 1 from private.school_day_assignments assignment
      where assignment.schedule_id = saved_schedule_id
        and input_campus not in ('BOTH', assignment.campus)
    ) then
      raise exception 'bell_schedule_campus_mismatch' using errcode = '23514';
    end if;
    if not existing.is_builtin and input_campus <> 'BOTH' and exists (
      select 1 from private.school_year_settings settings
      where settings.default_schedule_id = saved_schedule_id
    ) then
      raise exception 'default_bell_schedule_must_cover_both_campuses' using errcode = '23514';
    end if;
    update private.bell_schedule_definitions
    set display_name = input_name,
        campus_scope = case when existing.is_builtin then existing.campus_scope else input_campus end,
        warning_time = warning_text::time,
        updated_at = clock_timestamp()
    where id = saved_schedule_id;
    delete from private.bell_schedule_blocks where bell_schedule_blocks.schedule_id = saved_schedule_id;
  end if;

  for block in select value from jsonb_array_elements(blocks)
  loop
    block_position := block_position + 1;
    period_value := case when block ->> 'period_number' is null or block ->> 'period_number' = ''
      then null else (block ->> 'period_number')::integer end;
    start_text := trim(coalesce(block ->> 'start_time', ''));
    end_text := trim(coalesce(block ->> 'end_time', ''));
    if start_text !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      or end_text !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'invalid_bell_schedule_time' using errcode = '22023';
    end if;
    insert into private.bell_schedule_blocks (
      schedule_id, position, block_kind, label, period_number, start_time, end_time
    ) values (
      saved_schedule_id,
      block_position,
      case when period_value is null then 'non_class' else 'class' end,
      trim(coalesce(block ->> 'label', case when period_value is null then '' else 'Period ' || period_value end)),
      period_value,
      start_text::time,
      end_text::time
    );
  end loop;

  perform private.write_event_log(
    'admin',
    case when existing.id is null then 'bell_schedule_created' else 'bell_schedule_updated' end,
    actor_id,
    null,
    'bell_schedule',
    saved_schedule_id::text,
    'succeeded',
    jsonb_build_object('schedule_key', coalesce(existing.schedule_key, input_key), 'block_count', block_position)
  );
  return saved_schedule_id;
end;
$$;

create or replace function public.admin_save_bell_schedule(p_schedule jsonb)
returns uuid
language sql
security definer
set search_path = ''
as $$ select private.admin_save_bell_schedule(p_schedule); $$;

create or replace function private.admin_archive_bell_schedule(archived_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  schedule private.bell_schedule_definitions%rowtype;
begin
  select * into schedule from private.bell_schedule_definitions where id = archived_schedule_id for update;
  if not found then raise exception 'bell_schedule_not_found' using errcode = 'P0002'; end if;
  if schedule.is_builtin then raise exception 'builtin_bell_schedule_cannot_be_archived' using errcode = '22023'; end if;
  if exists (select 1 from private.school_day_assignments assignment where assignment.schedule_id = archived_schedule_id)
    or exists (select 1 from private.school_year_settings settings where settings.default_schedule_id = archived_schedule_id) then
    raise exception 'bell_schedule_is_in_use' using errcode = '23503';
  end if;
  update private.bell_schedule_definitions set archived_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = archived_schedule_id;
  perform private.write_event_log('admin', 'bell_schedule_archived', actor_id, null, 'bell_schedule', archived_schedule_id::text, 'succeeded', '{}'::jsonb);
end;
$$;

create or replace function public.admin_archive_bell_schedule(p_schedule_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$ select private.admin_archive_bell_schedule(p_schedule_id); $$;

create or replace function private.admin_list_school_days(start_date date, requested_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings private.school_year_settings%rowtype;
begin
  perform private.require_admin();
  if start_date is null or requested_days is null or requested_days < 1 or requested_days > 62 then
    raise exception 'school_day_window_out_of_bounds' using errcode = '22023';
  end if;
  select * into settings from private.school_year_settings where singleton;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', day.school_date,
      'campus', campus.name,
      'day_type', assignment.day_type,
      'no_school', case
        when day.school_date < settings.school_year_start or day.school_date > settings.school_year_end then true
        when extract(isodow from day.school_date) in (6, 7) then true
        else coalesce(assignment.no_school, false)
      end,
      'schedule_id', case
        when day.school_date < settings.school_year_start or day.school_date > settings.school_year_end then null
        when extract(isodow from day.school_date) in (6, 7) then null
        when assignment.no_school then null
        else coalesce(assignment.schedule_id, settings.default_schedule_id)
      end,
      'schedule_key', case
        when day.school_date < settings.school_year_start or day.school_date > settings.school_year_end then null
        when extract(isodow from day.school_date) in (6, 7) then null
        when assignment.no_school then null
        else coalesce(assigned_schedule.schedule_key, default_schedule.schedule_key)
      end,
      'source', coalesce(assignment.source, 'default'),
      'manual_locked', coalesce(assignment.manual_locked, false),
      'evidence', assignment.evidence
    ) order by day.school_date, campus.name), '[]'::jsonb)
    from (
      select generate_series(start_date, start_date + requested_days - 1, interval '1 day')::date as school_date
    ) day
    cross join (values ('NAI'::text), ('NASH'::text)) campus(name)
    left join private.school_day_assignments assignment
      on assignment.school_date = day.school_date and assignment.campus = campus.name
    left join private.bell_schedule_definitions assigned_schedule on assigned_schedule.id = assignment.schedule_id
    join private.bell_schedule_definitions default_schedule on default_schedule.id = settings.default_schedule_id
  );
end;
$$;

create or replace function public.admin_list_school_days(p_start_date date, p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select private.admin_list_school_days(p_start_date, p_days); $$;

create or replace function private.admin_bulk_assign_school_days(
  school_dates date[], campuses text[], next_day_type text, next_no_school boolean, next_schedule_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  settings private.school_year_settings%rowtype;
  schedule private.bell_schedule_definitions%rowtype;
  school_date date;
  campus text;
  changed_count integer := 0;
begin
  if school_dates is null or cardinality(school_dates) < 1 or cardinality(school_dates) > 62
    or campuses is null or cardinality(campuses) < 1 or cardinality(campuses) > 2 then
    raise exception 'school_day_bulk_assignment_out_of_bounds' using errcode = '22023';
  end if;
  if next_day_type is not null and next_day_type not in ('A', 'B') then
    raise exception 'invalid_school_day_type' using errcode = '22023';
  end if;
  if next_no_school and next_schedule_id is not null then
    raise exception 'no_school_cannot_have_schedule' using errcode = '22023';
  end if;
  if not next_no_school and next_schedule_id is null then
    raise exception 'schedule_required_for_school_day' using errcode = '22023';
  end if;
  select * into settings from private.school_year_settings where singleton;
  if next_schedule_id is not null then
    select * into schedule from private.bell_schedule_definitions
    where id = next_schedule_id and archived_at is null;
    if not found then raise exception 'bell_schedule_not_found' using errcode = 'P0002'; end if;
  end if;
  foreach school_date in array school_dates loop
    if school_date < settings.school_year_start or school_date > settings.school_year_end then
      raise exception 'school_day_outside_configured_year' using errcode = '22023';
    end if;
    foreach campus in array campuses loop
      campus := upper(campus);
      if campus not in ('NAI', 'NASH') then
        raise exception 'invalid_school_day_campus' using errcode = '22023';
      end if;
      if next_schedule_id is not null and schedule.campus_scope not in ('BOTH', campus) then
        raise exception 'bell_schedule_campus_mismatch' using errcode = '22023';
      end if;
      insert into private.school_day_assignments (
        school_date, campus, day_type, no_school, schedule_id, source, manual_locked, evidence, updated_by
      ) values (
        school_date, campus, next_day_type, next_no_school, next_schedule_id, 'manual', true,
        'Assigned manually in ScheduleShare', actor_id
      )
      on conflict (school_date, campus) do update
      set day_type = excluded.day_type,
          no_school = excluded.no_school,
          schedule_id = excluded.schedule_id,
          source = 'manual',
          manual_locked = true,
          evidence = excluded.evidence,
          sync_run_id = null,
          updated_by = actor_id,
          updated_at = clock_timestamp();
      changed_count := changed_count + 1;
    end loop;
  end loop;
  perform private.write_event_log(
    'admin', 'school_days_assigned', actor_id, null, 'school_calendar', null, 'succeeded',
    jsonb_build_object('date_count', cardinality(school_dates), 'campuses', campuses, 'row_count', changed_count)
  );
  return changed_count;
end;
$$;

create or replace function public.admin_bulk_assign_school_days(
  p_dates date[], p_campuses text[], p_day_type text, p_no_school boolean, p_schedule_id uuid
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.admin_bulk_assign_school_days(p_dates, p_campuses, p_day_type, p_no_school, p_schedule_id);
$$;

create or replace function private.admin_unlock_school_day_overrides(school_dates date[], campuses text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := private.require_admin(); changed_count integer;
begin
  if school_dates is null or cardinality(school_dates) < 1 or cardinality(school_dates) > 62
    or campuses is null or cardinality(campuses) < 1 or cardinality(campuses) > 2 then
    raise exception 'school_day_bulk_assignment_out_of_bounds' using errcode = '22023';
  end if;
  update private.school_day_assignments assignment
  set manual_locked = false, updated_by = actor_id, updated_at = clock_timestamp()
  where assignment.school_date = any(school_dates) and assignment.campus = any(campuses) and assignment.manual_locked;
  get diagnostics changed_count = row_count;
  perform private.write_event_log('admin', 'school_day_overrides_unlocked', actor_id, null, 'school_calendar', null, 'succeeded', jsonb_build_object('row_count', changed_count));
  return changed_count;
end;
$$;

create or replace function public.admin_unlock_school_day_overrides(p_dates date[], p_campuses text[])
returns integer
language sql
security definer
set search_path = ''
as $$ select private.admin_unlock_school_day_overrides(p_dates, p_campuses); $$;

create or replace function private.admin_clear_school_day_overrides(school_dates date[], campuses text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := private.require_admin(); changed_count integer;
begin
  if school_dates is null or cardinality(school_dates) < 1 or cardinality(school_dates) > 62
    or campuses is null or cardinality(campuses) < 1 or cardinality(campuses) > 2 then
    raise exception 'school_day_bulk_assignment_out_of_bounds' using errcode = '22023';
  end if;
  delete from private.school_day_assignments assignment
  where assignment.school_date = any(school_dates) and assignment.campus = any(campuses);
  get diagnostics changed_count = row_count;
  perform private.write_event_log('admin', 'school_day_overrides_cleared', actor_id, null, 'school_calendar', null, 'succeeded', jsonb_build_object('row_count', changed_count));
  return changed_count;
end;
$$;

create or replace function public.admin_clear_school_day_overrides(p_dates date[], p_campuses text[])
returns integer
language sql
security definer
set search_path = ''
as $$ select private.admin_clear_school_day_overrides(p_dates, p_campuses); $$;

create or replace function private.admin_get_bell_schedule_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return (
    select jsonb_build_object(
      'school_year_start', settings.school_year_start,
      'semester_2_start', settings.semester_2_start,
      'school_year_end', settings.school_year_end,
      'default_schedule_id', settings.default_schedule_id,
      'school_timezone', settings.school_timezone,
      'sync_enabled', settings.sync_enabled,
      'sync_time', to_char(settings.sync_time, 'HH24:MI'),
      'bell_schedule_document_url', settings.bell_schedule_document_url,
      'newsletter_document_url', settings.newsletter_document_url,
      'updated_at', settings.updated_at
    ) from private.school_year_settings settings where singleton
  );
end;
$$;

create or replace function public.admin_get_bell_schedule_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select private.admin_get_bell_schedule_settings(); $$;

create or replace function private.admin_update_bell_schedule_settings(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_admin();
  first_day date := (payload ->> 'school_year_start')::date;
  semester_day date := (payload ->> 'semester_2_start')::date;
  last_day date := (payload ->> 'school_year_end')::date;
  default_id uuid := (payload ->> 'default_schedule_id')::uuid;
  daily_time text := trim(coalesce(payload ->> 'sync_time', ''));
  bell_url text := trim(coalesce(payload ->> 'bell_schedule_document_url', ''));
  newsletter_url text := trim(coalesce(payload ->> 'newsletter_document_url', ''));
begin
  if not (first_day < semester_day and semester_day <= last_day) then
    raise exception 'invalid_school_year_dates' using errcode = '22023';
  end if;
  if daily_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_sync_time' using errcode = '22023';
  end if;
  if bell_url !~ '^https://docs[.]google[.]com/document/d/[A-Za-z0-9_-]+'
    or newsletter_url !~ '^https://docs[.]google[.]com/document/d/[A-Za-z0-9_-]+' then
    raise exception 'invalid_google_docs_url' using errcode = '22023';
  end if;
  if not exists (
    select 1 from private.bell_schedule_definitions schedule
    where schedule.id = default_id and schedule.archived_at is null and schedule.campus_scope = 'BOTH'
  ) then
    raise exception 'invalid_default_bell_schedule' using errcode = '22023';
  end if;
  update private.school_year_settings
  set school_year_start = first_day,
      semester_2_start = semester_day,
      school_year_end = last_day,
      default_schedule_id = default_id,
      sync_enabled = coalesce((payload ->> 'sync_enabled')::boolean, false),
      sync_time = daily_time::time,
      bell_schedule_document_url = bell_url,
      newsletter_document_url = newsletter_url,
      updated_by = actor_id,
      updated_at = clock_timestamp()
  where singleton;
  perform private.write_event_log('admin', 'bell_schedule_settings_updated', actor_id, null, 'bell_schedule_settings', null, 'succeeded', jsonb_build_object('sync_enabled', payload ->> 'sync_enabled', 'sync_time', daily_time));
end;
$$;

create or replace function public.admin_update_bell_schedule_settings(p_settings jsonb)
returns void
language sql
security definer
set search_path = ''
as $$ select private.admin_update_bell_schedule_settings(p_settings); $$;

create or replace function private.admin_list_bell_schedule_sync_runs(requested_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if requested_limit is null or requested_limit < 1 or requested_limit > 50 then
    raise exception 'sync_history_limit_out_of_bounds' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(run) order by run.created_at desc), '[]'::jsonb)
    from (
      select id, trigger_type, status, actor_id, model_id, source_hash, source_section,
        raw_gemini_json, validated_extraction, evidence, applied_dates, skipped_dates,
        error_message, timing_ms, created_at, completed_at
      from private.bell_schedule_sync_runs
      order by created_at desc
      limit requested_limit
    ) run
  );
end;
$$;

create or replace function public.admin_list_bell_schedule_sync_runs(p_limit integer default 25)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select private.admin_list_bell_schedule_sync_runs(p_limit); $$;

create or replace function private.service_claim_bell_schedule_sync(
  actor_id uuid, requested_trigger text, preview_only boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings private.school_year_settings%rowtype;
  local_now timestamp without time zone := timezone('America/New_York', clock_timestamp());
  run_id uuid;
  run_trigger text;
  model_id text;
begin
  if requested_trigger not in ('scheduled', 'manual') then
    raise exception 'invalid_sync_trigger' using errcode = '22023';
  end if;
  if requested_trigger = 'manual' and not private.is_admin(actor_id) then
    raise exception 'administrator_access_required' using errcode = '42501';
  end if;
  if requested_trigger = 'scheduled' and actor_id is not null then
    raise exception 'scheduled_sync_actor_must_be_empty' using errcode = '22023';
  end if;
  select * into settings from private.school_year_settings where singleton for update;
  if requested_trigger = 'scheduled' then
    if not settings.sync_enabled
      or local_now::time < settings.sync_time
      or local_now::time >= settings.sync_time + interval '5 minutes' then
      return jsonb_build_object('claimed', false, 'reason', 'not_due');
    end if;
    if settings.last_scheduled_claim_date = local_now::date then
      return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
    end if;
    update private.school_year_settings set last_scheduled_claim_date = local_now::date where singleton;
  end if;

  run_trigger := case when preview_only then 'preview' else requested_trigger end;
  select import_settings.active_model_id into model_id
  from private.schedule_import_settings import_settings where singleton;
  insert into private.bell_schedule_sync_runs (
    trigger_type, status, actor_id, claimed_school_date, model_id
  ) values (
    run_trigger, 'running', actor_id,
    case when requested_trigger = 'scheduled' then local_now::date else null end,
    model_id
  ) returning id into run_id;

  return jsonb_build_object(
    'claimed', true,
    'run_id', run_id,
    'model_id', model_id,
    'preview', preview_only,
    'school_timezone', settings.school_timezone,
    'school_year_start', settings.school_year_start,
    'school_year_end', settings.school_year_end,
    'bell_schedule_document_url', settings.bell_schedule_document_url,
    'newsletter_document_url', settings.newsletter_document_url
  );
exception
  when unique_violation then
    return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
end;
$$;

create or replace function public.service_claim_bell_schedule_sync(
  p_actor_id uuid, p_trigger text, p_preview boolean default false
)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.service_claim_bell_schedule_sync(p_actor_id, p_trigger, p_preview); $$;

create or replace function private.service_finish_bell_schedule_sync(
  run_id uuid,
  next_status text,
  next_source_hash text,
  next_source_section text,
  next_raw_json jsonb,
  next_validated jsonb,
  next_error text,
  next_timing_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run private.bell_schedule_sync_runs%rowtype;
  settings private.school_year_settings%rowtype;
  item jsonb;
  target_date date;
  target_campus text;
  target_campuses text[];
  campus_name text;
  target_day_type text;
  target_no_school boolean;
  target_schedule_key text;
  target_schedule private.bell_schedule_definitions%rowtype;
  target_evidence text;
  applied jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  evidence_items jsonb := '[]'::jsonb;
  local_today date := timezone('America/New_York', clock_timestamp())::date;
begin
  select * into run from private.bell_schedule_sync_runs where id = run_id for update;
  if not found then raise exception 'bell_schedule_sync_run_not_found' using errcode = 'P0002'; end if;
  if run.status <> 'running' then raise exception 'bell_schedule_sync_run_already_finished' using errcode = '23505'; end if;
  if next_status not in ('previewed', 'succeeded', 'skipped', 'failed') then
    raise exception 'invalid_sync_run_status' using errcode = '22023';
  end if;
  if next_timing_ms is not null and (next_timing_ms < 0 or next_timing_ms > 300000) then
    raise exception 'invalid_sync_run_timing' using errcode = '22023';
  end if;
  if char_length(coalesce(next_source_section, '')) > 50000
    or char_length(coalesce(next_raw_json::text, '')) > 150000
    or char_length(coalesce(next_error, '')) > 2000 then
    raise exception 'sync_run_payload_too_large' using errcode = '22023';
  end if;
  if next_status in ('previewed', 'succeeded')
    and (jsonb_typeof(next_validated) <> 'array' or jsonb_array_length(next_validated) > 30) then
    raise exception 'invalid_sync_extraction' using errcode = '22023';
  end if;
  select * into settings from private.school_year_settings where singleton;

  if next_status = 'succeeded'
    and next_source_hash is not null
    and exists (
      select 1 from private.bell_schedule_sync_runs previous
      where previous.id <> run_id and previous.status = 'succeeded' and previous.source_hash = next_source_hash
    ) then
    next_status := 'skipped';
    skipped := jsonb_build_array(jsonb_build_object('reason', 'unchanged_source'));
  elsif next_status = 'succeeded' and run.trigger_type <> 'preview' then
    for item in select value from jsonb_array_elements(next_validated)
    loop
      begin
        target_date := (item ->> 'date')::date;
        target_campus := upper(trim(coalesce(item ->> 'campus', 'BOTH')));
        target_day_type := nullif(upper(trim(coalesce(item ->> 'day_type', ''))), '');
        target_no_school := coalesce((item ->> 'no_school')::boolean, false);
        target_schedule_key := lower(trim(coalesce(item ->> 'schedule_key', 'regular')));
        target_evidence := left(trim(coalesce(item ->> 'evidence', '')), 500);
        if target_date < settings.school_year_start or target_date > settings.school_year_end
          or target_date < local_today - 14 or target_date > local_today + 35 then
          raise exception 'sync_date_out_of_bounds';
        end if;
        if target_campus not in ('BOTH', 'NAI', 'NASH') then raise exception 'invalid_sync_campus'; end if;
        if target_day_type is not null and target_day_type not in ('A', 'B') then raise exception 'invalid_sync_day_type'; end if;
        if target_evidence = '' then raise exception 'sync_evidence_required'; end if;
        if target_schedule_key = 'activity_1'
          and target_evidence !~* '\mactivity[[:space:]]+period\M' then
          raise exception 'activity_period_evidence_required';
        end if;
        if target_no_school then
          target_schedule.id := null;
        else
          select * into target_schedule from private.bell_schedule_definitions schedule
          where schedule.schedule_key = target_schedule_key and schedule.archived_at is null;
          if not found then raise exception 'unknown_sync_schedule_key'; end if;
        end if;
        target_campuses := case when target_campus = 'BOTH' then array['NAI', 'NASH'] else array[target_campus] end;
        foreach campus_name in array target_campuses loop
          if not target_no_school and target_schedule.campus_scope not in ('BOTH', campus_name) then
            skipped := skipped || jsonb_build_array(jsonb_build_object('date', target_date, 'campus', campus_name, 'reason', 'campus_mismatch'));
            continue;
          end if;
          if exists (
            select 1 from private.school_day_assignments existing
            where existing.school_date = target_date and existing.campus = campus_name and existing.manual_locked
          ) then
            skipped := skipped || jsonb_build_array(jsonb_build_object('date', target_date, 'campus', campus_name, 'reason', 'manual_override'));
            continue;
          end if;
          insert into private.school_day_assignments (
            school_date, campus, day_type, no_school, schedule_id, source, manual_locked,
            evidence, sync_run_id, updated_by
          ) values (
            target_date, campus_name, target_day_type, target_no_school,
            case when target_no_school then null else target_schedule.id end,
            'ai', false, target_evidence, run_id, run.actor_id
          )
          on conflict (school_date, campus) do update
          set day_type = excluded.day_type,
              no_school = excluded.no_school,
              schedule_id = excluded.schedule_id,
              source = 'ai',
              manual_locked = false,
              evidence = excluded.evidence,
              sync_run_id = excluded.sync_run_id,
              updated_by = excluded.updated_by,
              updated_at = clock_timestamp()
          where not school_day_assignments.manual_locked;
          applied := applied || jsonb_build_array(jsonb_build_object('date', target_date, 'campus', campus_name));
        end loop;
        evidence_items := evidence_items || jsonb_build_array(jsonb_build_object('date', target_date, 'evidence', target_evidence));
      exception when others then
        skipped := skipped || jsonb_build_array(jsonb_build_object(
          'date', item ->> 'date', 'campus', item ->> 'campus', 'reason', sqlerrm
        ));
      end;
    end loop;
  elsif next_status = 'previewed' then
    for item in select value from jsonb_array_elements(next_validated)
    loop
      evidence_items := evidence_items || jsonb_build_array(jsonb_build_object('date', item ->> 'date', 'evidence', left(coalesce(item ->> 'evidence', ''), 500)));
    end loop;
  end if;

  update private.bell_schedule_sync_runs
  set status = next_status,
      source_hash = left(next_source_hash, 128),
      source_section = next_source_section,
      raw_gemini_json = next_raw_json,
      validated_extraction = next_validated,
      evidence = evidence_items,
      applied_dates = applied,
      skipped_dates = skipped,
      error_message = left(next_error, 2000),
      timing_ms = next_timing_ms,
      completed_at = clock_timestamp()
  where id = run_id;

  delete from private.bell_schedule_sync_runs old_run
  where old_run.id in (
    select history.id from private.bell_schedule_sync_runs history
    order by history.created_at desc offset 100
  );
  return jsonb_build_object('run_id', run_id, 'status', next_status, 'applied_dates', applied, 'skipped_dates', skipped);
end;
$$;

create or replace function public.service_finish_bell_schedule_sync(
  p_run_id uuid,
  p_status text,
  p_source_hash text,
  p_source_section text,
  p_raw_json jsonb,
  p_validated jsonb,
  p_error text,
  p_timing_ms integer
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.service_finish_bell_schedule_sync(
    p_run_id, p_status, p_source_hash, p_source_section, p_raw_json,
    p_validated, p_error, p_timing_ms
  );
$$;

create or replace function private.invoke_due_bell_schedule_sync()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings private.school_year_settings%rowtype;
  local_now timestamp without time zone := timezone('America/New_York', clock_timestamp());
  project_url text;
  sync_token text;
  request_id bigint;
begin
  select * into settings from private.school_year_settings where singleton;
  if not settings.sync_enabled
    or local_now::time < settings.sync_time
    or local_now::time >= settings.sync_time + interval '5 minutes'
    or settings.last_scheduled_claim_date = local_now::date then
    return null;
  end if;
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'bell_schedule_project_url' limit 1;
  select decrypted_secret into sync_token from vault.decrypted_secrets where name = 'bell_schedule_sync_token' limit 1;
  if nullif(trim(project_url), '') is null or nullif(trim(sync_token), '') is null then return null; end if;
  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/bell-schedule-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bell-schedule-sync-token', sync_token),
    body := jsonb_build_object('trigger', 'scheduled')
  ) into request_id;
  return request_id;
end;
$$;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'bell-schedule-sync-due-check' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'bell-schedule-sync-due-check',
    '*/5 * * * *',
    'select private.invoke_due_bell_schedule_sync();'
  );
end;
$$;

-- New-school-year reset clears calendar overrides and extraction history while
-- retaining built-in/custom definitions and sync configuration.
drop function public.super_admin_get_site_reset_preview();
drop function private.get_site_reset_preview();

create or replace function private.get_site_reset_preview()
returns table (
  accounts bigint,
  profiles bigint,
  classes bigint,
  course_names bigint,
  enrollments bigint,
  reports bigint,
  profile_pictures bigint,
  calendar_assignments bigint,
  sync_runs bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := private.require_super_admin();
begin
  return query select
    (select count(*) from auth.users where id <> actor_id)::bigint,
    (select count(*) from public.profiles)::bigint,
    (select count(*) from public.classes)::bigint,
    0::bigint,
    (select count(*) from public.class_enrollments)::bigint,
    (select count(*) from public.reports)::bigint,
    (select count(*) from storage.objects where bucket_id = 'profile-pictures')::bigint,
    (select count(*) from private.school_day_assignments)::bigint,
    (select count(*) from private.bell_schedule_sync_runs)::bigint;
end;
$$;

create or replace function public.super_admin_get_site_reset_preview()
returns table (
  accounts bigint,
  profiles bigint,
  classes bigint,
  course_names bigint,
  enrollments bigint,
  reports bigint,
  profile_pictures bigint,
  calendar_assignments bigint,
  sync_runs bigint
)
language sql
security definer
set search_path = ''
as $$ select * from private.get_site_reset_preview(); $$;

create or replace function private.reset_site_data(actor_id uuid, confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_initial_name text;
  actor_snapshot text;
  reset_counts jsonb;
begin
  perform private.require_super_admin(actor_id);
  if confirmation <> 'RESET SCHEDULESHARE KEEP MY ADMIN ACCOUNT AND COURSE NAMES' then
    raise exception 'site_reset_confirmation_mismatch' using errcode = '22023';
  end if;
  select profile.full_name into actor_snapshot from public.profiles profile where profile.id = actor_id;
  select coalesce(
    nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
    nullif(auth_user.raw_user_meta_data ->> 'name', ''),
    'New Student'
  ) into actor_initial_name from auth.users auth_user where auth_user.id = actor_id;
  if actor_initial_name is null then raise exception 'site_reset_actor_not_found' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'accounts', (select count(*) from auth.users where id <> actor_id),
    'profiles', (select count(*) from public.profiles),
    'classes', (select count(*) from public.classes),
    'course_names', 0,
    'enrollments', (select count(*) from public.class_enrollments),
    'reports', (select count(*) from public.reports),
    'calendar_assignments', (select count(*) from private.school_day_assignments),
    'sync_runs', (select count(*) from private.bell_schedule_sync_runs)
  ) into reset_counts;

  perform set_config('app.suppress_event_logs', 'on', true);
  delete from private.school_day_assignments where true;
  delete from private.bell_schedule_sync_runs where true;
  update private.school_year_settings set last_scheduled_claim_date = null where singleton;
  delete from public.reports where true;
  delete from public.schedule_access_requests where true;
  delete from public.schedule_access_grants where true;
  delete from public.schedule_share_links where true;
  delete from public.classes where true;
  delete from public.schedule_change_history where true;
  delete from private.schedule_import_diagnostic_logs where true;
  delete from private.schedule_import_rate_limits where true;
  delete from private.schedule_import_guest_rate_limits where true;
  delete from private.rate_limit_events where true;
  delete from private.user_activity_metrics where true;
  delete from auth.users where id <> actor_id;

  update public.profiles
  set full_name = actor_initial_name,
      grade = null,
      privacy_setting = 'classmates',
      onboarding_completed = false,
      students_visited_at = null,
      last_login_at = null,
      last_active_at = null,
      created_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = actor_id;

  insert into private.account_moderation (user_id)
  values (actor_id)
  on conflict (user_id) do update
  set suspended_at = null, suspended_by = null, suspension_reason = null,
      deleted_at = null, updated_at = clock_timestamp();
  insert into private.user_roles (user_id, role, granted_by)
  values (actor_id, 'administrator', actor_id)
  on conflict (user_id) do nothing;

  perform set_config('app.suppress_event_logs', 'off', true);
  insert into public.event_logs (
    log_category, event_type, actor_user_id, actor_name, target_type, result, metadata
  ) values (
    'admin', 'site_reset_completed', actor_id, actor_snapshot, 'site', 'succeeded', reset_counts
  );
  return reset_counts;
end;
$$;

comment on function private.reset_site_data(uuid, text) is
  'Resets user content, school-day overrides, and bell-sync history while preserving the initiator, course catalog, bell definitions, and bell/sync configuration.';

revoke all on function private.validate_bell_schedule_block() from public, anon, authenticated;
revoke all on function private.bell_schedule_json(uuid) from public, anon, authenticated;
revoke all on function private.get_my_bell_schedule_window(date, integer) from public, anon, authenticated;
revoke all on function private.admin_list_bell_schedules() from public, anon, authenticated;
revoke all on function private.admin_save_bell_schedule(jsonb) from public, anon, authenticated;
revoke all on function private.admin_archive_bell_schedule(uuid) from public, anon, authenticated;
revoke all on function private.admin_list_school_days(date, integer) from public, anon, authenticated;
revoke all on function private.admin_bulk_assign_school_days(date[], text[], text, boolean, uuid) from public, anon, authenticated;
revoke all on function private.admin_unlock_school_day_overrides(date[], text[]) from public, anon, authenticated;
revoke all on function private.admin_clear_school_day_overrides(date[], text[]) from public, anon, authenticated;
revoke all on function private.admin_get_bell_schedule_settings() from public, anon, authenticated;
revoke all on function private.admin_update_bell_schedule_settings(jsonb) from public, anon, authenticated;
revoke all on function private.admin_list_bell_schedule_sync_runs(integer) from public, anon, authenticated;
revoke all on function private.service_claim_bell_schedule_sync(uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.service_finish_bell_schedule_sync(uuid, text, text, text, jsonb, jsonb, text, integer) from public, anon, authenticated;
revoke all on function private.invoke_due_bell_schedule_sync() from public, anon, authenticated;
revoke all on function private.get_site_reset_preview() from public, anon, authenticated;

revoke all on function public.get_my_bell_schedule_window(date, integer) from public, anon, authenticated;
revoke all on function public.admin_list_bell_schedules() from public, anon, authenticated;
revoke all on function public.admin_save_bell_schedule(jsonb) from public, anon, authenticated;
revoke all on function public.admin_archive_bell_schedule(uuid) from public, anon, authenticated;
revoke all on function public.admin_list_school_days(date, integer) from public, anon, authenticated;
revoke all on function public.admin_bulk_assign_school_days(date[], text[], text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.admin_unlock_school_day_overrides(date[], text[]) from public, anon, authenticated;
revoke all on function public.admin_clear_school_day_overrides(date[], text[]) from public, anon, authenticated;
revoke all on function public.admin_get_bell_schedule_settings() from public, anon, authenticated;
revoke all on function public.admin_update_bell_schedule_settings(jsonb) from public, anon, authenticated;
revoke all on function public.admin_list_bell_schedule_sync_runs(integer) from public, anon, authenticated;
revoke all on function public.service_claim_bell_schedule_sync(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.service_finish_bell_schedule_sync(uuid, text, text, text, jsonb, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.super_admin_get_site_reset_preview() from public, anon, authenticated;

grant execute on function public.get_my_bell_schedule_window(date, integer) to authenticated;
grant execute on function public.admin_list_bell_schedules() to authenticated;
grant execute on function public.admin_save_bell_schedule(jsonb) to authenticated;
grant execute on function public.admin_archive_bell_schedule(uuid) to authenticated;
grant execute on function public.admin_list_school_days(date, integer) to authenticated;
grant execute on function public.admin_bulk_assign_school_days(date[], text[], text, boolean, uuid) to authenticated;
grant execute on function public.admin_unlock_school_day_overrides(date[], text[]) to authenticated;
grant execute on function public.admin_clear_school_day_overrides(date[], text[]) to authenticated;
grant execute on function public.admin_get_bell_schedule_settings() to authenticated;
grant execute on function public.admin_update_bell_schedule_settings(jsonb) to authenticated;
grant execute on function public.admin_list_bell_schedule_sync_runs(integer) to authenticated;
grant execute on function public.super_admin_get_site_reset_preview() to authenticated;
grant execute on function public.service_claim_bell_schedule_sync(uuid, text, boolean) to service_role;
grant execute on function public.service_finish_bell_schedule_sync(uuid, text, text, text, jsonb, jsonb, text, integer) to service_role;

comment on function public.get_my_bell_schedule_window(date, integer) is
  'Returns at most 21 resolved school days for the signed-in student; campus is derived from profile grade.';
comment on function public.admin_save_bell_schedule(jsonb) is
  'Creates a custom bell schedule or updates a definition after minute-level, ordering, overlap, and period validation.';

notify pgrst, 'reload schema';
