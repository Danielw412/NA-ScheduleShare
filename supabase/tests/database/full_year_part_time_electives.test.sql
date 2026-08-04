begin;
select plan(4);

select is(
  (select term_policy::text from public.course_names where normalized_name = 'journalism - naeye news'),
  'sectioned_attendance',
  'Journalism - NAEye News supports semester or full-year alternating-day formats'
);
select is(
  (select term_policy::text from public.course_names where normalized_name = 'executive functioning'),
  'sectioned_attendance',
  'Executive Functioning supports semester or full-year alternating-day formats'
);
select is(
  (select term_policy::text from public.course_names where normalized_name = '9th grade chorus'),
  'sectioned_attendance',
  '9th Grade Chorus supports semester or full-year alternating-day formats'
);
select is(
  (select term_policy::text from public.course_names where normalized_name = '10th grade chorus'),
  'sectioned_attendance',
  '10th Grade Chorus supports semester or full-year alternating-day formats'
);

select * from finish();
rollback;
