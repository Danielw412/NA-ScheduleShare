-- Unguessable capability URLs for schedule previews. The token identifies a link, while
-- current account state and profile privacy are checked on every public read.
create table public.schedule_share_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_share_links enable row level security;

create policy schedule_share_links_select_own
on public.schedule_share_links for select
to authenticated
using ((select auth.uid()) = owner_id and private.is_active_user((select auth.uid())));

create policy schedule_share_links_insert_own
on public.schedule_share_links for insert
to authenticated
with check ((select auth.uid()) = owner_id and private.is_active_user((select auth.uid())));

create policy schedule_share_links_update_own
on public.schedule_share_links for update
to authenticated
using ((select auth.uid()) = owner_id and private.is_active_user((select auth.uid())))
with check ((select auth.uid()) = owner_id and private.is_active_user((select auth.uid())));

create trigger schedule_share_links_set_updated_at
before update on public.schedule_share_links
for each row execute function private.set_updated_at();

create or replace function public.get_or_create_schedule_share()
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  share_token uuid;
begin
  if not private.is_active_user(actor_id) then
    raise exception 'active_account_required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.class_enrollments e
    where e.student_id = actor_id and e.active
  ) then
    raise exception 'schedule_required' using errcode = 'P0002';
  end if;

  insert into public.schedule_share_links (owner_id)
  values (actor_id)
  on conflict (owner_id) do update
    set enabled = true
  returning token into share_token;

  return share_token;
end;
$$;

-- This is an intentionally anonymous, tightly bounded SECURITY DEFINER API.
-- It never returns names, user IDs, class IDs, teachers, or contact details.
-- Only an enabled link owned by an active account with the explicit "Anyone"
-- privacy setting can return schedule rows.
create or replace function public.get_public_schedule_share(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'available', true,
        'schedule', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'day_type', slots.day_type,
                'period_number', slots.period_number,
                'course_name', course_names.name,
                'academic_term', enrollments.academic_term
              )
              order by slots.day_type, slots.period_number, enrollments.academic_term, course_names.name
            )
            from public.class_enrollments enrollments
            join public.classes classes
              on classes.id = enrollments.class_id
             and classes.status = 'active'
            join public.course_names course_names
              on course_names.id = classes.course_name_id
            join public.class_meeting_slots slots
              on slots.class_id = classes.id
            where enrollments.student_id = links.owner_id
              and enrollments.active
          ),
          '[]'::jsonb
        )
      )
      from public.schedule_share_links links
      join public.profiles profiles on profiles.id = links.owner_id
      join private.account_moderation moderation on moderation.user_id = links.owner_id
      where links.token = p_token
        and links.enabled
        and profiles.privacy_setting = 'school'
        and moderation.suspended_at is null
        and moderation.deleted_at is null
        and exists (
          select 1
          from public.class_enrollments active_enrollment
          where active_enrollment.student_id = links.owner_id
            and active_enrollment.active
        )
    ),
    jsonb_build_object('available', false, 'schedule', '[]'::jsonb)
  );
$$;

revoke all on table public.schedule_share_links from public, anon, authenticated;
grant select on table public.schedule_share_links to authenticated;
grant insert (owner_id) on table public.schedule_share_links to authenticated;
grant update (enabled) on table public.schedule_share_links to authenticated;

revoke all on function public.get_or_create_schedule_share() from public, anon;
grant execute on function public.get_or_create_schedule_share() to authenticated;

revoke all on function public.get_public_schedule_share(uuid) from public, authenticated;
grant execute on function public.get_public_schedule_share(uuid) to anon;

comment on table public.schedule_share_links is
  'Unguessable capability URLs. Schedule content remains gated by live account state, link state, and the owner privacy setting.';
comment on function public.get_public_schedule_share(uuid) is
  'Intentional anonymous preview API returning only course names, A/B days, periods, and academic terms for enabled Anyone links.';
