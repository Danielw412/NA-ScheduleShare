begin;
select plan(32);

select is(
  (select count(*) from public.course_names where source = 'approved'),
  304::bigint,
  'the authoritative TXT catalog imports all 304 unique nonblank names'
);
select is(
  (select count(distinct normalized_name) from public.course_names where source = 'approved'),
  304::bigint,
  'approved course names are unique after case-insensitive normalization'
);
select is(
  (select name from public.course_names where normalized_name = 'ap physics 1&2'),
  'AP Physics 1&2',
  'catalog import preserves source capitalization'
);
select ok(
  exists (select 1 from public.course_names where normalized_name = 'honors spanish 3')
  and not exists (select 1 from public.course_names where source = 'approved' and normalized_name = 'honors spanish iii'),
  'the authoritative catalog uses numbers rather than Roman numerals'
);
select is(
  private.import_course_names(array[' Import Dedup Course ', '', 'import   dedup course'], 'admin'),
  1,
  'the reusable importer ignores blanks and normalized duplicates'
);
select is(
  (select count(*) from public.course_names where normalized_name = 'import dedup course'),
  1::bigint,
  'rerunnable imports leave one normalized course-name row'
);
select throws_ok(
  $$insert into public.course_names (name, normalized_name, source) values ('IMPORT DEDUP COURSE', 'ignored by trigger', 'admin')$$,
  '23505',
  'duplicate key value violates unique constraint "course_names_normalized_name_key"',
  'the database unique index prevents case-insensitive duplicates'
);

insert into public.course_names (id, name, normalized_name, source)
values ('94000000-0000-4000-8000-000000000010', 'Course Catalog Regression', 'course catalog regression', 'admin');

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
values
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000010', 'De la Cruz', 'full_year', false, '10000000-0000-4000-8000-000000000001'),
  ('94000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000010', 'Morgan', 'semester_1', false, '10000000-0000-4000-8000-000000000001');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('94000000-0000-4000-8000-000000000001', 'A', 9),
  ('94000000-0000-4000-8000-000000000002', 'B', 9);

select is(
  (select count(*) from public.classes where course_name_id = '94000000-0000-4000-8000-000000000010'),
  2::bigint,
  'multiple class sections can reference one reusable course name'
);
select is(
  (select teacher_last_name from public.classes where id = '94000000-0000-4000-8000-000000000001'),
  'De la Cruz',
  'legitimate compound teacher last names are accepted'
);
select throws_ok(
  $$insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
    values ('94000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000010', 'Dr. Smith', 'full_year', false, '10000000-0000-4000-8000-000000000001')$$,
  '23514',
  'invalid_teacher_last_name',
  'teacher titles are rejected as obviously invalid last-name input'
);

insert into public.class_enrollments (student_id, class_id, academic_term)
values ('10000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000002', 'semester_1');

insert into public.reports (id, reporter_id, reported_class_id, reason_category, explanation)
values ('94000000-0000-4000-8000-000000000030', '10000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', 'duplicate_class', 'Delete regression report');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*) from public.search_course_names('CATALOG reg', 20) where course_name_id = '94000000-0000-4000-8000-000000000010'),
  1::bigint,
  'course-name search is case-insensitive and supports partial matches'
);
select is(
  (select count(*) from public.search_course_names('course   catalog', 20) where course_name_id = '94000000-0000-4000-8000-000000000010'),
  1::bigint,
  'course-name search ignores extra spaces'
);
select throws_ok(
  $$select * from public.admin_list_course_names()$$,
  '42501',
  'administrator_access_required',
  'regular users cannot use course-name administration RPCs'
);
select throws_ok(
  $$select public.admin_delete_class_section('94000000-0000-4000-8000-000000000002', 'Unauthorized permanent deletion')$$,
  '42501',
  'administrator_access_required',
  'regular users cannot permanently delete class sections'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.admin_delete_class_section('94000000-0000-4000-8000-000000000002', 'Confirmed permanent deletion test')$$,
  'an administrator can permanently delete a class section through the secure RPC'
);
select is(
  (select count(*) from public.classes where id = '94000000-0000-4000-8000-000000000002'),
  0::bigint,
  'permanent deletion removes the class section'
);
select is(
  (select count(*) from public.class_enrollments where class_id = '94000000-0000-4000-8000-000000000002'),
  0::bigint,
  'permanent deletion cascades related schedule entries'
);
select is(
  (select count(*) from public.reports where id = '94000000-0000-4000-8000-000000000030' and reported_class_id is null),
  1::bigint,
  'related reports safely clear the deleted section foreign key'
);
select is(
  (select reported_course_name_snapshot from public.reports where id = '94000000-0000-4000-8000-000000000030'),
  'Course Catalog Regression',
  'related reports preserve a readable linked course-name snapshot'
);
select ok(
  exists (select 1 from public.audit_logs where action_type = 'class_permanently_deleted' and target_id = '94000000-0000-4000-8000-000000000002'),
  'permanent deletion records an immutable audit entry'
);

reset role;
insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
values ('94000000-0000-4000-8000-000000000004', '94000000-0000-4000-8000-000000000010', 'Double Delete', 'full_year', true, '10000000-0000-4000-8000-000000000001');
insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('94000000-0000-4000-8000-000000000004', 'A', 4),
  ('94000000-0000-4000-8000-000000000004', 'B', 3),
  ('94000000-0000-4000-8000-000000000004', 'B', 4);
insert into public.class_enrollments (student_id, class_id, academic_term)
values ('10000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000004', 'full_year');
insert into public.reports (id, reporter_id, reported_class_id, reason_category, explanation)
values ('94000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000004', 'duplicate_class', 'Double delete regression report');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.admin_delete_class_section('94000000-0000-4000-8000-000000000004', 'Confirmed double-period deletion test')$$,
  'an administrator can delete a double-period class with asymmetric slots'
);
select is(
  (select count(*) from public.classes where id = '94000000-0000-4000-8000-000000000004'),
  0::bigint,
  'double-period permanent deletion removes the class section'
);
select is(
  (select count(*) from public.class_meeting_slots where class_id = '94000000-0000-4000-8000-000000000004'),
  0::bigint,
  'double-period permanent deletion removes every meeting slot'
);
select is(
  (select count(*) from public.class_enrollments where class_id = '94000000-0000-4000-8000-000000000004'),
  0::bigint,
  'double-period permanent deletion removes every related enrollment'
);
select is(
  (select count(*) from public.reports where id = '94000000-0000-4000-8000-000000000031' and reported_class_id is null),
  1::bigint,
  'double-period deletion clears report foreign keys'
);
select is(
  (select reported_course_name_snapshot from public.reports where id = '94000000-0000-4000-8000-000000000031'),
  'Course Catalog Regression',
  'double-period deletion preserves report snapshots'
);
select ok(
  exists (select 1 from public.audit_logs where action_type = 'class_permanently_deleted' and target_id = '94000000-0000-4000-8000-000000000004'),
  'double-period deletion records an immutable audit entry'
);
select ok(
  exists (
    select 1 from public.schedule_change_history
    where student_id = '10000000-0000-4000-8000-000000000003'
      and new_value ->> 'class_id' = '94000000-0000-4000-8000-000000000004'
      and new_value ->> 'permanently_deleted' = 'true'
  ),
  'double-period deletion preserves immutable schedule history'
);
reset role;
select is(
  private.normalize_course_match('Honors English III'),
  'honors english 3',
  'legacy Roman-numeral names normalize to numeric catalog matches during migration'
);
select ok(
  not exists (select 1 from public.classes where course_name_id is null),
  'every preserved class section is linked to a master course name'
);
select hasnt_column(
  'public', 'classes', 'class_name',
  'the obsolete denormalized class-name column is removed after backfill'
);
select is(
  (select count(*) from public.class_enrollments where student_id in ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003')),
  8::bigint,
  'catalog migration preserves the seeded student schedule enrollments'
);

select * from finish();
rollback;
