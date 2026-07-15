begin;
select plan(9);

insert into public.classes (id, class_name, teacher_name, default_academic_term, is_double_period, created_by)
values ('92000000-0000-4000-8000-000000000001', 'Cross Slot Lab', 'Dr. Example', 'full_year', false, '10000000-0000-4000-8000-000000000001');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('92000000-0000-4000-8000-000000000001', 'A', 1),
  ('92000000-0000-4000-8000-000000000001', 'B', 2);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is((select count(*) from public.search_classes('', null::public.day_type, null::smallint, 20)), 7::bigint, 'an empty search returns active classes for an authenticated student');
select is((select count(*) from public.search_classes('chem', null::public.day_type, null::smallint, 20) where class_id = '20000000-0000-4000-8000-000000000002'), 1::bigint, 'class-name search finds Chemistry');
select is((select count(*) from public.search_classes('patel', null::public.day_type, null::smallint, 20) where class_id = '20000000-0000-4000-8000-000000000002'), 1::bigint, 'teacher-name search finds Mr. Patel');
select is((select count(*) from public.search_classes('', 'A'::public.day_type, null::smallint, 20) where class_id = '20000000-0000-4000-8000-000000000006'), 1::bigint, 'day-only filtering includes a matching A-day class');
select is((select count(*) from public.search_classes('', null::public.day_type, 7::smallint, 20) where class_id = '20000000-0000-4000-8000-000000000006'), 1::bigint, 'period-only filtering includes a matching period-seven class');
select is((select count(*) from public.search_classes('', 'A'::public.day_type, 7::smallint, 20) where class_id = '20000000-0000-4000-8000-000000000006'), 1::bigint, 'the Add Class preselected A-day period-seven cell includes Physics');
select is((select count(*) from public.search_classes('', 'A'::public.day_type, 2::smallint, 20) where class_id = '92000000-0000-4000-8000-000000000001'), 0::bigint, 'combined filters require one slot to match the exact day and period');
select is((select count(*) from public.search_classes('not a real class or teacher', null::public.day_type, null::smallint, 20)), 0::bigint, 'a genuine empty search result is returned without an error');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.search_classes('', null::public.day_type, null::smallint, 20)$$,
  '42501',
  'permission denied for function search_classes',
  'anonymous callers cannot execute class search'
);

select * from finish();
rollback;
