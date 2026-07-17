-- Administrator-controlled guest exploration. The default preserves the current public experience.

create table private.guest_access_settings (
  singleton boolean primary key default true check (singleton),
  exploration_enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table private.guest_access_settings enable row level security;
revoke all on table private.guest_access_settings from public, anon, authenticated;

insert into private.guest_access_settings (singleton, exploration_enabled)
values (true, true)
on conflict (singleton) do nothing;

create or replace function public.get_guest_exploration_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select settings.exploration_enabled
    from private.guest_access_settings settings
    where settings.singleton
  ), true);
$$;

create or replace function public.admin_update_guest_exploration_enabled(p_enabled boolean)
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

  select to_jsonb(settings) into before_data
  from private.guest_access_settings settings
  where settings.singleton
  for update;

  update private.guest_access_settings
  set exploration_enabled = p_enabled,
      updated_by = actor_id,
      updated_at = now()
  where singleton;

  select to_jsonb(settings) into after_data
  from private.guest_access_settings settings
  where settings.singleton;

  perform private.write_audit(
    actor_id,
    'guest_exploration_settings_changed',
    'homepage_settings',
    'guest-exploration',
    before_data,
    after_data,
    case when p_enabled
      then 'Enabled guest exploration'
      else 'Disabled guest exploration'
    end
  );
end;
$$;

revoke all on function public.get_guest_exploration_enabled() from public, anon, authenticated;
revoke all on function public.admin_update_guest_exploration_enabled(boolean) from public, anon, authenticated;

grant execute on function public.get_guest_exploration_enabled() to anon, authenticated;
grant execute on function public.admin_update_guest_exploration_enabled(boolean) to authenticated;

comment on function public.get_guest_exploration_enabled() is
  'Returns whether signed-out visitors may browse guest discovery routes and controls without exposing the private settings table.';
comment on function public.admin_update_guest_exploration_enabled(boolean) is
  'Administrator-only audited update for guest exploration access.';
