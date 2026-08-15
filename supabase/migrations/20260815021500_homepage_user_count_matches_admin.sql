-- Keep the public "students joined" homepage statistic aligned with the
-- super-admin Users summary. Both totals now use the same source of truth:
-- the current row count in public.profiles.

create or replace function private.get_homepage_statistic()
returns table (
  statistic_key text,
  activity_scope text,
  statistic_value bigint,
  statistic_label text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings private.homepage_statistic_settings%rowtype;
  calculated_value bigint := 0;
  recent_cutoff timestamptz := now() - interval '30 days';
begin
  select * into settings
  from private.homepage_statistic_settings
  where singleton;

  if not found or not settings.shown then
    return;
  end if;

  if settings.statistic_key = 'students_joined' then
    select count(*) into calculated_value
    from public.profiles profile
    where settings.activity_scope = 'total'
      or profile.created_at >= recent_cutoff;
  elsif settings.statistic_key = 'schedules_uploaded' then
    select count(distinct enrollment.student_id) into calculated_value
    from public.class_enrollments enrollment
    join public.profiles profile on profile.id = enrollment.student_id
    join private.account_moderation moderation on moderation.user_id = profile.id
    where enrollment.active
      and profile.onboarding_completed
      and moderation.suspended_at is null
      and moderation.deleted_at is null
      and (
        settings.activity_scope = 'total'
        or greatest(enrollment.created_at, enrollment.updated_at) >= recent_cutoff
      );
  else
    select count(*) into calculated_value
    from (
      select first_enrollment.class_id, first_enrollment.student_id, second_enrollment.student_id
      from public.class_enrollments first_enrollment
      join public.class_enrollments second_enrollment
        on second_enrollment.class_id = first_enrollment.class_id
       and second_enrollment.student_id > first_enrollment.student_id
       and second_enrollment.active
      join public.classes class_record
        on class_record.id = first_enrollment.class_id
       and class_record.status = 'active'
      join public.profiles first_profile on first_profile.id = first_enrollment.student_id
      join public.profiles second_profile on second_profile.id = second_enrollment.student_id
      join private.account_moderation first_moderation on first_moderation.user_id = first_profile.id
      join private.account_moderation second_moderation on second_moderation.user_id = second_profile.id
      where first_enrollment.active
        and first_profile.onboarding_completed
        and second_profile.onboarding_completed
        and first_moderation.suspended_at is null
        and first_moderation.deleted_at is null
        and second_moderation.suspended_at is null
        and second_moderation.deleted_at is null
        and (
          settings.activity_scope = 'total'
          or greatest(first_enrollment.updated_at, second_enrollment.updated_at) >= recent_cutoff
        )
    ) connections;
  end if;

  if calculated_value < settings.minimum_value then
    return;
  end if;

  return query
  select settings.statistic_key,
         settings.activity_scope,
         calculated_value,
         case settings.statistic_key
           when 'students_joined' then 'NA students joined'
           when 'schedules_uploaded' then 'schedules uploaded'
           else 'class connections found'
         end;
end;
$$;

comment on function public.get_homepage_statistic() is
  'Returns at most one configured social-proof aggregate. The total students_joined value matches the super-admin Users total from public.profiles.';
