begin;
select plan(6);

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period)
select '97000000-0000-4000-8000-000000000001', id, 'Cafe', 'semester_1', false
from public.course_names
where normalized_name = 'lunch - nash';

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period)
select '97000000-0000-4000-8000-000000000002', id, 'Advisor', 'semester_1', false
from public.course_names
where normalized_name = 'study hall - nash';

insert into public.classes (id, course_name_id, teacher_last_name, default_academic_term, is_double_period)
select '97000000-0000-4000-8000-000000000003', id, 'Kim', 'full_year', false
from public.course_names
where normalized_name = 'academic physics';

insert into public.class_meeting_slots (class_id, day_type, period_number) values
  ('97000000-0000-4000-8000-000000000001', 'A', 7),
  ('97000000-0000-4000-8000-000000000001', 'B', 7),
  ('97000000-0000-4000-8000-000000000002', 'A', 8),
  ('97000000-0000-4000-8000-000000000002', 'B', 8),
  ('97000000-0000-4000-8000-000000000003', 'A', 9),
  ('97000000-0000-4000-8000-000000000003', 'B', 9);

select is(
  (select teacher_last_name from public.classes where id = '97000000-0000-4000-8000-000000000001'),
  'N/A',
  'Lunch teacher is forced to N/A on insert'
);
select is(
  (select teacher_last_name from public.classes where id = '97000000-0000-4000-8000-000000000002'),
  'N/A',
  'Study Hall teacher is forced to N/A on insert'
);
select is(
  (select normalized_teacher_last_name from public.classes where id = '97000000-0000-4000-8000-000000000001'),
  private.normalize_search('N/A'),
  'Lunch normalized teacher is also N/A'
);
select is(
  (select teacher_last_name from public.classes where id = '97000000-0000-4000-8000-000000000003'),
  'Kim',
  'ordinary course teachers are unchanged'
);

update public.classes
set teacher_last_name = 'Changed', normalized_teacher_last_name = private.normalize_search('Changed')
where id = '97000000-0000-4000-8000-000000000001';
select is(
  (select teacher_last_name from public.classes where id = '97000000-0000-4000-8000-000000000001'),
  'N/A',
  'Lunch teacher remains N/A after an edit'
);

update public.classes
set course_name_id = (select id from public.course_names where normalized_name = 'study hall - nash'),
    teacher_last_name = 'Changed',
    normalized_teacher_last_name = private.normalize_search('Changed')
where id = '97000000-0000-4000-8000-000000000003';
select is(
  (select teacher_last_name from public.classes where id = '97000000-0000-4000-8000-000000000003'),
  'N/A',
  'changing a class to Study Hall forces its teacher to N/A'
);

select * from finish();
rollback;
