create index super_admins_granted_by_idx
  on private.super_admins (granted_by)
  where granted_by is not null;
