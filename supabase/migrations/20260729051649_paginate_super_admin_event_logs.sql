create or replace function private.list_event_logs_page(
  category_filter text default null,
  event_filter text default null,
  user_filter text default null,
  target_filter text default null,
  created_from timestamptz default null,
  created_to timestamptz default null,
  result_filter text default null,
  row_limit integer default 50,
  row_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_super_admin();
  normalized_user_filter text := nullif(trim(user_filter), '');
  safe_limit integer := greatest(1, least(coalesce(row_limit, 50), 250));
  safe_offset integer := greatest(0, coalesce(row_offset, 0));
  response jsonb;
begin
  if safe_offset = 0 then
    perform private.write_event_log(
      'admin', 'audit_logs_accessed', actor_id, null, 'event_logs', null, 'succeeded',
      jsonb_build_object(
        'category_filter', category_filter,
        'event_filter', nullif(trim(event_filter), ''),
        'user_filter_used', normalized_user_filter is not null,
        'target_filter_used', nullif(trim(target_filter), '') is not null,
        'page_size', safe_limit
      )
    );
  end if;

  with filtered as materialized (
    select log.id, log.log_category, log.event_type, log.actor_user_id, log.actor_name,
           log.subject_user_id, log.subject_name, log.target_type, log.target_id,
           log.result, log.metadata, log.created_at
    from public.event_logs log
    where (category_filter is null or category_filter = '' or log.log_category = category_filter)
      and (event_filter is null or trim(event_filter) = '' or log.event_type ilike '%' || trim(event_filter) || '%')
      and (
        normalized_user_filter is null
        or log.actor_name ilike '%' || normalized_user_filter || '%'
        or log.subject_name ilike '%' || normalized_user_filter || '%'
        or log.actor_user_id::text = normalized_user_filter
        or log.subject_user_id::text = normalized_user_filter
      )
      and (
        target_filter is null or trim(target_filter) = ''
        or log.target_id ilike '%' || trim(target_filter) || '%'
        or log.target_type ilike '%' || trim(target_filter) || '%'
      )
      and (created_from is null or log.created_at >= created_from)
      and (created_to is null or log.created_at <= created_to)
      and (result_filter is null or result_filter = '' or log.result = result_filter)
  ),
  page_rows as (
    select *
    from filtered
    order by created_at desc, id desc
    limit safe_limit
    offset safe_offset
  )
  select jsonb_build_object(
    'total_count', (select count(*) from filtered),
    'logs', coalesce((
      select jsonb_agg(to_jsonb(page_row) order by page_row.created_at desc, page_row.id desc)
      from page_rows page_row
    ), '[]'::jsonb)
  )
  into response;

  return response;
end;
$$;

create or replace function public.super_admin_list_logs_page(
  p_category text default null,
  p_event text default null,
  p_user text default null,
  p_target text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_result text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.list_event_logs_page(
    p_category, p_event, p_user, p_target, p_created_from, p_created_to,
    p_result, p_limit, p_offset
  );
$$;

revoke all on function private.list_event_logs_page(text, text, text, text, timestamptz, timestamptz, text, integer, integer) from public, anon;
grant execute on function private.list_event_logs_page(text, text, text, text, timestamptz, timestamptz, text, integer, integer) to authenticated;
revoke all on function public.super_admin_list_logs_page(text, text, text, text, timestamptz, timestamptz, text, integer, integer) from public, anon;
grant execute on function public.super_admin_list_logs_page(text, text, text, text, timestamptz, timestamptz, text, integer, integer) to authenticated;

comment on function public.super_admin_list_logs_page(text, text, text, text, timestamptz, timestamptz, text, integer, integer)
is 'Super-admin-only filtered event-log page with an exact total count for pagination.';
