create or replace function private.admin_coalesce_duplicate_classes_for_course(
  target_course_name_id uuid,
  action_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  actor_id := private.require_admin();
  return private.coalesce_duplicate_classes_for_course(
    target_course_name_id,
    actor_id,
    action_reason
  );
end;
$$;

-- Low-level merge helpers are implementation details. Keep them callable only
-- from trusted SECURITY DEFINER functions owned by postgres.
revoke all on function private.merge_class_records(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.coalesce_duplicate_classes_for_course(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_coalesce_duplicate_classes_for_course(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.admin_coalesce_duplicate_classes_for_course(uuid, text)
  to authenticated;

create or replace function public.admin_update_class(
  p_class_id uuid,
  p_course_name_id uuid,
  p_teacher_last_name text,
  p_academic_term public.academic_term,
  p_is_double_period boolean,
  p_meeting_slots jsonb,
  p_reason text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.admin_update_class(
    p_class_id,
    p_course_name_id,
    p_teacher_last_name,
    p_academic_term,
    p_is_double_period,
    p_meeting_slots,
    p_reason
  );

  perform private.admin_coalesce_duplicate_classes_for_course(
    p_course_name_id,
    'Automatic duplicate merge after class edit: ' || coalesce(p_reason, 'admin edit')
  );
end;
$$;

create or replace function public.admin_merge_course_names(
  p_canonical_course_name_id uuid,
  p_duplicate_course_name_id uuid,
  p_reason text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.admin_merge_course_names(
    p_canonical_course_name_id,
    p_duplicate_course_name_id,
    p_reason
  );

  perform private.admin_coalesce_duplicate_classes_for_course(
    p_canonical_course_name_id,
    'Automatic duplicate merge after course-name merge: ' || coalesce(p_reason, 'course-name merge')
  );
end;
$$;