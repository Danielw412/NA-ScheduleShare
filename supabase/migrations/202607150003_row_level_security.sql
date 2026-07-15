-- Every exposed public table is protected by RLS. Direct-table access is limited to the minimum columns/actions.

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_meeting_slots enable row level security;
alter table public.class_enrollments enable row level security;
alter table public.schedule_change_history enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;
alter table private.account_moderation enable row level security;
alter table private.user_roles enable row level security;
alter table private.rate_limit_events enable row level security;

create policy profiles_select_permitted
on public.profiles
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and (
    id = (select auth.uid())
    or private.is_admin((select auth.uid()))
    or privacy_setting = 'school'
    or private.shares_active_class((select auth.uid()), id)
  )
);

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
  and private.is_active_user((select auth.uid()))
)
with check (
  id = (select auth.uid())
  and private.is_active_user((select auth.uid()))
);

create policy classes_select_after_schedule_started
on public.classes
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and status = 'active'
  and (
    private.has_active_enrollment((select auth.uid()))
    or private.is_admin((select auth.uid()))
  )
);

create policy class_slots_select_after_schedule_started
on public.class_meeting_slots
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and (
    private.has_active_enrollment((select auth.uid()))
    or private.is_admin((select auth.uid()))
  )
  and exists (select 1 from public.classes c where c.id = class_id and c.status = 'active')
);

create policy enrollments_select_privacy_enforced
on public.class_enrollments
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and (
    student_id = (select auth.uid())
    or private.is_admin((select auth.uid()))
    or private.can_view_full_schedule((select auth.uid()), student_id)
    or private.is_enrolled_in_class((select auth.uid()), class_id)
  )
);

create policy schedule_history_select_owner_or_admin
on public.schedule_change_history
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and (
    student_id = (select auth.uid())
    or private.is_admin((select auth.uid()))
  )
);

create policy reports_select_reporter_or_admin
on public.reports
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and (
    reporter_id = (select auth.uid())
    or private.is_admin((select auth.uid()))
  )
);

create policy audit_logs_select_admin
on public.audit_logs
for select
to authenticated
using (private.is_admin((select auth.uid())));

-- Explicit Data API privileges are required by current Supabase projects.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.classes from anon, authenticated;
revoke all on table public.class_meeting_slots from anon, authenticated;
revoke all on table public.class_enrollments from anon, authenticated;
revoke all on table public.schedule_change_history from anon, authenticated;
revoke all on table public.reports from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (full_name, grade, privacy_setting, onboarding_completed) on table public.profiles to authenticated;
grant select on table public.classes to authenticated;
grant select on table public.class_meeting_slots to authenticated;
grant select on table public.class_enrollments to authenticated;
grant select on table public.schedule_change_history to authenticated;
grant select on table public.reports to authenticated;
grant select on table public.audit_logs to authenticated;

revoke all on all tables in schema private from anon, authenticated;
revoke all on all sequences in schema private from anon, authenticated;

comment on policy enrollments_select_privacy_enforced on public.class_enrollments is
  'Private owners expose only enrollment rows for classes the viewer is also enrolled in. Classmates/School privacy can expose the full schedule.';
