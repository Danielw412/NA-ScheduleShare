begin;
select plan(10);

insert into public.course_names (id, name, normalized_name, source)
values ('92000000-0000-4000-8000-000000000011', 'Cross Slot Lab', 'cross slot lab', 'admin');

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
values ('92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', 'Example', 'full_year', false, '10000000-0000-4000-8000-000000000001');

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('92000000-0000-4000-8000-000000000001', 'A', 1),
  ('92000000-0000-4000-8000-000000000001', 'B', 2);

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
select '92000000-0000-4000-8000-000000000002', id, 'Patel', 'full_year', false, '10000000-0000-4000-8000-000000000001'
from public.course_names where normalized_name = 'academic chemistry';

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period, created_by)
select '92000000-0000-4000-8000-000000000003', id, 'Kim', 'full_year', false, '10000000-0000-4000-8000-000000000001'
from public.course_names where normalized_name = 'academic physics';

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('92000000-0000-4000-8000-000000000002', 'A', 4),
  ('92000000-0000-4000-8000-000000000002', 'B', 4),
  ('92000000-0000-4000-8000-000000000003', 'A', 7);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select cmp_ok((select count(*) from public.search_classes('', null::public.day_type, null::smallint, 20)), '>=', 3::bigint, 'an empty search returns active classes for an authenticated student');
select is(
  (select count(*) from public.search_classes('', null::public.day_type, null::smallint, 1000)),
  (select count(distinct c.id) from public.classes c join public.class_meeting_slots s on s.class_id = c.id where c.status = 'active'),
  'the complete-catalog limit returns every active class section'
);
select is((select count(*) from public.search_classes('chem', null::public.day_type, null::smallint, 20) where class_id = '92000000-0000-4000-8000-000000000002'), 1::bigint, 'course-name search finds Academic Chemistry');
select is((select count(*) from public.search_classes('patel', null::public.day_type, null::smallint, 20) where class_id = '92000000-0000-4000-8000-000000000002'), 1::bigint, 'teacher-last-name search finds Patel');
select is((select count(*) from public.search_classes('', 'A'::public.day_type, null::smallint, 20) where class_id = '92000000-0000-4000-8000-000000000003'), 1::bigint, 'day-only filtering includes a matching A-day class');
select is((select count(*) from public.search_classes('', null::public.day_type, 7::smallint, 20) where class_id = '92000000-0000-4000-8000-000000000003'), 1::bigint, 'period-only filtering includes a matching period-seven class');
select is((select count(*) from public.search_classes('', 'A'::public.day_type, 7::smallint, 20) where class_id = '92000000-0000-4000-8000-000000000003'), 1::bigint, 'the Add Class preselected A-day period-seven cell includes Physics');
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
