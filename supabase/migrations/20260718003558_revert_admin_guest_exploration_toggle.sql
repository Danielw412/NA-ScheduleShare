-- Revert the administrator-controlled guest exploration feature.

drop function if exists public.admin_update_guest_exploration_enabled(boolean);
drop function if exists public.get_guest_exploration_enabled();
drop table if exists private.guest_access_settings;
