-- Preserve the bounded guest search while allowing the public wrapper to call
-- the private redaction function without granting access to the private schema.
create or replace function public.guest_search_students(
  p_first_name text,
  p_limit integer default 12
)
returns table (
  first_name text,
  last_initial text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.guest_search_students(p_first_name, p_limit);
$$;

revoke all on function public.guest_search_students(text, integer) from public, authenticated;
grant execute on function public.guest_search_students(text, integer) to anon, service_role;

comment on function public.guest_search_students(text, integer) is
  'Guest-only bounded exact first-name search. Returns no stable user identifier and only redacted first-name/last-initial display fields for active Anyone profiles.';
