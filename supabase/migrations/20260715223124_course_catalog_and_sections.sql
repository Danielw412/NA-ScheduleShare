-- Separate reusable course names from specific class sections without resetting data.
-- The approved catalog is imported idempotently, existing sections are relinked, and
-- ambiguous legacy labels are preserved as disabled catalog rows for administrator review.

create type public.course_name_status as enum ('active', 'disabled', 'merged');

create table public.course_names (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  normalized_name text not null,
  status public.course_name_status not null default 'active',
  source text not null default 'user' check (source in ('approved', 'legacy', 'user', 'admin')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index course_names_normalized_name_key on public.course_names(normalized_name);
create index course_names_normalized_name_trgm_idx on public.course_names using gin (normalized_name extensions.gin_trgm_ops);
create index course_names_active_name_idx on public.course_names(normalized_name) where status = 'active';

create or replace function private.normalize_course_display(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(trim(coalesce(value, '')), '\s+', ' ', 'g');
$$;

create or replace function private.normalize_course_match(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized text := private.normalize_search(value);
begin
  normalized := regexp_replace(normalized, '\mviii\M', '8', 'g');
  normalized := regexp_replace(normalized, '\mvii\M', '7', 'g');
  normalized := regexp_replace(normalized, '\mvi\M', '6', 'g');
  normalized := regexp_replace(normalized, '\miv\M', '4', 'g');
  normalized := regexp_replace(normalized, '\mv\M', '5', 'g');
  normalized := regexp_replace(normalized, '\miii\M', '3', 'g');
  normalized := regexp_replace(normalized, '\mii\M', '2', 'g');
  normalized := regexp_replace(normalized, '\mi\M', '1', 'g');
  if normalized = 'ap english language' then normalized := 'ap language'; end if;
  return normalized;
end;
$$;

create or replace function private.normalize_course_name_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := private.normalize_course_display(new.name);
  if char_length(new.name) not between 2 and 120 then
    raise exception 'invalid_course_name' using errcode = '23514';
  end if;
  new.normalized_name := private.normalize_search(new.name);
  return new;
end;
$$;

create trigger course_names_normalize
before insert or update of name on public.course_names
for each row execute function private.normalize_course_name_fields();

create trigger course_names_set_updated_at
before update on public.course_names
for each row execute function private.set_updated_at();

create or replace function private.import_course_names(input_names text[], input_source text default 'approved')
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare imported_count integer;
begin
  if input_source not in ('approved', 'legacy', 'user', 'admin') then
    raise exception 'invalid_course_name_source' using errcode = '23514';
  end if;

  with cleaned as (
    select min(item.ordinality) as first_position,
           private.normalize_course_display(item.value) as display_name,
           private.normalize_search(item.value) as normalized_name
    from unnest(coalesce(input_names, array[]::text[])) with ordinality as item(value, ordinality)
    where private.normalize_search(item.value) <> ''
    group by private.normalize_search(item.value), private.normalize_course_display(item.value)
  ), deduplicated as (
    select distinct on (normalized_name) display_name, normalized_name
    from cleaned
    order by normalized_name, first_position
  ), imported as (
    insert into public.course_names (name, normalized_name, status, source)
    select display_name, normalized_name, 'active', input_source
    from deduplicated
    where char_length(display_name) between 2 and 120
    on conflict (normalized_name) do update
      set name = excluded.name,
          status = 'active',
          source = excluded.source,
          updated_at = now()
    returning 1
  )
  select count(*) into imported_count from imported;
  return imported_count;
end;
$$;

-- COURSE_CATALOG_IMPORT_START
select private.import_course_names(array[
  'Lunch',
  'Study Hall',
  'AFJROTC 100',
  'AFJROTC 200',
  'AFJROTC 300',
  'AFJROTC 400',
  'Business Communications',
  'Business Management',
  'Career Development',
  'Co-op',
  'Cybersecurity',
  'Entrepreneurship',
  'Honors Advanced Accounting 1',
  'Honors Advanced Accounting 2',
  'Honors Finance & Investments',
  'Honors International Business',
  'Intro to Business',
  'Intro to Information Science',
  'Marketing',
  'Microsoft Office Applications 1',
  'Microsoft Office Applications 2',
  'Personal Financial Literacy',
  'Principles of Accounting 1',
  'Principles of Accounting 2',
  'Sports & Entertainment Management',
  'Web Page Design',
  'Academic English 1',
  'Academic English 2',
  'Academic English 3',
  'Academic English 4',
  'Acting',
  'AP Language',
  'AP Literature',
  'AP Seminar',
  'Applied ELA 10',
  'Applied ELA 11',
  'Applied ELA 12',
  'Applied ELA 9',
  'Broadcasting',
  'Contemporary Novels',
  'Creative Writing',
  'Creative Writing 2',
  'Digital Media Production - NAEye TV',
  'English 10',
  'English 11',
  'English 12',
  'English 9',
  'English 1',
  'English 1 (IMPACT)',
  'English 2',
  'English 2 (IMPACT)',
  'English 3',
  'English 4',
  'ESL',
  'Essentials English 3',
  'Essentials English 4',
  'Film & TV Production 1',
  'Film & TV Production 2',
  'Film & TV Production 3',
  'Film Studies',
  'Honors English 1',
  'Honors English 2',
  'Honors English 3',
  'Honors English 4',
  'Honors Journalism',
  'Intro to Film',
  'Intro to Theater',
  'Journalism - NAEye News',
  'Leadership 1',
  'Leadership 2',
  'Speech',
  'Speech & Debate',
  'Yearbook',
  'Adventures in Food',
  'Child Psychology',
  'Fashion & Design',
  'Fashion Art & Merchandising',
  'Foods Americana',
  'Foods for You',
  'Interior Design',
  'International Foods',
  'Intro to Child Development',
  'Intro to Sports Nutrition',
  'Preschool Practicum',
  'Sports Nutrition',
  'The Real World',
  'Adaptive Gym',
  'Advanced Gym',
  'Gym',
  'Unified Gym - Senior',
  'Unified Gym - Sophomore',
  'Wellness for Life',
  'Academic Algebra 1',
  'Academic Algebra 2',
  'Academic Algebra 3',
  'Academic Algebra 3 with Trigonometry',
  'Academic Calculus',
  'Academic Computer Science A (Python)',
  'Academic Computer Science B (Python)',
  'Academic Geometry',
  'Academic Trigonometry',
  'Algebra 1',
  'Algebra 1 (IMPACT)',
  'Algebra 2 & Topics',
  'AP Calculus AB',
  'AP Calculus BC',
  'AP Computer Science A',
  'AP Computer Science Principles',
  'AP Precalculus',
  'AP Statistics',
  'Applied Math 10',
  'Applied Math 11',
  'Applied Math 12',
  'Applied Math 9',
  'Beginning Computer Applications',
  'College Algebra',
  'Consumer Math 11',
  'Consumer Math 12',
  'Geometry',
  'Geometry (IMPACT)',
  'Honors Algebra 2',
  'Honors Calculus',
  'Honors Computer Programming A (C++)',
  'Honors Computer Programming B (C++)',
  'Honors Database Programming (SQL)',
  'Honors Geometry',
  'Honors Linear Algebra',
  'Honors Precalculus',
  'Honors Probability & Statistics',
  '10th Grade Chorus',
  '9th Grade Chorus',
  'Advanced Computer Multimedia Arts',
  'AP Music Theory',
  'Computer Multimedia Arts',
  'Concert Band - NAI',
  'Concert Band - NASH',
  'Concert Choir (SA) - NASH',
  'Concert Choir (TB) - NASH',
  'Honors Chamber Choir - NAI/NASH',
  'Honors Chamber Orchestra - NAI',
  'Honors Chamber Orchestra - NASH',
  'Honors Music Production 3',
  'Honors Music Theory - NASH',
  'Honors Treble Singers - NAI',
  'Honors Treble Singers - NASH',
  'Honors Wind Ensemble - NAI',
  'Honors Wind Ensemble - NASH',
  'Music Production 1',
  'Music Production 2',
  'Music Technology & Songwriting 1',
  'Music Technology & Songwriting 2',
  'Music Technology & Songwriting 3',
  'Music Technology & Songwriting 4',
  'String Orchestra - NAI',
  'String Orchestra - NASH',
  'Symphonic Band - NAI',
  'Symphonic Band - NASH',
  'Vocal Music',
  'Academic Anatomy & Physiology',
  'Academic Biology',
  'Academic Chemistry',
  'Academic Intro to Physics & Chemistry',
  'Academic Physics',
  'AP Biology',
  'AP Chemistry',
  'AP Environmental Science',
  'AP Physics 1',
  'AP Physics 1&2',
  'AP Physics 2',
  'AP Physics C',
  'Applied Science 1',
  'Applied Science 2',
  'Astronomy',
  'Biology',
  'Biology (IMPACT)',
  'Environmental Science',
  'Honors Anatomy & Physiology',
  'Honors Astronomy',
  'Honors Biology',
  'Honors Chemistry',
  'Honors Environmental Science',
  'Honors Meteorology',
  'Honors Organic Chemistry',
  'Honors Physics',
  'Intro to Physics & Chemistry',
  'Intro to Physics & Chemistry (IMPACT)',
  'Academic American History',
  'Academic European History',
  'Academic Modern American History & Politics',
  'Academic World Cultures',
  'American History (IMPACT)',
  'AP Economics',
  'AP European History',
  'AP Government',
  'AP Human Geography',
  'AP Psychology',
  'AP US History',
  'Economics',
  'European History (IMPACT)',
  'Government & Law',
  'Honors American Foreign Policy',
  'Honors American History',
  'Honors European History',
  'Honors History of East Asia',
  'Honors History of Europe & Russia',
  'Honors Intro to Philosophy',
  'Honors Modern American History & Politics',
  'Honors World Cultures',
  'Law & Justice',
  'Modern American History',
  'Multicultural Experience',
  'Psychology',
  'Sociology',
  'World Cultures (IMPACT)',
  'Advanced CADD',
  'Advanced Game Development',
  'Advanced Robotic Engineering',
  'Advanced Stage Technology & Production',
  'Creation & Innovation',
  'Electricity & Electronics',
  'Emerging Technologies',
  'Exploring CADD',
  'Exploring Creation & Innovation',
  'Exploring Emerging Technologies',
  'Exploring Robotic Engineering',
  'Game Development',
  'Home Maintenance & Repair',
  'Honors Civil Engineering & Architecture',
  'Honors Digital Electronics',
  'Honors Engineering Capstone',
  'Honors Intro to Engineering Design',
  'Honors Principles of Engineering',
  'Manufacturing 1',
  'Manufacturing 2',
  'Robotic Engineering',
  'Stage Technology & Production',
  'Wood & Metal Fabrication',
  'AP Art & Design',
  'AP Art History',
  'Arts & Crafts',
  'Digital Imaging & Media Arts',
  'Drawing & Design Concepts',
  'Drawing & Painting 1',
  'Drawing & Painting 2',
  'Drawing & Painting 3',
  'Graphic Design & Digital Illustration',
  'Honors Art',
  'Intro to Pottery & Sculpture',
  'Jewelry & Metalsmithing',
  'Painting & Color Concepts',
  'Photography 1',
  'Photography 2',
  'Pottery 1',
  'Pottery 2',
  'Sculpture',
  'Academic French 4',
  'Academic French 2',
  'Academic French 3',
  'Academic German 4',
  'Academic German 2',
  'Academic German 3',
  'Academic Latin 4',
  'Academic Latin 2',
  'Academic Latin 3',
  'Academic Spanish 4',
  'Academic Spanish 2',
  'Academic Spanish 3',
  'AP French',
  'AP German',
  'AP Latin',
  'AP Spanish',
  'French 1',
  'German 1',
  'Honors French 4',
  'Honors French 5',
  'Honors French 2',
  'Honors French 3',
  'Honors German 4',
  'Honors German 5',
  'Honors German 2',
  'Honors German 3',
  'Honors Latin 4',
  'Honors Latin 5',
  'Honors Latin 2',
  'Honors Latin 3',
  'Honors Spanish 4',
  'Honors Spanish 5',
  'Honors Spanish 2',
  'Honors Spanish 3',
  'Latin 1',
  'Spanish 1',
  'Career Readiness 10',
  'Career Readiness 11',
  'Career Readiness 12',
  'Career Readiness 9',
  'Daily Living 10',
  'Daily Living 11',
  'Daily Living 12',
  'Daily Living 9',
  'Executive Functioning',
  'Vocational Training 10',
  'Vocational Training 11',
  'Vocational Training 12',
  'Vocational Training 9'
]::text[], 'approved');
-- COURSE_CATALOG_IMPORT_END

alter table public.classes add column course_name_id uuid;

with candidates as (
  select c.id as class_id,
         cn.id as course_name_id,
         count(*) over (partition by c.id) as candidate_count,
         row_number() over (
           partition by c.id
           order by (cn.normalized_name = c.normalized_class_name) desc, cn.name
         ) as preference
  from public.classes c
  join public.course_names cn
    on cn.source = 'approved'
   and (
     cn.normalized_name = c.normalized_class_name
     or private.normalize_course_match(cn.name) = private.normalize_course_match(c.class_name)
   )
), unambiguous as (
  select class_id, course_name_id
  from candidates
  where candidate_count = 1 and preference = 1
)
update public.classes c
set course_name_id = match.course_name_id
from unambiguous match
where match.class_id = c.id;

insert into public.course_names (name, normalized_name, status, source)
select distinct on (c.normalized_class_name)
       private.normalize_course_display(c.class_name),
       c.normalized_class_name,
       'disabled',
       'legacy'
from public.classes c
where c.course_name_id is null
order by c.normalized_class_name, c.created_at
on conflict (normalized_name) do nothing;

update public.classes c
set course_name_id = cn.id
from public.course_names cn
where c.course_name_id is null
  and cn.normalized_name = c.normalized_class_name;

alter table public.classes
  alter column course_name_id set not null,
  add constraint classes_course_name_id_fkey
    foreign key (course_name_id) references public.course_names(id) on delete restrict;

create index classes_course_name_status_idx on public.classes(course_name_id, status);

drop trigger if exists classes_normalize on public.classes;
drop function if exists private.normalize_class_fields();

alter table public.classes rename column teacher_name to teacher_last_name;
alter table public.classes rename column normalized_teacher_name to normalized_teacher_last_name;

update public.classes
set teacher_last_name = regexp_replace(
      private.normalize_course_display(teacher_last_name),
      '^(mr|mrs|ms|miss|dr|prof|coach)\.?\s+',
      '',
      'i'
    ),
    normalized_teacher_last_name = private.normalize_search(regexp_replace(
      private.normalize_course_display(teacher_last_name),
      '^(mr|mrs|ms|miss|dr|prof|coach)\.?\s+',
      '',
      'i'
    ));

create or replace function private.normalize_teacher_last_name(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare normalized text := private.normalize_course_display(value);
begin
  if char_length(normalized) not between 2 and 120
     or normalized ~* '^(mr|mrs|ms|miss|dr|prof|professor|coach)\.?\s+'
     or normalized ~ '[0-9,@]'
     or normalized ~ '[[:cntrl:]]' then
    raise exception 'invalid_teacher_last_name' using errcode = '23514';
  end if;
  return normalized;
end;
$$;

create or replace function private.normalize_class_section_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.teacher_last_name := private.normalize_teacher_last_name(new.teacher_last_name);
  new.normalized_teacher_last_name := private.normalize_search(new.teacher_last_name);
  return new;
end;
$$;

create trigger classes_normalize_section
before insert or update of teacher_last_name on public.classes
for each row execute function private.normalize_class_section_fields();

alter table public.classes drop column class_name;
alter table public.classes drop column normalized_class_name;

alter table public.reports add column reported_course_name_snapshot text;

update public.reports r
set reported_course_name_snapshot = cn.name
from public.classes c
join public.course_names cn on cn.id = c.course_name_id
where r.reported_class_id = c.id;

do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.reports'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%reported_class_id%'
  loop
    execute format('alter table public.reports drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table public.reports add constraint reports_target_required check (
  reported_user_id is not null
  or reported_class_id is not null
  or reported_course_name_snapshot is not null
  or reason_category = 'other'
);

do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.audit_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%target_type%'
  loop
    execute format('alter table public.audit_logs drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table public.audit_logs add constraint audit_logs_target_type_check
check (target_type in ('user', 'class', 'course_name', 'report', 'role', 'enrollment'));

alter table public.course_names enable row level security;

create policy course_names_select_authenticated
on public.course_names
for select
to authenticated
using (private.is_active_user((select auth.uid())));

revoke all on table public.course_names from anon, authenticated;
grant select on table public.course_names to authenticated;

create or replace function private.add_enrollment_for_student(
  target_student_id uuid,
  target_class_id uuid,
  target_term public.academic_term,
  actor_id uuid,
  history_action public.schedule_action,
  allow_conflict boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare enrollment_id uuid; class_snapshot jsonb;
begin
  if not exists (
    select 1
    from public.classes c
    join public.course_names cn on cn.id = c.course_name_id
    where c.id = target_class_id and c.status = 'active' and cn.status = 'active'
  ) then
    raise exception 'active_class_not_found' using errcode = 'P0002';
  end if;
  perform private.assert_no_schedule_conflict(target_student_id, target_class_id, target_term, null, allow_conflict);
  insert into public.class_enrollments (student_id, class_id, academic_term, active)
  values (target_student_id, target_class_id, target_term, true)
  on conflict (student_id, class_id) do update
    set academic_term = excluded.academic_term, active = true, updated_at = now()
  returning id into enrollment_id;

  select jsonb_build_object(
    'enrollment_id', enrollment_id,
    'class_id', c.id,
    'course_name_id', cn.id,
    'course_name', cn.name,
    'teacher_last_name', c.teacher_last_name,
    'academic_term', target_term
  ) into class_snapshot
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = target_class_id;

  insert into public.schedule_change_history (student_id, action, new_value, changed_by)
  values (target_student_id, history_action, class_snapshot, actor_id);
  return enrollment_id;
end;
$$;

drop function if exists public.search_classes(text, public.day_type, smallint, integer);
drop function if exists private.search_classes(text, public.day_type, smallint, integer);

create or replace function private.search_course_names(search_query text default '', result_limit integer default 20)
returns table (course_name_id uuid, course_name text, score real)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare normalized_query text := private.normalize_search(search_query);
begin
  perform private.require_active_user();
  return query
  select cn.id,
         cn.name,
         (case when normalized_query = '' then 10
               else extensions.similarity(cn.normalized_name, normalized_query) * 40 end
          + case when cn.normalized_name = normalized_query then 50 else 0 end
          + case when cn.normalized_name like normalized_query || '%' then 20 else 0 end)::real
  from public.course_names cn
  where cn.status = 'active'
    and (
      normalized_query = ''
      or cn.normalized_name like '%' || normalized_query || '%'
      or cn.normalized_name operator(extensions.%) normalized_query
    )
  order by 3 desc, cn.name
  limit least(greatest(result_limit, 1), 50);
end;
$$;

create or replace function public.search_course_names(p_query text default '', p_limit integer default 20)
returns table (course_name_id uuid, course_name text, score real)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.search_course_names(p_query, p_limit); $$;

create or replace function private.search_classes(
  search_query text default '',
  search_day_type public.day_type default null,
  search_period_number smallint default null,
  result_limit integer default 20
)
returns table (
  class_id uuid,
  course_name_id uuid,
  course_name text,
  teacher_last_name text,
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
declare normalized_query text := private.normalize_search(search_query);
begin
  perform private.require_active_user();
  return query
  select c.id,
         cn.id,
         cn.name,
         c.teacher_last_name,
         c.default_academic_term,
         c.is_double_period,
         jsonb_agg(jsonb_build_object('day_type', s.day_type, 'period_number', s.period_number) order by s.day_type, s.period_number),
         (
           case when search_day_type is not null and search_period_number is not null
             and bool_or(s.day_type = search_day_type and s.period_number = search_period_number) then 50 else 0 end
           + case when normalized_query = '' then 10 else greatest(
             extensions.similarity(cn.normalized_name, normalized_query),
             extensions.similarity(c.normalized_teacher_last_name, normalized_query)
           ) * 40 end
           + case when cn.normalized_name = normalized_query then 30 else 0 end
         )::real
  from public.classes c
  join public.course_names cn on cn.id = c.course_name_id and cn.status = 'active'
  join public.class_meeting_slots s on s.class_id = c.id
  where c.status = 'active'
    and (
      normalized_query = ''
      or cn.normalized_name like '%' || normalized_query || '%'
      or c.normalized_teacher_last_name like '%' || normalized_query || '%'
      or cn.normalized_name operator(extensions.%) normalized_query
      or c.normalized_teacher_last_name operator(extensions.%) normalized_query
    )
    and (
      (search_day_type is null and search_period_number is null)
      or exists (
        select 1 from public.class_meeting_slots filter_slot
        where filter_slot.class_id = c.id
          and (search_day_type is null or filter_slot.day_type = search_day_type)
          and (search_period_number is null or filter_slot.period_number = search_period_number)
      )
    )
  group by c.id, cn.id
  order by 8 desc, cn.name, c.teacher_last_name
  limit least(greatest(result_limit, 1), 50);
end;
$$;

create or replace function public.search_classes(
  p_query text default '',
  p_day_type public.day_type default null,
  p_period_number smallint default null,
  p_limit integer default 20
)
returns table (
  class_id uuid,
  course_name_id uuid,
  course_name text,
  teacher_last_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  score real
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.search_classes(p_query, p_day_type, p_period_number, p_limit); $$;

drop function if exists public.create_class_and_enroll(text, text, public.academic_term, boolean, jsonb, boolean);
drop function if exists private.create_class_and_enroll(text, text, public.academic_term, boolean, jsonb, boolean);

create or replace function private.create_class_and_enroll(
  input_course_name_id uuid,
  input_new_course_name text,
  input_teacher_last_name text,
  input_term public.academic_term,
  input_is_double boolean,
  input_meeting_slots jsonb,
  confirmed_no_course_match boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  selected_course_name_id uuid := input_course_name_id;
  new_class_id uuid;
  normalized_teacher text;
begin
  actor_id := private.require_active_user();
  perform private.consume_rate_limit(actor_id, 'class_create', 8, interval '1 hour');
  perform private.assert_valid_meeting_slots(input_meeting_slots, input_is_double);
  input_teacher_last_name := private.normalize_teacher_last_name(input_teacher_last_name);
  normalized_teacher := private.normalize_search(input_teacher_last_name);

  if input_course_name_id is not null and private.normalize_search(input_new_course_name) <> '' then
    raise exception 'select_or_create_one_course_name' using errcode = '23514';
  end if;

  if input_course_name_id is null then
    if not confirmed_no_course_match then
      raise exception 'course_name_duplicate_confirmation_required' using errcode = '23514';
    end if;
    input_new_course_name := private.normalize_course_display(input_new_course_name);
    if char_length(input_new_course_name) not between 2 and 120 then
      raise exception 'course_name_required' using errcode = '23514';
    end if;
    insert into public.course_names (name, normalized_name, status, source, created_by)
    values (input_new_course_name, private.normalize_search(input_new_course_name), 'active', 'user', actor_id)
    on conflict (normalized_name) do update set name = public.course_names.name
    returning id into selected_course_name_id;
  end if;

  if not exists (
    select 1 from public.course_names cn
    where cn.id = selected_course_name_id and cn.status = 'active'
  ) then
    raise exception 'active_course_name_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.classes c
    where c.status = 'active'
      and c.course_name_id = selected_course_name_id
      and c.normalized_teacher_last_name = normalized_teacher
      and c.default_academic_term = input_term
      and c.is_double_period = input_is_double
      and (select count(*) from public.class_meeting_slots s where s.class_id = c.id) = jsonb_array_length(input_meeting_slots)
      and not exists (
        select 1
        from jsonb_to_recordset(input_meeting_slots) requested(day_type public.day_type, period_number smallint)
        where not exists (
          select 1 from public.class_meeting_slots s
          where s.class_id = c.id and s.day_type = requested.day_type and s.period_number = requested.period_number
        )
      )
  ) then
    raise exception 'exact_duplicate_class_section_exists' using errcode = '23505';
  end if;

  insert into public.classes (
    course_name_id, teacher_last_name, normalized_teacher_last_name,
    default_academic_term, is_double_period, created_by
  ) values (
    selected_course_name_id, input_teacher_last_name, normalized_teacher,
    input_term, input_is_double, actor_id
  ) returning id into new_class_id;

  insert into public.class_meeting_slots (class_id, day_type, period_number)
  select new_class_id, requested.day_type, requested.period_number
  from jsonb_to_recordset(input_meeting_slots) requested(day_type public.day_type, period_number smallint);

  return private.add_enrollment_for_student(actor_id, new_class_id, input_term, actor_id, 'class_added', false);
end;
$$;

create or replace function public.create_class_and_enroll(
  p_course_name_id uuid,
  p_new_course_name text,
  p_teacher_last_name text,
  p_academic_term public.academic_term,
  p_is_double_period boolean,
  p_meeting_slots jsonb,
  p_confirmed_no_course_match boolean
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_class_and_enroll(
    p_course_name_id, p_new_course_name, p_teacher_last_name, p_academic_term,
    p_is_double_period, p_meeting_slots, p_confirmed_no_course_match
  );
$$;

create or replace function private.remove_enrollment(target_enrollment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; existing public.class_enrollments%rowtype; previous_snapshot jsonb;
begin
  actor_id := private.require_active_user();
  select * into existing from public.class_enrollments
  where id = target_enrollment_id and student_id = actor_id and active for update;
  if not found then raise exception 'active_enrollment_not_found' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'enrollment_id', existing.id, 'class_id', c.id, 'course_name_id', cn.id,
    'course_name', cn.name, 'academic_term', existing.academic_term
  ) into previous_snapshot
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = existing.class_id;
  update public.class_enrollments set active = false where id = existing.id;
  insert into public.schedule_change_history (student_id, action, previous_value, changed_by)
  values (actor_id, 'class_removed', previous_snapshot, actor_id);
end;
$$;

create or replace function private.update_enrollment_term(target_enrollment_id uuid, next_term public.academic_term)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; existing public.class_enrollments%rowtype; course_name_value text;
begin
  actor_id := private.require_active_user();
  select * into existing from public.class_enrollments
  where id = target_enrollment_id and student_id = actor_id and active for update;
  if not found then raise exception 'active_enrollment_not_found' using errcode = 'P0002'; end if;
  perform private.assert_no_schedule_conflict(actor_id, existing.class_id, next_term, existing.id, false);
  select cn.name into course_name_value
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = existing.class_id;
  update public.class_enrollments set academic_term = next_term where id = existing.id;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  values (
    actor_id, 'term_changed',
    jsonb_build_object('enrollment_id', existing.id, 'class_id', existing.class_id, 'course_name', course_name_value, 'academic_term', existing.academic_term),
    jsonb_build_object('enrollment_id', existing.id, 'class_id', existing.class_id, 'course_name', course_name_value, 'academic_term', next_term),
    actor_id
  );
end;
$$;

create or replace function private.replace_enrollment(
  target_enrollment_id uuid,
  replacement_class_id uuid,
  replacement_term public.academic_term,
  allow_conflict boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing public.class_enrollments%rowtype;
  next_enrollment_id uuid;
  previous_snapshot jsonb;
  next_snapshot jsonb;
begin
  actor_id := private.require_active_user();
  select * into existing from public.class_enrollments
  where id = target_enrollment_id and student_id = actor_id and active for update;
  if not found then raise exception 'active_enrollment_not_found' using errcode = 'P0002'; end if;
  if existing.class_id = replacement_class_id then
    perform private.update_enrollment_term(existing.id, replacement_term);
    return existing.id;
  end if;
  perform private.assert_no_schedule_conflict(actor_id, replacement_class_id, replacement_term, existing.id, allow_conflict);
  select jsonb_build_object(
    'enrollment_id', existing.id, 'class_id', c.id, 'course_name_id', cn.id,
    'course_name', cn.name, 'academic_term', existing.academic_term
  ) into previous_snapshot
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = existing.class_id;
  update public.class_enrollments set active = false where id = existing.id;
  insert into public.class_enrollments (student_id, class_id, academic_term, active)
  values (actor_id, replacement_class_id, replacement_term, true)
  on conflict (student_id, class_id) do update
    set academic_term = excluded.academic_term, active = true, updated_at = now()
  returning id into next_enrollment_id;
  select jsonb_build_object(
    'enrollment_id', next_enrollment_id, 'class_id', c.id, 'course_name_id', cn.id,
    'course_name', cn.name, 'academic_term', replacement_term
  ) into next_snapshot
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = replacement_class_id;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  values (actor_id, 'class_replaced', previous_snapshot, next_snapshot, actor_id);
  return next_enrollment_id;
end;
$$;

create or replace function private.search_student_directory(
  name_query text default null,
  grade_filter smallint default null,
  class_filter text default null,
  teacher_filter text default null
)
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_class_count bigint,
  can_view_schedule boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  if not private.has_active_enrollment(actor_id) and not private.is_admin(actor_id) then
    raise exception 'schedule_required_for_discovery' using errcode = '42501';
  end if;
  return query
  select p.id,
         p.full_name,
         p.grade,
         p.privacy_setting,
         (
           select count(distinct mine.class_id)
           from public.class_enrollments mine
           join public.class_enrollments theirs on theirs.class_id = mine.class_id and theirs.active
           where mine.student_id = actor_id and mine.active and theirs.student_id = p.id
         ),
         private.can_view_full_schedule(actor_id, p.id)
  from public.profiles p
  where p.id <> actor_id
    and private.is_active_user(p.id)
    and p.grade is not null
    and (
      p.privacy_setting = 'school'
      or (p.privacy_setting = 'classmates' and private.shares_active_class(actor_id, p.id))
      or private.is_admin(actor_id)
    )
    and (name_query is null or p.normalized_name like '%' || private.normalize_search(name_query) || '%')
    and (grade_filter is null or p.grade = grade_filter)
    and (class_filter is null or exists (
      select 1
      from public.class_enrollments e
      join public.classes c on c.id = e.class_id
      join public.course_names cn on cn.id = c.course_name_id
      where e.student_id = p.id and e.active
        and cn.normalized_name like '%' || private.normalize_search(class_filter) || '%'
    ))
    and (teacher_filter is null or exists (
      select 1 from public.class_enrollments e join public.classes c on c.id = e.class_id
      where e.student_id = p.id and e.active
        and c.normalized_teacher_last_name like '%' || private.normalize_search(teacher_filter) || '%'
    ))
  order by p.full_name
  limit 200;
end;
$$;

drop function if exists public.get_classmates();
drop function if exists private.get_classmates();

create or replace function private.get_classmates()
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_course_names jsonb,
  can_view_schedule boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  if not private.has_active_enrollment(actor_id) and not private.is_admin(actor_id) then
    raise exception 'schedule_required_for_discovery' using errcode = '42501';
  end if;
  return query
  select p.id,
         p.full_name,
         p.grade,
         p.privacy_setting,
         jsonb_agg(distinct cn.name order by cn.name),
         private.can_view_full_schedule(actor_id, p.id)
  from public.class_enrollments mine
  join public.class_enrollments theirs
    on theirs.class_id = mine.class_id and theirs.active and theirs.student_id <> actor_id
  join public.classes c on c.id = mine.class_id and c.status = 'active'
  join public.course_names cn on cn.id = c.course_name_id
  join public.profiles p on p.id = theirs.student_id
  where mine.student_id = actor_id and mine.active and private.is_active_user(p.id)
  group by p.id, p.full_name, p.grade, p.privacy_setting
  order by count(distinct mine.class_id) desc, p.full_name;
end;
$$;

create or replace function public.get_classmates()
returns table (
  student_id uuid,
  full_name text,
  grade smallint,
  privacy_setting public.privacy_setting,
  shared_course_names jsonb,
  can_view_schedule boolean
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_classmates(); $$;

drop function if exists public.get_visible_schedule(uuid);
drop function if exists private.get_visible_schedule(uuid);

create or replace function private.get_visible_schedule(target_student_id uuid)
returns table (
  enrollment_id uuid,
  class_id uuid,
  course_name_id uuid,
  course_name text,
  teacher_last_name text,
  academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid;
begin
  actor_id := private.require_active_user();
  if not private.can_view_full_schedule(actor_id, target_student_id) then
    raise exception 'schedule_not_visible' using errcode = '42501';
  end if;
  return query
  select e.id, c.id, cn.id, cn.name, c.teacher_last_name, e.academic_term, c.is_double_period,
         jsonb_agg(jsonb_build_object('day_type', s.day_type, 'period_number', s.period_number) order by s.day_type, s.period_number),
         e.created_at
  from public.class_enrollments e
  join public.classes c on c.id = e.class_id and c.status = 'active'
  join public.course_names cn on cn.id = c.course_name_id
  join public.class_meeting_slots s on s.class_id = c.id
  where e.student_id = target_student_id and e.active
  group by e.id, c.id, cn.id
  order by min(s.period_number), cn.name;
end;
$$;

create or replace function public.get_visible_schedule(p_student_id uuid)
returns table (
  enrollment_id uuid,
  class_id uuid,
  course_name_id uuid,
  course_name text,
  teacher_last_name text,
  academic_term public.academic_term,
  is_double_period boolean,
  meeting_slots jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_visible_schedule(p_student_id); $$;

drop function if exists public.admin_list_reports();
drop function if exists private.admin_list_reports();

create or replace function private.admin_list_reports()
returns table (
  report_id uuid,
  reason_category public.report_reason,
  explanation text,
  status public.report_status,
  reporter_id uuid,
  reporter_name text,
  reported_user_id uuid,
  reported_user_name text,
  reported_class_id uuid,
  reported_course_name text,
  assigned_admin_id uuid,
  assigned_admin_name text,
  resolution_notes text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select r.id,
         r.reason_category,
         r.explanation,
         r.status,
         r.reporter_id,
         reporter.full_name,
         r.reported_user_id,
         reported_user.full_name,
         r.reported_class_id,
         coalesce(cn.name, r.reported_course_name_snapshot),
         r.assigned_admin_id,
         assigned_admin.full_name,
         r.resolution_notes,
         r.created_at,
         r.resolved_at
  from public.reports r
  left join public.profiles reporter on reporter.id = r.reporter_id
  left join public.profiles reported_user on reported_user.id = r.reported_user_id
  left join public.classes reported_class on reported_class.id = r.reported_class_id
  left join public.course_names cn on cn.id = reported_class.course_name_id
  left join public.profiles assigned_admin on assigned_admin.id = r.assigned_admin_id
  order by r.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_list_reports()
returns table (
  report_id uuid,
  reason_category public.report_reason,
  explanation text,
  status public.report_status,
  reporter_id uuid,
  reporter_name text,
  reported_user_id uuid,
  reported_user_name text,
  reported_class_id uuid,
  reported_course_name text,
  assigned_admin_id uuid,
  assigned_admin_name text,
  resolution_notes text,
  created_at timestamptz,
  resolved_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_list_reports(); $$;

drop function if exists public.admin_list_classes();
drop function if exists private.admin_list_classes();

create or replace function private.admin_list_classes()
returns table (
  class_id uuid,
  course_name_id uuid,
  course_name text,
  teacher_last_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  status public.class_status,
  meeting_slots jsonb,
  active_enrollment_count bigint,
  total_enrollment_count bigint,
  report_count bigint,
  created_by uuid,
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
  select c.id,
         cn.id,
         cn.name,
         c.teacher_last_name,
         c.default_academic_term,
         c.is_double_period,
         c.status,
         coalesce((
           select jsonb_agg(jsonb_build_object('day_type', s.day_type, 'period_number', s.period_number) order by s.day_type, s.period_number)
           from public.class_meeting_slots s where s.class_id = c.id
         ), '[]'::jsonb),
         (select count(*) from public.class_enrollments e where e.class_id = c.id and e.active),
         (select count(*) from public.class_enrollments e where e.class_id = c.id),
         (select count(*) from public.reports r where r.reported_class_id = c.id),
         c.created_by,
         c.created_at,
         c.updated_at
  from public.classes c
  join public.course_names cn on cn.id = c.course_name_id
  order by cn.name, c.teacher_last_name;
end;
$$;

create or replace function public.admin_list_classes()
returns table (
  class_id uuid,
  course_name_id uuid,
  course_name text,
  teacher_last_name text,
  default_academic_term public.academic_term,
  is_double_period boolean,
  status public.class_status,
  meeting_slots jsonb,
  active_enrollment_count bigint,
  total_enrollment_count bigint,
  report_count bigint,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_list_classes(); $$;

create or replace function private.admin_list_course_names()
returns table (
  course_name_id uuid,
  course_name text,
  status public.course_name_status,
  source text,
  section_count bigint,
  active_section_count bigint,
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
  select cn.id,
         cn.name,
         cn.status,
         cn.source,
         count(c.id),
         count(c.id) filter (where c.status = 'active'),
         cn.created_at,
         cn.updated_at
  from public.course_names cn
  left join public.classes c on c.course_name_id = cn.id
  group by cn.id
  order by cn.name;
end;
$$;

create or replace function public.admin_list_course_names()
returns table (
  course_name_id uuid,
  course_name text,
  status public.course_name_status,
  source text,
  section_count bigint,
  active_section_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.admin_list_course_names(); $$;

create or replace function private.admin_create_course_name(input_name text, action_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; new_id uuid; display_name text := private.normalize_course_display(input_name);
begin
  actor_id := private.require_admin();
  if char_length(display_name) not between 2 and 120 then raise exception 'invalid_course_name' using errcode = '23514'; end if;
  if char_length(trim(coalesce(action_reason, ''))) < 3 then raise exception 'course_name_reason_required' using errcode = '23514'; end if;
  insert into public.course_names (name, normalized_name, source, created_by)
  values (display_name, private.normalize_search(display_name), 'admin', actor_id)
  returning id into new_id;
  perform private.write_audit(actor_id, 'course_name_created', 'course_name', new_id::text, null, jsonb_build_object('name', display_name), action_reason);
  return new_id;
end;
$$;

create or replace function public.admin_create_course_name(p_name text, p_reason text)
returns uuid language sql volatile security invoker set search_path = ''
as $$ select private.admin_create_course_name(p_name, p_reason); $$;

create or replace function private.admin_rename_course_name(target_course_name_id uuid, next_name text, action_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; after_data jsonb;
begin
  actor_id := private.require_admin();
  if char_length(trim(coalesce(action_reason, ''))) < 3 then raise exception 'course_name_reason_required' using errcode = '23514'; end if;
  select to_jsonb(cn) into before_data from public.course_names cn where cn.id = target_course_name_id for update;
  if not found then raise exception 'course_name_not_found' using errcode = 'P0002'; end if;
  update public.course_names set name = next_name where id = target_course_name_id;
  select to_jsonb(cn) into after_data from public.course_names cn where cn.id = target_course_name_id;
  perform private.write_audit(actor_id, 'course_name_renamed', 'course_name', target_course_name_id::text, before_data, after_data, action_reason);
end;
$$;

create or replace function public.admin_rename_course_name(p_course_name_id uuid, p_name text, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_rename_course_name(p_course_name_id, p_name, p_reason); $$;

create or replace function private.admin_set_course_name_enabled(target_course_name_id uuid, next_enabled boolean, action_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; current_status public.course_name_status; after_data jsonb;
begin
  actor_id := private.require_admin();
  select cn.status, to_jsonb(cn) into current_status, before_data
  from public.course_names cn where cn.id = target_course_name_id for update;
  if not found then raise exception 'course_name_not_found' using errcode = 'P0002'; end if;
  if current_status = 'merged' then raise exception 'merged_course_name_cannot_be_enabled' using errcode = '23514'; end if;
  if char_length(trim(coalesce(action_reason, ''))) < 3 then raise exception 'course_name_reason_required' using errcode = '23514'; end if;
  update public.course_names set status = case when next_enabled then 'active'::public.course_name_status else 'disabled'::public.course_name_status end
  where id = target_course_name_id;
  select to_jsonb(cn) into after_data from public.course_names cn where cn.id = target_course_name_id;
  perform private.write_audit(actor_id, case when next_enabled then 'course_name_enabled' else 'course_name_disabled' end, 'course_name', target_course_name_id::text, before_data, after_data, action_reason);
end;
$$;

create or replace function public.admin_set_course_name_enabled(p_course_name_id uuid, p_enabled boolean, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_set_course_name_enabled(p_course_name_id, p_enabled, p_reason); $$;

create or replace function private.admin_merge_course_names(canonical_course_name_id uuid, duplicate_course_name_id uuid, action_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; canonical_status public.course_name_status; duplicate_status public.course_name_status;
begin
  actor_id := private.require_admin();
  if canonical_course_name_id = duplicate_course_name_id then raise exception 'merge_requires_two_course_names' using errcode = '23514'; end if;
  perform 1 from public.course_names where id in (canonical_course_name_id, duplicate_course_name_id) order by id for update;
  if (select count(*) from public.course_names where id in (canonical_course_name_id, duplicate_course_name_id)) <> 2 then
    raise exception 'course_name_not_found' using errcode = 'P0002';
  end if;
  select status into canonical_status from public.course_names where id = canonical_course_name_id;
  select status into duplicate_status from public.course_names where id = duplicate_course_name_id;
  if canonical_status <> 'active' or duplicate_status = 'merged' then raise exception 'invalid_course_name_merge_status' using errcode = '23514'; end if;
  if char_length(trim(coalesce(action_reason, ''))) < 3 then raise exception 'course_name_reason_required' using errcode = '23514'; end if;
  select jsonb_build_object(
    'canonical', (select to_jsonb(cn) from public.course_names cn where cn.id = canonical_course_name_id),
    'duplicate', (select to_jsonb(cn) from public.course_names cn where cn.id = duplicate_course_name_id),
    'section_count', (select count(*) from public.classes c where c.course_name_id = duplicate_course_name_id)
  ) into before_data;
  update public.classes set course_name_id = canonical_course_name_id where course_name_id = duplicate_course_name_id;
  update public.course_names set status = 'merged' where id = duplicate_course_name_id;
  perform private.write_audit(actor_id, 'course_names_merged', 'course_name', canonical_course_name_id::text, before_data,
    jsonb_build_object('canonical_course_name_id', canonical_course_name_id, 'duplicate_course_name_id', duplicate_course_name_id), action_reason);
end;
$$;

create or replace function public.admin_merge_course_names(p_canonical_course_name_id uuid, p_duplicate_course_name_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_merge_course_names(p_canonical_course_name_id, p_duplicate_course_name_id, p_reason); $$;

create or replace function private.admin_archive_class(target_class_id uuid, action_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; course_name_value text;
begin
  actor_id := private.require_admin();
  select jsonb_build_object('class', to_jsonb(c), 'course_name', cn.name), cn.name
  into before_data, course_name_value
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = target_class_id for update of c;
  if not found then raise exception 'class_not_found' using errcode = 'P0002'; end if;
  if char_length(trim(coalesce(action_reason, ''))) < 3 then raise exception 'class_archive_reason_required' using errcode = '23514'; end if;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id, 'admin_schedule_change',
         jsonb_build_object('enrollment_id', e.id, 'class_id', target_class_id, 'course_name', course_name_value, 'active', true),
         jsonb_build_object('enrollment_id', e.id, 'class_id', target_class_id, 'course_name', course_name_value, 'active', false, 'reason', action_reason),
         actor_id
  from public.class_enrollments e where e.class_id = target_class_id and e.active;
  update public.class_enrollments set active = false where class_id = target_class_id and active;
  update public.classes set status = 'archived' where id = target_class_id;
  perform private.write_audit(actor_id, 'class_archived', 'class', target_class_id::text, before_data, jsonb_build_object('status', 'archived'), action_reason);
end;
$$;

drop function if exists public.admin_update_class(uuid, text, text, public.academic_term, boolean, jsonb, text);
drop function if exists private.admin_update_class(uuid, text, text, public.academic_term, boolean, jsonb, text);

create or replace function private.admin_update_class(
  target_class_id uuid,
  next_course_name_id uuid,
  next_teacher_last_name text,
  next_term public.academic_term,
  next_is_double boolean,
  next_slots jsonb,
  action_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; after_data jsonb; current_status public.class_status;
begin
  actor_id := private.require_admin();
  select c.status,
         jsonb_build_object(
           'class', to_jsonb(c), 'course_name', cn.name,
           'meeting_slots', coalesce((select jsonb_agg(to_jsonb(s) order by s.day_type, s.period_number) from public.class_meeting_slots s where s.class_id = c.id), '[]'::jsonb)
         )
  into current_status, before_data
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = target_class_id for update of c;
  if not found then raise exception 'class_not_found' using errcode = 'P0002'; end if;
  if current_status <> 'active' then raise exception 'only_active_classes_can_be_edited' using errcode = '23514'; end if;
  if not exists (select 1 from public.course_names cn where cn.id = next_course_name_id and cn.status = 'active') then
    raise exception 'active_course_name_not_found' using errcode = 'P0002';
  end if;
  next_teacher_last_name := private.normalize_teacher_last_name(next_teacher_last_name);
  if char_length(trim(coalesce(action_reason, ''))) < 3 then raise exception 'class_edit_reason_required' using errcode = '23514'; end if;
  perform private.assert_valid_meeting_slots(next_slots, next_is_double);

  if exists (
    select 1
    from public.class_enrollments edited_enrollment
    join public.class_enrollments other_enrollment
      on other_enrollment.student_id = edited_enrollment.student_id
     and other_enrollment.active and other_enrollment.class_id <> target_class_id
     and private.terms_overlap(edited_enrollment.academic_term, other_enrollment.academic_term)
    join public.class_meeting_slots other_slot on other_slot.class_id = other_enrollment.class_id
    join jsonb_to_recordset(next_slots) requested(day_type public.day_type, period_number smallint)
      on requested.day_type = other_slot.day_type and requested.period_number = other_slot.period_number
    where edited_enrollment.class_id = target_class_id and edited_enrollment.active
      and not exists (
        select 1 from public.class_meeting_slots current_slot
        where current_slot.class_id = target_class_id
          and current_slot.day_type = requested.day_type and current_slot.period_number = requested.period_number
      )
  ) then
    raise exception 'class_edit_schedule_conflict' using errcode = '23514';
  end if;

  update public.classes
  set course_name_id = next_course_name_id,
      teacher_last_name = next_teacher_last_name,
      default_academic_term = next_term,
      is_double_period = next_is_double
  where id = target_class_id;
  delete from public.class_meeting_slots where class_id = target_class_id;
  insert into public.class_meeting_slots (class_id, day_type, period_number)
  select target_class_id, requested.day_type, requested.period_number
  from jsonb_to_recordset(next_slots) requested(day_type public.day_type, period_number smallint);

  select jsonb_build_object(
    'class', to_jsonb(c), 'course_name', cn.name,
    'meeting_slots', coalesce((select jsonb_agg(to_jsonb(s) order by s.day_type, s.period_number) from public.class_meeting_slots s where s.class_id = c.id), '[]'::jsonb)
  ) into after_data
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = target_class_id;
  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id, 'meeting_slots_changed', before_data, after_data, actor_id
  from public.class_enrollments e where e.class_id = target_class_id and e.active;
  perform private.write_audit(actor_id, 'class_edited', 'class', target_class_id::text, before_data, after_data, action_reason);
end;
$$;

create or replace function public.admin_update_class(
  p_class_id uuid,
  p_course_name_id uuid,
  p_teacher_last_name text,
  p_academic_term public.academic_term,
  p_is_double_period boolean,
  p_meeting_slots jsonb,
  p_reason text
)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_update_class(p_class_id, p_course_name_id, p_teacher_last_name, p_academic_term, p_is_double_period, p_meeting_slots, p_reason); $$;

create or replace function private.admin_delete_class_section(target_class_id uuid, action_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare actor_id uuid; before_data jsonb; course_name_value text;
begin
  actor_id := private.require_admin();
  if char_length(trim(coalesce(action_reason, ''))) < 3 then raise exception 'class_delete_reason_required' using errcode = '23514'; end if;
  select jsonb_build_object(
           'class', to_jsonb(c),
           'course_name', cn.name,
           'meeting_slots', coalesce((select jsonb_agg(to_jsonb(s) order by s.day_type, s.period_number) from public.class_meeting_slots s where s.class_id = c.id), '[]'::jsonb),
           'enrollment_count', (select count(*) from public.class_enrollments e where e.class_id = c.id),
           'report_count', (select count(*) from public.reports r where r.reported_class_id = c.id)
         ), cn.name
  into before_data, course_name_value
  from public.classes c join public.course_names cn on cn.id = c.course_name_id
  where c.id = target_class_id for update of c;
  if not found then raise exception 'class_not_found' using errcode = 'P0002'; end if;

  insert into public.schedule_change_history (student_id, action, previous_value, new_value, changed_by)
  select e.student_id, 'admin_schedule_change',
         jsonb_build_object('enrollment_id', e.id, 'class_id', target_class_id, 'course_name', course_name_value, 'academic_term', e.academic_term, 'active', e.active),
         jsonb_build_object('class_id', target_class_id, 'course_name', course_name_value, 'permanently_deleted', true, 'reason', action_reason),
         actor_id
  from public.class_enrollments e
  where e.class_id = target_class_id and e.active;

  update public.reports
  set reported_course_name_snapshot = coalesce(reported_course_name_snapshot, course_name_value),
      reported_class_id = null
  where reported_class_id = target_class_id;

  perform private.write_audit(actor_id, 'class_permanently_deleted', 'class', target_class_id::text, before_data,
    jsonb_build_object('permanently_deleted', true), action_reason);
  delete from public.classes where id = target_class_id;
end;
$$;

create or replace function public.admin_delete_class_section(p_class_id uuid, p_reason text)
returns void language sql volatile security invoker set search_path = ''
as $$ select private.admin_delete_class_section(p_class_id, p_reason); $$;

revoke all on function private.import_course_names(text[], text) from public, anon, authenticated;
revoke all on function private.normalize_course_name_fields() from public, anon, authenticated;
revoke all on function private.normalize_class_section_fields() from public, anon, authenticated;
revoke all on function private.search_course_names(text, integer) from public, anon;
revoke all on function private.search_classes(text, public.day_type, smallint, integer) from public, anon;
revoke all on function private.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) from public, anon;
revoke all on function private.get_classmates() from public, anon;
revoke all on function private.get_visible_schedule(uuid) from public, anon;
revoke all on function private.admin_list_reports() from public, anon;
revoke all on function private.admin_list_classes() from public, anon;
revoke all on function private.admin_list_course_names() from public, anon;
revoke all on function private.admin_create_course_name(text, text) from public, anon;
revoke all on function private.admin_rename_course_name(uuid, text, text) from public, anon;
revoke all on function private.admin_set_course_name_enabled(uuid, boolean, text) from public, anon;
revoke all on function private.admin_merge_course_names(uuid, uuid, text) from public, anon;
revoke all on function private.admin_update_class(uuid, uuid, text, public.academic_term, boolean, jsonb, text) from public, anon;
revoke all on function private.admin_delete_class_section(uuid, text) from public, anon;

revoke all on function public.search_course_names(text, integer) from public, anon;
revoke all on function public.search_classes(text, public.day_type, smallint, integer) from public, anon;
revoke all on function public.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) from public, anon;
revoke all on function public.get_classmates() from public, anon;
revoke all on function public.get_visible_schedule(uuid) from public, anon;
revoke all on function public.admin_list_reports() from public, anon;
revoke all on function public.admin_list_classes() from public, anon;
revoke all on function public.admin_list_course_names() from public, anon;
revoke all on function public.admin_create_course_name(text, text) from public, anon;
revoke all on function public.admin_rename_course_name(uuid, text, text) from public, anon;
revoke all on function public.admin_set_course_name_enabled(uuid, boolean, text) from public, anon;
revoke all on function public.admin_merge_course_names(uuid, uuid, text) from public, anon;
revoke all on function public.admin_update_class(uuid, uuid, text, public.academic_term, boolean, jsonb, text) from public, anon;
revoke all on function public.admin_delete_class_section(uuid, text) from public, anon;

grant execute on function private.search_course_names(text, integer) to authenticated;
grant execute on function private.search_classes(text, public.day_type, smallint, integer) to authenticated;
grant execute on function private.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) to authenticated;
grant execute on function private.get_classmates() to authenticated;
grant execute on function private.get_visible_schedule(uuid) to authenticated;
grant execute on function private.admin_list_reports() to authenticated;
grant execute on function private.admin_list_classes() to authenticated;
grant execute on function private.admin_list_course_names() to authenticated;
grant execute on function private.admin_create_course_name(text, text) to authenticated;
grant execute on function private.admin_rename_course_name(uuid, text, text) to authenticated;
grant execute on function private.admin_set_course_name_enabled(uuid, boolean, text) to authenticated;
grant execute on function private.admin_merge_course_names(uuid, uuid, text) to authenticated;
grant execute on function private.admin_update_class(uuid, uuid, text, public.academic_term, boolean, jsonb, text) to authenticated;
grant execute on function private.admin_delete_class_section(uuid, text) to authenticated;

grant execute on function public.search_course_names(text, integer) to authenticated;
grant execute on function public.search_classes(text, public.day_type, smallint, integer) to authenticated;
grant execute on function public.create_class_and_enroll(uuid, text, text, public.academic_term, boolean, jsonb, boolean) to authenticated;
grant execute on function public.get_classmates() to authenticated;
grant execute on function public.get_visible_schedule(uuid) to authenticated;
grant execute on function public.admin_list_reports() to authenticated;
grant execute on function public.admin_list_classes() to authenticated;
grant execute on function public.admin_list_course_names() to authenticated;
grant execute on function public.admin_create_course_name(text, text) to authenticated;
grant execute on function public.admin_rename_course_name(uuid, text, text) to authenticated;
grant execute on function public.admin_set_course_name_enabled(uuid, boolean, text) to authenticated;
grant execute on function public.admin_merge_course_names(uuid, uuid, text) to authenticated;
grant execute on function public.admin_update_class(uuid, uuid, text, public.academic_term, boolean, jsonb, text) to authenticated;
grant execute on function public.admin_delete_class_section(uuid, text) to authenticated;

comment on table public.course_names is 'Reusable master catalog. Class sections reference one course name through classes.course_name_id.';
comment on column public.classes.teacher_last_name is 'Teacher last name only; honorifics and obviously invalid values are rejected.';
comment on function public.admin_delete_class_section(uuid, text) is 'Administrator-only permanent section deletion. Reports retain a course-name snapshot and affected schedules receive immutable history.';
comment on function public.search_course_names(text, integer) is 'Case-insensitive partial and trigram search over active reusable course names.';

notify pgrst, 'reload schema';
