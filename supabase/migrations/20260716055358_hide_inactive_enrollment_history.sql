-- Schedule and roster discovery only expose active enrollments. Keep inactive
-- history available to its owner and administrators, but do not leak it through
-- direct Data API reads merely because the current schedule is visible.

drop policy if exists enrollments_select_privacy_enforced on public.class_enrollments;
create policy enrollments_select_privacy_enforced
on public.class_enrollments
for select
to authenticated
using (
  private.is_active_user((select auth.uid()))
  and (
    student_id = (select auth.uid())
    or private.is_admin((select auth.uid()))
    or (
      active
      and private.can_view_roster_member((select auth.uid()), student_id)
    )
  )
);

comment on policy enrollments_select_privacy_enforced on public.class_enrollments is
  'Owners/admins may read enrollment history; regular viewers receive only active rows whose owner-based roster privacy permits access.';
