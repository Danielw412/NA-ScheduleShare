-- Split campus-specific lunch/study-hall sections, keep lunch semester-only,
-- and expose service-role-only helpers used by the guest screenshot importer.

select private.import_course_names(array[
  'Lunch - NAI',
  'Lunch - NASH',
  'Study Hall - NAI',
  'Study Hall - NASH'
], 'approved');

-- Move active enrollments off the legacy generic course names. Full-year lunch
-- becomes one semester-one and one semester-two section in the same slots.
do $$
declare
  enrollment_record record;
  target_course_id uuid;
  target_class_id uuid;
  effective_term public.academic_term;
  effective_terms public.academic_term[];
  campus_name text;
  target_course_name text;
begin
  for enrollment_record in
    select
      enrollment.id as enrollment_id,
      enrollment.student_id,
      enrollment.academic_term,
      profile.grade,
      class_record.id as source_class_id,
      class_record.teacher_last_name,
      class_record.normalized_teacher_last_name,
      class_record.is_double_period,
      class_record.created_by,
      course_name.normalized_name as course_kind
    from public.class_enrollments enrollment
    join public.profiles profile on profile.id = enrollment.student_id
    join public.classes class_record on class_record.id = enrollment.class_id
    join public.course_names course_name on course_name.id = class_record.course_name_id
    where enrollment.active
      and course_name.normalized_name in ('lunch', 'study hall')
  loop
    campus_name := case when enrollment_record.grade in (9, 10) then 'NAI' else 'NASH' end;
    target_course_name := case
      when enrollment_record.course_kind = 'lunch' then 'Lunch - ' || campus_name
      else 'Study Hall - ' || campus_name
    end;

    select course_name.id
    into target_course_id
    from public.course_names course_name
    where course_name.normalized_name = private.normalize_search(target_course_name)
      and course_name.status = 'active';

    effective_terms := case
      when enrollment_record.course_kind = 'lunch'
        and enrollment_record.academic_term = 'full_year'
        then array['semester_1'::public.academic_term, 'semester_2'::public.academic_term]
      else array[enrollment_record.academic_term]
    end;

    foreach effective_term in array effective_terms
    loop
      select candidate.id
      into target_class_id
      from public.classes candidate
      where candidate.status = 'active'
        and candidate.course_name_id = target_course_id
        and candidate.normalized_teacher_last_name = enrollment_record.normalized_teacher_last_name
        and candidate.default_academic_term = effective_term
        and candidate.is_double_period = enrollment_record.is_double_period
        and (
          select count(*)
          from public.class_meeting_slots candidate_slot
          where candidate_slot.class_id = candidate.id
        ) = (
          select count(*)
          from public.class_meeting_slots source_slot
          where source_slot.class_id = enrollment_record.source_class_id
        )
        and not exists (
          select 1
          from public.class_meeting_slots source_slot
          where source_slot.class_id = enrollment_record.source_class_id
            and not exists (
              select 1
              from public.class_meeting_slots candidate_slot
              where candidate_slot.class_id = candidate.id
                and candidate_slot.day_type = source_slot.day_type
                and candidate_slot.period_number = source_slot.period_number
            )
        )
      order by candidate.created_at, candidate.id
      limit 1;

      if target_class_id is null then
        insert into public.classes (
          course_name_id,
          teacher_last_name,
          normalized_teacher_last_name,
          default_academic_term,
          is_double_period,
          created_by
        ) values (
          target_course_id,
          enrollment_record.teacher_last_name,
          enrollment_record.normalized_teacher_last_name,
          effective_term,
          enrollment_record.is_double_period,
          enrollment_record.created_by
        )
        returning id into target_class_id;

        insert into public.class_meeting_slots (class_id, day_type, period_number)
        select target_class_id, source_slot.day_type, source_slot.period_number
        from public.class_meeting_slots source_slot
        where source_slot.class_id = enrollment_record.source_class_id;
      end if;

      insert into public.class_enrollments (student_id, class_id, academic_term, active)
      values (enrollment_record.student_id, target_class_id, effective_term, true)
      on conflict (student_id, class_id) do update
        set academic_term = excluded.academic_term,
            active = true,
            updated_at = now();

      target_class_id := null;
    end loop;

    update public.class_enrollments
    set active = false,
        updated_at = now()
    where id = enrollment_record.enrollment_id;
  end loop;

  update public.course_names
  set status = 'disabled'
  where normalized_name in ('lunch', 'study hall');
end;
$$;

create table private.schedule_import_guest_rate_limits (
  guest_key text not null check (guest_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  primary key (guest_key, window_started_at)
);

create index schedule_import_guest_rate_limits_expiry_idx
on private.schedule_import_guest_rate_limits(expires_at);

alter table private.schedule_import_guest_rate_limits enable row level security;
revoke all on table private.schedule_import_guest_rate_limits from public, anon, authenticated;

create or replace function private.schedule_import_prepare_guest(input_guest_key text)
returns table (
  model_id text,
  thinking_level text,
  output_token_limit integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  maximum_requests integer;
  window_seconds integer;
  current_window timestamptz;
  consumed_count integer;
  selected_model_id text;
  selected_thinking_level text;
  selected_output_token_limit integer;
begin
  if input_guest_key is null or input_guest_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_guest_import_key' using errcode = '23514';
  end if;

  select
    settings.rate_limit_max,
    settings.rate_limit_window_seconds,
    settings.active_model_id,
    settings.thinking_level,
    settings.output_token_limit
  into
    maximum_requests,
    window_seconds,
    selected_model_id,
    selected_thinking_level,
    selected_output_token_limit
  from private.schedule_import_settings settings
  where settings.singleton;

  if maximum_requests is null or window_seconds is null then
    raise exception 'schedule_import_not_configured' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.schedule_import_models model
    where model.model_id = selected_model_id
      and model.enabled
      and model.supports_image_input
      and model.supports_structured_output
      and selected_thinking_level = any(model.supported_thinking_levels)
      and selected_output_token_limit <= model.max_output_tokens
  ) then
    raise exception 'schedule_import_model_not_enabled' using errcode = '23514';
  end if;

  current_window := to_timestamp((
    floor(extract(epoch from clock_timestamp()) / window_seconds) * window_seconds
  )::double precision);

  delete from private.schedule_import_guest_rate_limits
  where expires_at < clock_timestamp();

  insert into private.schedule_import_guest_rate_limits as rate_limit (
    guest_key,
    window_started_at,
    request_count,
    expires_at
  ) values (
    input_guest_key,
    current_window,
    1,
    current_window + make_interval(secs => window_seconds + 60)
  )
  on conflict (guest_key, window_started_at) do update
    set request_count = rate_limit.request_count + 1
    where rate_limit.request_count < maximum_requests
  returning request_count into consumed_count;

  if consumed_count is null then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;

  return query select selected_model_id, selected_thinking_level, selected_output_token_limit;
end;
$$;

create or replace function public.schedule_import_prepare_guest(p_guest_key text)
returns table (
  model_id text,
  thinking_level text,
  output_token_limit integer
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.schedule_import_prepare_guest(p_guest_key);
$$;

create or replace function private.schedule_import_guest_match_count(input_class_ids uuid[])
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct enrollment.student_id)::integer
  from public.class_enrollments enrollment
  join public.profiles profile on profile.id = enrollment.student_id
  left join private.account_moderation moderation on moderation.user_id = profile.id
  where enrollment.active
    and enrollment.class_id = any(coalesce(input_class_ids, array[]::uuid[]))
    and profile.onboarding_completed
    and moderation.suspended_at is null
    and moderation.deleted_at is null;
$$;

create or replace function public.schedule_import_guest_match_count(p_class_ids uuid[])
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select private.schedule_import_guest_match_count(p_class_ids);
$$;

create or replace function public.guest_search_course_names(
  p_query text default '',
  p_limit integer default 20
)
returns table (course_name_id uuid, course_name text, score real)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare normalized_query text := private.normalize_search(left(coalesce(p_query, ''), 100));
begin
  return query
  select course_name.id,
         course_name.name,
         (
           case when normalized_query = '' then 10
             else extensions.similarity(course_name.normalized_name, normalized_query) * 40 end
           + case when course_name.normalized_name = normalized_query then 50 else 0 end
           + case when course_name.normalized_name like normalized_query || '%' then 20 else 0 end
         )::real
  from public.course_names course_name
  where course_name.status = 'active'
    and (
      normalized_query = ''
      or course_name.normalized_name like '%' || normalized_query || '%'
      or course_name.normalized_name operator(extensions.%) normalized_query
    )
  order by 3 desc, course_name.name
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- Keep the public class catalog from returning the disabled generic special
-- courses after their enrollments have been split by campus.
create or replace function public.guest_search_classes(
  p_query text default '',
  p_day_type public.day_type default null,
  p_period_number smallint default null,
  p_limit integer default 1000
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
declare normalized_query text := private.normalize_search(left(coalesce(p_query, ''), 100));
begin
  return query
  select class_record.id,
         course_name.id,
         course_name.name,
         class_record.teacher_last_name,
         class_record.default_academic_term,
         class_record.is_double_period,
         jsonb_agg(
           jsonb_build_object('day_type', slot.day_type, 'period_number', slot.period_number)
           order by slot.day_type, slot.period_number
         ),
         (
           case when p_day_type is not null and p_period_number is not null
             and bool_or(slot.day_type = p_day_type and slot.period_number = p_period_number) then 50 else 0 end
           + case when normalized_query = '' then 10 else greatest(
             extensions.similarity(course_name.normalized_name, normalized_query),
             extensions.similarity(class_record.normalized_teacher_last_name, normalized_query)
           ) * 40 end
           + case when course_name.normalized_name = normalized_query then 30 else 0 end
         )::real
  from public.classes class_record
  join public.course_names course_name on course_name.id = class_record.course_name_id
  join public.class_meeting_slots slot on slot.class_id = class_record.id
  where class_record.status = 'active'
    and course_name.status = 'active'
    and (
      normalized_query = ''
      or course_name.normalized_name like '%' || normalized_query || '%'
      or class_record.normalized_teacher_last_name like '%' || normalized_query || '%'
      or course_name.normalized_name operator(extensions.%) normalized_query
      or class_record.normalized_teacher_last_name operator(extensions.%) normalized_query
    )
    and (
      (p_day_type is null and p_period_number is null)
      or exists (
        select 1
        from public.class_meeting_slots filter_slot
        where filter_slot.class_id = class_record.id
          and (p_day_type is null or filter_slot.day_type = p_day_type)
          and (p_period_number is null or filter_slot.period_number = p_period_number)
      )
    )
  group by class_record.id, course_name.id
  order by 8 desc, course_name.name, class_record.teacher_last_name
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

revoke all on function private.schedule_import_prepare_guest(text) from public, anon, authenticated;
revoke all on function private.schedule_import_guest_match_count(uuid[]) from public, anon, authenticated;

revoke all on function public.schedule_import_prepare_guest(text) from public, anon, authenticated;
revoke all on function public.schedule_import_guest_match_count(uuid[]) from public, anon, authenticated;
grant execute on function public.schedule_import_prepare_guest(text) to service_role;
grant execute on function public.schedule_import_guest_match_count(uuid[]) to service_role;

revoke all on function public.guest_search_course_names(text, integer) from public, anon, authenticated;
grant execute on function public.guest_search_course_names(text, integer) to anon, authenticated;

revoke all on function public.guest_search_classes(text, public.day_type, smallint, integer) from public, anon, authenticated;
grant execute on function public.guest_search_classes(text, public.day_type, smallint, integer) to anon, authenticated;

comment on function public.schedule_import_prepare_guest(text) is
  'Service-role-only guest importer configuration and pseudonymous rate-limit entrypoint.';
comment on function public.schedule_import_guest_match_count(uuid[]) is
  'Service-role-only aggregate count for exact classes recognized from a guest screenshot; never returns identities.';
comment on function public.guest_search_course_names(text, integer) is
  'Returns active catalog course names only; no student or enrollment data.';

notify pgrst, 'reload schema';
