-- Administrator controls for the timed "built by the NA Computer and AI Club"
-- invitation. Presentation-only settings: no student data is exposed, and the
-- public reader returns just the toggle and the delay the browser waits for.
create table private.club_prompt_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  delay_seconds integer not null default 180 check (delay_seconds between 30 and 3600),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table private.club_prompt_settings enable row level security;
revoke all on table private.club_prompt_settings from public, anon, authenticated;

insert into private.club_prompt_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create function private.get_club_prompt_settings()
returns table (
  enabled boolean,
  delay_seconds integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select settings.enabled, settings.delay_seconds
  from private.club_prompt_settings settings
  where settings.singleton;
$$;

create function public.get_club_prompt_settings()
returns table (
  enabled boolean,
  delay_seconds integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_club_prompt_settings();
$$;

create function private.admin_get_club_prompt_settings()
returns table (
  enabled boolean,
  delay_seconds integer,
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
  select settings.enabled,
         settings.delay_seconds,
         settings.updated_at
  from private.club_prompt_settings settings
  where settings.singleton;
end;
$$;

create function public.admin_get_club_prompt_settings()
returns table (
  enabled boolean,
  delay_seconds integer,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_get_club_prompt_settings();
$$;

create function private.admin_update_club_prompt_settings(
  next_enabled boolean,
  next_delay_seconds integer
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

  if next_delay_seconds is null or next_delay_seconds < 30 or next_delay_seconds > 3600 then
    raise exception 'invalid_club_prompt_delay' using errcode = '22023';
  end if;

  select to_jsonb(settings) into before_data
  from private.club_prompt_settings settings
  where settings.singleton
  for update;

  update private.club_prompt_settings
  set enabled = next_enabled,
      delay_seconds = next_delay_seconds,
      updated_by = actor_id,
      updated_at = now()
  where singleton;

  select to_jsonb(settings) into after_data
  from private.club_prompt_settings settings
  where settings.singleton;

  perform private.write_audit(
    actor_id,
    'club_prompt_settings_changed',
    'homepage_settings',
    'club-prompt',
    before_data,
    after_data,
    'Updated the timed club invitation from the administrator homepage panel'
  );
end;
$$;

create function public.admin_update_club_prompt_settings(
  p_enabled boolean,
  p_delay_seconds integer
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_update_club_prompt_settings(p_enabled, p_delay_seconds);
$$;

-- Only signed-in students can reach the timed invitation, so anonymous callers
-- get no execute privilege and the private schema stays closed to them.
revoke all on function private.get_club_prompt_settings() from public, anon, authenticated;
revoke all on function private.admin_get_club_prompt_settings() from public, anon, authenticated;
revoke all on function private.admin_update_club_prompt_settings(boolean, integer) from public, anon, authenticated;
grant execute on function private.get_club_prompt_settings() to authenticated;
grant execute on function private.admin_get_club_prompt_settings() to authenticated;
grant execute on function private.admin_update_club_prompt_settings(boolean, integer) to authenticated;

revoke all on function public.get_club_prompt_settings() from public, anon, authenticated;
revoke all on function public.admin_get_club_prompt_settings() from public, anon, authenticated;
revoke all on function public.admin_update_club_prompt_settings(boolean, integer) from public, anon, authenticated;
grant execute on function public.get_club_prompt_settings() to authenticated;
grant execute on function public.admin_get_club_prompt_settings() to authenticated;
grant execute on function public.admin_update_club_prompt_settings(boolean, integer) to authenticated;

comment on function public.get_club_prompt_settings()
  is 'Returns whether the timed club invitation is enabled and how long the signed-in browser waits before showing it.';

notify pgrst, 'reload schema';
