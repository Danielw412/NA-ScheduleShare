-- Profile pictures are public-facing media, but only an active authenticated
-- user may create, replace, inspect through the API, or delete their own object.
-- A stable <auth.uid()>/avatar path keeps directory RPC return contracts unchanged.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-pictures',
  'profile-pictures',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_pictures_select_own on storage.objects;
drop policy if exists profile_pictures_insert_own on storage.objects;
drop policy if exists profile_pictures_update_own on storage.objects;
drop policy if exists profile_pictures_delete_own on storage.objects;

create policy profile_pictures_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-pictures'
  and name = (select auth.uid())::text || '/avatar'
  and private.is_active_user((select auth.uid()))
);

create policy profile_pictures_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-pictures'
  and name = (select auth.uid())::text || '/avatar'
  and private.is_active_user((select auth.uid()))
);

create policy profile_pictures_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-pictures'
  and name = (select auth.uid())::text || '/avatar'
  and private.is_active_user((select auth.uid()))
)
with check (
  bucket_id = 'profile-pictures'
  and name = (select auth.uid())::text || '/avatar'
  and private.is_active_user((select auth.uid()))
);

create policy profile_pictures_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-pictures'
  and name = (select auth.uid())::text || '/avatar'
  and private.is_active_user((select auth.uid()))
);
