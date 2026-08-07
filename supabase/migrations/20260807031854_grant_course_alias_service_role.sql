-- Guest schedule imports load the course catalogue through the Edge Function's
-- service-role client. Keep alias rows readable there as well as through the
-- public anon/authenticated catalogue paths.
grant select on table public.course_name_aliases to service_role;
