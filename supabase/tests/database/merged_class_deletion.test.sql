begin;
select plan(9);

select is(
  private.normalize_teacher_last_name('Joe Smith'),
  'Smith',
  'two-word teacher names automatically keep only the final word'
);

insert into public.course_names (id, name, normalized_name, source)
values ('95000000-0000-4000-8000-000000000010', 'Merged Class Cleanup Regression', 'merged class cleanup regression', 'admin');

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
values
  ('95000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000010', 'Smith', 'full_year', false, '10000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000010', 'Smith', 'full_year', false, '10000000-0000-4000-8000-000000000001');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('95000000-0000-4000-8000-000000000001', 'A', 8),
  ('95000000-0000-4000-8000-000000000001', 'B', 8),
  ('95000000-0000-4000-8000-000000000002', 'A', 8),
  ('95000000-0000-4000-8000-000000000002', 'B', 8);

insert into public.class_enrollments (id, student_id, class_id, academic_term)
values ('95000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000003', '95000000-0000-4000-8000-000000000002', 'full_year');

select lives_ok(
  $$select private.merge_class_records(
    '95000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000002',
    null,
    'Merged class deletion regression'
  )$$,
  'merging two matching classes completes successfully'
);

select is(
  (select count(*) from public.classes where id = '95000000-0000-4000-8000-000000000002'),
  0::bigint,
  'the duplicate class row is deleted instead of left with merged status'
);

select is(
  (select count(*) from public.class_enrollments where id = '95000000-0000-4000-8000-000000000020' and class_id = '95000000-0000-4000-8000-000000000001'),
  1::bigint,
  'the duplicate enrollment is moved to the canonical class before deletion'
);

select is(
  (select count(*) from public.class_enrollment_meeting_slots where enrollment_id = '95000000-0000-4000-8000-000000000020'),
  2::bigint,
  'enrollment-specific meeting slots survive the class merge'
);

select is(
  (select count(*) from public.reports where id = '95000000-0000-4000-8000-000000000030' and reported_class_id is null),
  1::bigint,
  'reports safely clear their class foreign key when the merged duplicate is deleted'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where action_type = 'class_merged'
      and after_values ->> 'duplicate_class_id' = '95000000-0000-4000-8000-000000000002'
      and after_values ->> 'duplicate_deleted' = 'true'
  ),
  'the immutable audit log records that the duplicate row was deleted'
);

select ok(
  exists (
    select 1
    from public.schedule_change_history
    where student_id = '10000000-0000-4000-8000-000000000003'
      and new_value ->> 'class_id' = '95000000-0000-4000-8000-000000000001'
      and new_value ->> 'merge_from' = '95000000-0000-4000-8000-000000000002'
  ),
  'schedule history preserves the original duplicate class ID after deletion'
);

select is(
  (select status::text from public.classes where id = '95000000-0000-4000-8000-000000000001'),
  'active',
  'the canonical class remains active'
);

select * from finish();
rollback;
