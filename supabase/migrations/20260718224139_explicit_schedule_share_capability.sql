-- Creating or re-enabling a share link is an explicit capability grant. The
-- owner's directory privacy setting continues to control discovery elsewhere,
-- but it does not invalidate a link the owner intentionally shared.
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
      join private.account_moderation moderation on moderation.user_id = links.owner_id
      where links.token = p_token
        and links.enabled
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

revoke all on function public.get_public_schedule_share(uuid) from public;
grant execute on function public.get_public_schedule_share(uuid) to anon, authenticated;

comment on table public.schedule_share_links is
  'Unguessable capability URLs created explicitly by schedule owners. Directory privacy remains independently enforced.';
comment on function public.get_public_schedule_share(uuid) is
  'Token-gated API returning only course names, A/B days, periods, and academic terms for enabled links owned by active accounts.';
