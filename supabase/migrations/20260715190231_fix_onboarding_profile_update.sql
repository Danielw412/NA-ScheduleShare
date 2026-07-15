-- Profile updates intentionally use column-limited grants plus self-only RLS.
-- Run the trigger with its owner's privileges so it can call the private
-- normalization helpers whose default PUBLIC execution was revoked.
alter function private.normalize_profile_fields() security definer;

revoke all on function private.normalize_profile_fields() from public, anon, authenticated;

comment on function private.normalize_profile_fields() is
  'Trigger-only profile normalization. SECURITY DEFINER is required because API roles cannot execute private normalization helpers; the function has a fixed empty search_path.';
