alter table private.schedule_import_settings
add column progress_bar_duration_ms integer not null default 6500
check (progress_bar_duration_ms between 1000 and 30000);

create or replace function public.get_schedule_import_ui_settings()
returns table (progress_bar_duration_ms integer)
language sql
stable
security definer
set search_path = ''
as $$
  select settings.progress_bar_duration_ms
  from private.schedule_import_settings settings
  where settings.singleton;
$$;

create or replace function private.admin_update_schedule_import_progress_duration(
  next_progress_bar_duration_ms integer
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

  if next_progress_bar_duration_ms < 1000 or next_progress_bar_duration_ms > 30000 then
    raise exception 'schedule_import_progress_duration_invalid' using errcode = '23514';
  end if;

  select to_jsonb(settings) into before_data
  from private.schedule_import_settings settings
  where settings.singleton
  for update;

  update private.schedule_import_settings
  set progress_bar_duration_ms = next_progress_bar_duration_ms,
      updated_by = actor_id
  where singleton;

  select to_jsonb(settings) into after_data
  from private.schedule_import_settings settings
  where settings.singleton;

  perform private.write_audit(
    actor_id,
    'schedule_import_ui_configuration_changed',
    'ai_model_config',
    'progress_bar_duration',
    before_data,
    after_data,
    'Updated from the administrator AI settings panel'
  );
end;
$$;

create or replace function public.admin_update_schedule_import_progress_duration(
  p_progress_bar_duration_ms integer
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_update_schedule_import_progress_duration(p_progress_bar_duration_ms);
$$;

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
declare
  normalized_query text := private.normalize_search(left(coalesce(p_query, ''), 100));
begin
  return query
  select c.id,
         cn.id,
         cn.name,
         c.teacher_last_name,
         c.default_academic_term,
         c.is_double_period,
         jsonb_agg(
           jsonb_build_object('day_type', s.day_type, 'period_number', s.period_number)
           order by s.day_type, s.period_number
         ),
         (
           case when p_day_type is not null and p_period_number is not null
             and bool_or(s.day_type = p_day_type and s.period_number = p_period_number) then 50 else 0 end
           + case when normalized_query = '' then 10 else greatest(
             extensions.similarity(cn.normalized_name, normalized_query),
             extensions.similarity(c.normalized_teacher_last_name, normalized_query)
           ) * 40 end
           + case when cn.normalized_name = normalized_query then 30 else 0 end
         )::real
  from public.classes c
  join public.course_names cn on cn.id = c.course_name_id
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
      (p_day_type is null and p_period_number is null)
      or exists (
        select 1
        from public.class_meeting_slots filter_slot
        where filter_slot.class_id = c.id
          and (p_day_type is null or filter_slot.day_type = p_day_type)
          and (p_period_number is null or filter_slot.period_number = p_period_number)
      )
    )
  group by c.id, cn.id
  order by 8 desc, cn.name, c.teacher_last_name
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

revoke all on function public.get_schedule_import_ui_settings() from public, anon, authenticated;
grant execute on function public.get_schedule_import_ui_settings() to anon, authenticated;

revoke all on function private.admin_update_schedule_import_progress_duration(integer) from public, anon, authenticated;
grant execute on function private.admin_update_schedule_import_progress_duration(integer) to authenticated;

revoke all on function public.admin_update_schedule_import_progress_duration(integer) from public, anon;
grant execute on function public.admin_update_schedule_import_progress_duration(integer) to authenticated;

revoke all on function public.guest_search_classes(text, public.day_type, smallint, integer) from public, anon, authenticated;
grant execute on function public.guest_search_classes(text, public.day_type, smallint, integer) to anon, authenticated;

comment on function public.get_schedule_import_ui_settings()
  is 'Returns non-sensitive screenshot importer presentation settings.';

comment on function public.guest_search_classes(text, public.day_type, smallint, integer)
  is 'Returns up to 1,000 public class catalog entries without enrollment, roster, or student data.';

notify pgrst, 'reload schema';
