begin;
select plan(8);

select ok(
  (
    select bool_and(not coalesce(has_function_privilege('anon', function_name, 'execute'), true))
    from (values
      ('public.is_current_user_super_admin()'),
      ('public.super_admin_add(text)'),
      ('public.super_admin_list_logs(text,text,text,text,timestamptz,timestamptz,text,integer,integer)'),
      ('public.super_admin_delete_log(uuid,text)'),
      ('public.super_admin_delete_logs(text,text,text,text,timestamptz,timestamptz,text,text)'),
      ('public.super_admin_get_activity_summary()'),
      ('public.super_admin_get_site_reset_preview()'),
      ('public.mark_user_active()'),
      ('public.record_share_button_pressed()'),
      ('public.record_authenticated_event(text,text,jsonb)'),
      ('public.record_schedule_import_event(text,uuid,text,jsonb)'),
      ('public.admin_record_profile_picture_removed(uuid,text)')
    ) as protected_functions(function_name)
  ),
  'anonymous callers cannot execute authenticated or administrative RPCs'
);

select ok(
  (
    select bool_and(coalesce(has_function_privilege('authenticated', function_name, 'execute'), false))
    from (values
      ('public.is_current_user_super_admin()'),
      ('public.super_admin_add(text)'),
      ('public.super_admin_list_logs(text,text,text,text,timestamptz,timestamptz,text,integer,integer)'),
      ('public.super_admin_delete_log(uuid,text)'),
      ('public.super_admin_delete_logs(text,text,text,text,timestamptz,timestamptz,text,text)'),
      ('public.super_admin_get_activity_summary()'),
      ('public.super_admin_get_site_reset_preview()'),
      ('public.mark_user_active()'),
      ('public.record_share_button_pressed()'),
      ('public.record_authenticated_event(text,text,jsonb)'),
      ('public.record_schedule_import_event(text,uuid,text,jsonb)'),
      ('public.admin_record_profile_picture_removed(uuid,text)')
    ) as protected_functions(function_name)
  ),
  'authenticated callers retain access to authenticated RPC entrypoints'
);

select ok(
  (
    select bool_and(coalesce(has_function_privilege('anon', function_name, 'execute'), false))
    from (values
      ('public.get_homepage_statistic()'),
      ('public.get_public_schedule_share(uuid)'),
      ('public.get_schedule_import_ui_settings()'),
      ('public.guest_search_classes(text,public.day_type,smallint,integer,public.academic_term)'),
      ('public.guest_search_course_names(text,integer)'),
      ('public.guest_search_students(text,integer)'),
      ('public.record_auth_attempt(text,text,text,text)')
    ) as public_functions(function_name)
  ),
  'intentional read-only and authentication telemetry RPCs remain public'
);

select ok(
  has_table_privilege('service_role', 'public.course_names', 'select')
  and has_table_privilege('service_role', 'public.classes', 'select')
  and has_table_privilege('service_role', 'public.class_meeting_slots', 'select'),
  'the guest importer service client can read its explicit catalog relations'
);

select ok(
  not exists (
    select 1
    from pg_default_acl default_acl
    join pg_namespace namespace on namespace.oid = default_acl.defaclnamespace
    cross join lateral aclexplode(default_acl.defaclacl) privilege
    left join pg_roles grantee on grantee.oid = privilege.grantee
    where default_acl.defaclrole = 'postgres'::regrole
      and namespace.nspname in ('public', 'private')
      and (
        privilege.grantee = 0
        or grantee.rolname in ('anon', 'authenticated', 'service_role')
      )
  ),
  'future API objects require deliberate grants instead of default exposure'
);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and not relation.relrowsecurity
  ),
  'every public application table has row-level security enabled'
);

select ok(
  not exists (
    select 1
    from pg_proc function_record
    join pg_namespace namespace on namespace.oid = function_record.pronamespace
    where namespace.nspname in ('public', 'private')
      and not ('search_path=""' = any(coalesce(function_record.proconfig, '{}'::text[])))
  ),
  'every application function pins an empty search path'
);

select ok(
  (
    select bool_and(to_regclass(index_name) is not null)
    from (values
      ('private.account_moderation_suspended_by_idx'),
      ('private.homepage_statistic_settings_updated_by_idx'),
      ('private.schedule_import_diagnostic_logs_administrator_id_idx'),
      ('private.schedule_import_diagnostic_logs_model_id_idx'),
      ('private.schedule_import_settings_active_model_id_idx'),
      ('private.schedule_import_settings_updated_by_idx'),
      ('private.user_roles_granted_by_idx'),
      ('public.audit_logs_administrator_id_idx'),
      ('public.classes_created_by_idx'),
      ('public.course_names_created_by_idx'),
      ('public.reports_assigned_admin_id_idx'),
      ('public.reports_reporter_id_idx'),
      ('public.schedule_change_history_changed_by_idx')
    ) as required_indexes(index_name)
  ),
  'foreign keys used by account and admin operations have covering indexes'
);

select * from finish();
rollback;
