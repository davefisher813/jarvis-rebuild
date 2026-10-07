-- Rollback of 0057. The columns hold derived lifecycle state and cached access
-- tokens; the refresh tokens themselves (token_enc) are untouched, so nothing
-- is lost for good. A DEAD row loses its mark and is tried again, which fails
-- once at Google and is marked again the next time the migration is applied.
drop function if exists public.google_refresh_lock(uuid, text, integer);
drop function if exists public.google_signin_forget(uuid, text);
drop function if exists public.google_grant_revoked(uuid, text, text, text, integer, text);
drop function if exists public.google_refresh_failed(uuid, text);
drop function if exists public.google_refresh_record(uuid, text, text, timestamptz, text, timestamptz, text);
drop function if exists public.google_signin_keep(uuid, text, text, text, timestamptz, timestamptz, text);
alter table google_tokens drop column if exists refresh_lock_until;
alter table google_tokens drop column if exists last_auth_error;
alter table google_tokens drop column if exists dead_at;
alter table google_tokens drop column if exists last_failure_at;
alter table google_tokens drop column if exists consecutive_failures;
alter table google_tokens drop column if exists last_refresh_ok_at;
alter table google_tokens drop column if exists granted_at;
alter table google_tokens drop column if exists granted_scope;
alter table google_tokens drop column if exists refresh_expires_at;
alter table google_tokens drop column if exists access_expires_at;
alter table google_tokens drop column if exists access_enc;
alter table google_tokens drop column if exists state;
