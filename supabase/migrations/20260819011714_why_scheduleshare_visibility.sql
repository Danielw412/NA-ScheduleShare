-- Allow administrators to publish or take down the Why ScheduleShare page.
-- The public reader exposes one boolean and fails closed if the singleton row
-- is ever missing; all writes remain administrator-only and audited.
alter table private.club_prompt_settings
add column why_scheduleshare_enabled boolean not null default true;

create function public.get_why_scheduleshare_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select settings.why_scheduleshare_enabled
    from private.club_prompt_settings settings
    where settings.singleton
  ), false);
$$;

drop function public.admin_get_club_prompt_settings();
drop function private.admin_get_club_prompt_settings();

create function private.admin_get_club_prompt_settings()
returns table (
  enabled boolean,
  delay_seconds integer,
  why_scheduleshare_enabled boolean,
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
         settings.why_scheduleshare_enabled,
         settings.updated_at
  from private.club_prompt_settings settings
  where settings.singleton;
end;
$$;

create function public.admin_get_club_prompt_settings()
returns table (
  enabled boolean,
  delay_seconds integer,
  why_scheduleshare_enabled boolean,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_get_club_prompt_settings();
$$;

drop function public.admin_update_club_prompt_settings(boolean, integer);
drop function private.admin_update_club_prompt_settings(boolean, integer);

create function private.admin_update_club_prompt_settings(
  next_enabled boolean,
  next_delay_seconds integer,
  next_why_scheduleshare_enabled boolean
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

  if next_why_scheduleshare_enabled is null then
    raise exception 'invalid_why_scheduleshare_visibility' using errcode = '22023';
  end if;

  select to_jsonb(settings) into before_data
  from private.club_prompt_settings settings
  where settings.singleton
  for update;

  update private.club_prompt_settings
  set enabled = next_enabled,
      delay_seconds = next_delay_seconds,
      why_scheduleshare_enabled = next_why_scheduleshare_enabled,
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
    'Updated the club invitation and Why ScheduleShare page visibility settings'
  );
end;
$$;

create function public.admin_update_club_prompt_settings(
  p_enabled boolean,
  p_delay_seconds integer,
  p_why_scheduleshare_enabled boolean
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_update_club_prompt_settings(
    p_enabled,
    p_delay_seconds,
    p_why_scheduleshare_enabled
  );
$$;

revoke all on function public.get_why_scheduleshare_enabled() from public, anon, authenticated;
grant execute on function public.get_why_scheduleshare_enabled() to anon, authenticated;

revoke all on function private.admin_get_club_prompt_settings() from public, anon, authenticated;
revoke all on function private.admin_update_club_prompt_settings(boolean, integer, boolean) from public, anon, authenticated;
grant execute on function private.admin_get_club_prompt_settings() to authenticated;
grant execute on function private.admin_update_club_prompt_settings(boolean, integer, boolean) to authenticated;

revoke all on function public.admin_get_club_prompt_settings() from public, anon, authenticated;
revoke all on function public.admin_update_club_prompt_settings(boolean, integer, boolean) from public, anon, authenticated;
grant execute on function public.admin_get_club_prompt_settings() to authenticated;
grant execute on function public.admin_update_club_prompt_settings(boolean, integer, boolean) to authenticated;

comment on function public.get_why_scheduleshare_enabled()
  is 'Returns whether the public Why ScheduleShare page is currently published.';

notify pgrst, 'reload schema';
