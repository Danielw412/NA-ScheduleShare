-- Allow profile pictures up to 7 MiB in the existing public bucket.
update storage.buckets
set file_size_limit = 7340032
where id = 'profile-pictures';
