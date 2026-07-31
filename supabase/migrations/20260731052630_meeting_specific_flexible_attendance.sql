-- Keep Gym and Study Hall on the shared flexible-attendance policy while
-- giving Wellness an exact-section policy in the following migration.
-- Enum additions must commit before PostgreSQL can safely use the new value.
alter type public.course_term_policy
add value if not exists 'sectioned_attendance' after 'flexible_attendance';
