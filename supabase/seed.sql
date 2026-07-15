-- Local-only seed data. Password for every seeded account: ClassMatch123!
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@classmatch.local', extensions.crypt('ClassMatch123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Avery Admin"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'jordan@classmatch.local', extensions.crypt('ClassMatch123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Jordan Smith"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'alex@classmatch.local', extensions.crypt('ClassMatch123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Alex Morgan"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

update public.profiles set grade = 12, privacy_setting = 'school', onboarding_completed = true where id = '10000000-0000-4000-8000-000000000001';
update public.profiles set grade = 11, privacy_setting = 'classmates', onboarding_completed = true where id = '10000000-0000-4000-8000-000000000002';
update public.profiles set grade = 11, privacy_setting = 'school', onboarding_completed = true where id = '10000000-0000-4000-8000-000000000003';

insert into private.user_roles (user_id, role, granted_by)
values ('10000000-0000-4000-8000-000000000001', 'administrator', '10000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;

insert into public.classes (id, class_name, teacher_name, default_academic_term, is_double_period, created_by)
values
  ('20000000-0000-4000-8000-000000000001', 'AP English Language', 'Ms. Carter', 'full_year', false, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Chemistry', 'Mr. Patel', 'full_year', false, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000003', 'Algebra II', 'Ms. Rivera', 'full_year', false, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000004', 'AP US History', 'Mr. Johnson', 'full_year', true, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000005', 'Spanish III', 'Ms. Lopez', 'full_year', false, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000006', 'Physics', 'Dr. Kim', 'full_year', false, '10000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.class_meeting_slots (class_id, day_type, period_number)
values
  ('20000000-0000-4000-8000-000000000001', 'A', 1), ('20000000-0000-4000-8000-000000000001', 'B', 1),
  ('20000000-0000-4000-8000-000000000002', 'A', 2), ('20000000-0000-4000-8000-000000000002', 'B', 2),
  ('20000000-0000-4000-8000-000000000003', 'A', 3), ('20000000-0000-4000-8000-000000000003', 'B', 3),
  ('20000000-0000-4000-8000-000000000004', 'A', 4), ('20000000-0000-4000-8000-000000000004', 'A', 5),
  ('20000000-0000-4000-8000-000000000004', 'B', 4), ('20000000-0000-4000-8000-000000000004', 'B', 5),
  ('20000000-0000-4000-8000-000000000005', 'A', 6), ('20000000-0000-4000-8000-000000000005', 'B', 6),
  ('20000000-0000-4000-8000-000000000006', 'A', 7)
on conflict (class_id, day_type, period_number) do nothing;

insert into public.class_enrollments (student_id, class_id, academic_term)
values
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'full_year'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'full_year'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'full_year'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004', 'full_year'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', 'full_year'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000006', 'full_year'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'full_year'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'full_year')
on conflict (student_id, class_id) do nothing;

commit;
