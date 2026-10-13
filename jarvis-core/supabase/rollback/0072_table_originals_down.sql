-- Rollback for 0072 (table originals in the user-files bucket).
-- Not a migration: lives outside supabase/migrations so nothing applies it by accident.
-- The bucket goes back to 0020's types. Table files already stored stay readable (the policies are by path, not type);
-- only new table uploads are refused, which the app reports as a kept-on-page original instead of a stored file.

update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/heic','image/webp','application/pdf']
 where id = 'user-files';
