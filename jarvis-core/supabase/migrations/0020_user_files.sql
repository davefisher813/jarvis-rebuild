-- Migration 0020: private per-user file storage for chat uploads and note
-- attachments (2026-08-14 session, corrections item 6; the pack numbered this
-- 0016 but 0016-0018 were already taken in this repo, so it lands as 0020).
--
-- One private bucket, 10MB server-side limit (the client also rejects over
-- 10MB before any network call), image and pdf types only. Path convention:
-- user-files/{auth.uid}/{entity_id}/{filename}, and every policy pins the
-- first folder segment to the caller's uid so users can only ever touch
-- their own tree. The client strips EXIF (including GPS) from images BEFORE
-- upload; a unit test asserts no GPS tags survive the pipeline.
--
-- Retention: files live until their owning entity is deleted (the app
-- cascades the storage delete in the same operation) or the user deletes
-- them directly.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-files', 'user-files', false, 10485760,
        array['image/jpeg','image/png','image/heic','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "users read own files" on storage.objects;
create policy "users read own files" on storage.objects
  for select using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users write own files" on storage.objects;
create policy "users write own files" on storage.objects
  for insert with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete own files" on storage.objects;
create policy "users delete own files" on storage.objects
  for delete using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);
