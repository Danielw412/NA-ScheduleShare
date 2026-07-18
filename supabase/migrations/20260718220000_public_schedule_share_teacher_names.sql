-- Teacher last names are part of the public schedule preview by product design.
-- The capability URL remains bounded to schedule information and never exposes
-- student identities, class IDs, contact details, or private account data.
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
                'teacher_last_name', classes.teacher_last_name,
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

comment on function public.get_public_schedule_share(uuid) is
  'Intentional anonymous preview API returning only course names, teacher last names, A/B days, periods, and academic terms for enabled Anyone links.';
