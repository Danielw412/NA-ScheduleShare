-- Administrator choice of homepage layout.
--   balanced       ScheduleShare's main features lead; the live bell is compact.
--   bell_schedule  The day's full bell schedule, current period, and countdown lead.
-- Presentation only: the public reader returns one validated word and fails
-- closed to 'balanced'. Writes are administrator-only and audited.
create table private.homepage_layout_settings (
  singleton boolean primary key default true check (singleton),
  layout text not null default 'balanced' check (layout in ('balanced', 'bell_schedule')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table private.homepage_layout_settings enable row level security;
revoke all on table private.homepage_layout_settings from public, anon, authenticated;

insert into private.homepage_layout_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create function public.get_homepage_layout()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select settings.layout
    from private.homepage_layout_settings settings
    where settings.singleton
  ), 'balanced');
$$;

create function private.admin_get_homepage_layout()
returns table (
  layout text,
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
  select settings.layout,
         settings.updated_at
  from private.homepage_layout_settings settings
  where settings.singleton;
end;
$$;

create function public.admin_get_homepage_layout()
returns table (
  layout text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_get_homepage_layout();
$$;

create function private.admin_update_homepage_layout(next_layout text)
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

  if next_layout is null or next_layout not in ('balanced', 'bell_schedule') then
    raise exception 'invalid_homepage_layout' using errcode = '22023';
  end if;

  select to_jsonb(settings) into before_data
  from private.homepage_layout_settings settings
  where settings.singleton
  for update;

  insert into private.homepage_layout_settings (singleton, layout, updated_by, updated_at)
  values (true, next_layout, actor_id, now())
  on conflict (singleton) do update
  set layout = excluded.layout,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  select to_jsonb(settings) into after_data
  from private.homepage_layout_settings settings
  where settings.singleton;

  perform private.write_audit(
    actor_id,
    'homepage_layout_changed',
    'homepage_settings',
    'homepage-layout',
    before_data,
    after_data,
    'Updated the homepage layout from the administrator homepage panel'
  );
end;
$$;

create function public.admin_update_homepage_layout(p_layout text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_update_homepage_layout(p_layout);
$$;

revoke all on function public.get_homepage_layout() from public, anon, authenticated;
grant execute on function public.get_homepage_layout() to anon, authenticated;

revoke all on function private.admin_get_homepage_layout() from public, anon, authenticated;
revoke all on function private.admin_update_homepage_layout(text) from public, anon, authenticated;
grant execute on function private.admin_get_homepage_layout() to authenticated;
grant execute on function private.admin_update_homepage_layout(text) to authenticated;

revoke all on function public.admin_get_homepage_layout() from public, anon, authenticated;
revoke all on function public.admin_update_homepage_layout(text) from public, anon, authenticated;
grant execute on function public.admin_get_homepage_layout() to authenticated;
grant execute on function public.admin_update_homepage_layout(text) to authenticated;

comment on function public.get_homepage_layout()
  is 'Returns the administrator-selected homepage layout: balanced or bell_schedule.';

notify pgrst, 'reload schema';
