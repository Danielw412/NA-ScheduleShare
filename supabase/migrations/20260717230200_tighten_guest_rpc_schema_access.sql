-- Keep anonymous access confined to the deliberately shaped public RPCs.
-- SECURITY DEFINER is safe here because both wrappers have an empty search path
-- and can only return the bounded/redacted data produced by their private functions.

alter function public.guest_search_students(text, integer) security definer;
alter function public.get_homepage_statistic() security definer;

revoke all on function private.guest_search_students(text, integer) from anon;
revoke all on function private.get_homepage_statistic() from anon;
revoke usage on schema private from anon;
