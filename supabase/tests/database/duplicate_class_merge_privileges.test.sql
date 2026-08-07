begin;
select plan(8);

select ok(
  not has_function_privilege('authenticated', 'private.merge_class_records(uuid,uuid,uuid,text)', 'EXECUTE'),
  'authenticated users cannot execute the low-level class merge helper'
);
select ok(
  not has_function_privilege('anon', 'private.merge_class_records(uuid,uuid,uuid,text)', 'EXECUTE'),
  'anonymous users cannot execute the low-level class merge helper'
);
select ok(
  not has_function_privilege('authenticated', 'private.coalesce_duplicate_classes_for_course(uuid,uuid,text)', 'EXECUTE'),
  'authenticated users cannot execute the low-level duplicate coalescer'
);
select ok(
  not has_function_privilege('anon', 'private.coalesce_duplicate_classes_for_course(uuid,uuid,text)', 'EXECUTE'),
  'anonymous users cannot execute the low-level duplicate coalescer'
);
select ok(
  not has_function_privilege('service_role', 'private.merge_class_records(uuid,uuid,uuid,text)', 'EXECUTE'),
  'service role cannot bypass the admin merge entry point through the low-level helper'
);
select ok(
  not has_function_privilege('service_role', 'private.coalesce_duplicate_classes_for_course(uuid,uuid,text)', 'EXECUTE'),
  'service role cannot bypass the admin coalescer through the low-level helper'
);
select ok(
  has_function_privilege('authenticated', 'private.admin_coalesce_duplicate_classes_for_course(uuid,text)', 'EXECUTE'),
  'authenticated callers can reach the admin-checked coalescer entry point'
);
select ok(
  not has_function_privilege('anon', 'private.admin_coalesce_duplicate_classes_for_course(uuid,text)', 'EXECUTE'),
  'anonymous callers cannot reach the admin coalescer entry point'
);

select * from finish();
rollback;
