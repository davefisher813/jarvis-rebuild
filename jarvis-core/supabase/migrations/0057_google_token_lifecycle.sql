-- Migration 0057: one credential store, one revocation path (Foundation Fix
-- Spec 2, 2026-10-07). Additive; rollback in
-- rollback/0057_google_token_lifecycle_down.sql.
--
-- google_tokens (0018) stays the ONLY store of provider credentials. This gives
-- each row a lifecycle the server can reason about, and moves every state
-- change into one transaction with its email_account mirror, so the mailbox's
-- state can never lag the token row (audit M-16).
--
--   state             VALID or DEAD, and nothing else. A grant Google has
--                     revoked is marked DEAD and KEPT for audit: it is never
--                     deleted on a failure and never used again. NEAR_EXPIRY
--                     and EXPIRED are not stored; they are computed at read
--                     time from access_expires_at and the clock, because a
--                     stored derived state is how it goes stale.
--   access_enc        the current access token, sealed in its own envelope
--                     (src/connections/google/tokenEnvelope.ts), so concurrent
--                     callers share one refresh instead of each making one.
--   access_expires_at the absolute instant Google gave, never now + 3600.
--   refresh_expires_at Google's Testing-mode seven-day death, when it said.
--   refresh_lock_until the single-flight lock's expiry: a dead worker cannot
--                     hold an account forever.
--
-- Every function below is service-role only. Nothing here returns a token.

alter table google_tokens add column if not exists state text not null default 'VALID' check (state in ('VALID', 'DEAD'));
alter table google_tokens add column if not exists access_enc text;
alter table google_tokens add column if not exists access_expires_at timestamptz;
alter table google_tokens add column if not exists refresh_expires_at timestamptz;
alter table google_tokens add column if not exists granted_scope text;
alter table google_tokens add column if not exists granted_at timestamptz not null default now();
alter table google_tokens add column if not exists last_refresh_ok_at timestamptz;
alter table google_tokens add column if not exists consecutive_failures integer not null default 0;
alter table google_tokens add column if not exists last_failure_at timestamptz;
alter table google_tokens add column if not exists dead_at timestamptz;
alter table google_tokens add column if not exists last_auth_error jsonb;
alter table google_tokens add column if not exists refresh_lock_until timestamptz;

-- A fresh sign-in, stored. The one door for the code exchange and for a refresh
-- Google answered with a new refresh token. Revives a DEAD row only when Google
-- actually sent a new refresh token: consent that returned none cannot bring a
-- dead grant back, and says so rather than pretending.
create or replace function google_signin_keep(p_user uuid, p_email text, p_refresh_enc text, p_access_enc text, p_access_exp timestamptz, p_refresh_exp timestamptz, p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(coalesce(p_email, ''));
  prev text;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_user is null or length(e) = 0 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  select state into prev from google_tokens where user_id = p_user and email = e for update;
  if p_refresh_enc is null then
    if prev is null then return jsonb_build_object('error', 'NO_STORED_SIGNIN'); end if;
    if prev = 'DEAD' then return jsonb_build_object('error', 'NO_REFRESH_TOKEN'); end if;
    update google_tokens
       set access_enc = p_access_enc, access_expires_at = p_access_exp, granted_scope = coalesce(p_scope, granted_scope),
           last_refresh_ok_at = now(), consecutive_failures = 0, last_failure_at = null, refresh_lock_until = null, updated_at = now()
     where user_id = p_user and email = e;
  else
    insert into google_tokens (user_id, email, token_enc, access_enc, access_expires_at, refresh_expires_at, granted_scope, state, granted_at, last_refresh_ok_at, updated_at)
    values (p_user, e, p_refresh_enc, p_access_enc, p_access_exp, p_refresh_exp, p_scope, 'VALID', now(), now(), now())
    on conflict (user_id, email) do update
      set token_enc = excluded.token_enc, access_enc = excluded.access_enc, access_expires_at = excluded.access_expires_at,
          refresh_expires_at = excluded.refresh_expires_at, granted_scope = excluded.granted_scope, state = 'VALID',
          granted_at = now(), last_refresh_ok_at = now(), consecutive_failures = 0, last_failure_at = null,
          dead_at = null, last_auth_error = null, refresh_lock_until = null, updated_at = now();
  end if;
  -- The mailbox mirrors the sign-in in the same transaction: connected, with its credential reference.
  perform email_account_upsert(p_user, e, '{}', jsonb_build_object('archive', true, 'trash', true, 'read', true));
  return jsonb_build_object('stored', true, 'revived', prev = 'DEAD');
end;
$$;

-- A refresh that worked. Discarded (NOT_VALID) when the row went DEAD or was
-- forgotten while the refresh was in flight: a result must never resurrect a
-- grant that was revoked underneath it. A refresh token Google rotated, or one
-- being rewritten into the current envelope, arrives in p_refresh_enc; absent,
-- the stored one is left exactly as it is.
create or replace function google_refresh_record(p_user uuid, p_email text, p_access_enc text, p_access_exp timestamptz, p_refresh_enc text, p_refresh_exp timestamptz, p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e text := lower(coalesce(p_email, ''));
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update google_tokens
     set access_enc = p_access_enc, access_expires_at = p_access_exp, token_enc = coalesce(p_refresh_enc, token_enc),
         refresh_expires_at = coalesce(p_refresh_exp, refresh_expires_at), granted_scope = coalesce(p_scope, granted_scope),
         last_refresh_ok_at = now(), consecutive_failures = 0, last_failure_at = null, refresh_lock_until = null, updated_at = now()
   where user_id = p_user and email = e and state = 'VALID';
  if not found then return jsonb_build_object('error', 'NOT_VALID'); end if;
  update email_account set state = 'connected', sync_error = null
   where owner_id = p_user and address = e and state = 'reauth';
  return jsonb_build_object('recorded', true);
end;
$$;

-- A refresh that failed for a reason that says nothing about the grant (a
-- timeout, a throttle, Google down). Counted, so slow-burn failure can be
-- escalated; never a state change.
create or replace function google_refresh_failed(p_user uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update google_tokens set consecutive_failures = consecutive_failures + 1, last_failure_at = now(), refresh_lock_until = null
   where user_id = p_user and email = lower(coalesce(p_email, '')) and state = 'VALID'
  returning consecutive_failures into n;
  return jsonb_build_object('failures', coalesce(n, 0));
end;
$$;

-- THE ONE REVOCATION PATH. Both callers (the sign-in function and the mail
-- routes) end here: the row is marked DEAD and kept, the cached access token is
-- dropped, the mailbox moves to reauth, and the failure is recorded as
-- PROVIDER_AUTH with redacted metadata, all in one transaction. `first` says
-- whether this call is the one that found it, so the loud announcement fires
-- once per incident and never reopens a resolved one.
create or replace function google_grant_revoked(p_user uuid, p_email text, p_source text, p_code text, p_http integer, p_cause text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(coalesce(p_email, ''));
  prev text;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select state into prev from google_tokens where user_id = p_user and email = e for update;
  if prev = 'VALID' then
    update google_tokens
       set state = 'DEAD', dead_at = now(), access_enc = null, access_expires_at = null, refresh_lock_until = null, updated_at = now(),
           last_auth_error = jsonb_build_object('oauthRefreshFailedAt', now(), 'lastAuthErrorSource', left(coalesce(p_source, ''), 40),
                                                'lastAuthErrorCode', left(coalesce(p_code, ''), 60), 'lastAuthErrorHttpStatus', p_http,
                                                'likelyCause', left(coalesce(p_cause, ''), 60))
     where user_id = p_user and email = e;
  elsif prev = 'DEAD' then
    update google_tokens set access_enc = null, access_expires_at = null, refresh_lock_until = null where user_id = p_user and email = e;
  end if;
  update email_account set state = 'reauth', sync_error = 'Reconnect Gmail to continue.'
   where owner_id = p_user and address = e and state <> 'disconnected';
  return jsonb_build_object('row', prev is not null, 'first', prev = 'VALID');
end;
$$;

-- DISCONNECT. The token row, the credential reference, and the mailbox's live
-- state go together; the mailbox row itself stays (disconnected) with its cache
-- and every approved record, because the person removed the sign-in, not the
-- history. Nothing can act for the account afterwards: there is no credential
-- left to act with.
create or replace function google_signin_forget(p_user uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e text := lower(coalesce(p_email, ''));
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  delete from jarvis_private.email_credential where owner_id = p_user and credential_ref = 'google_tokens:' || e;
  delete from google_tokens where user_id = p_user and email = e;
  update email_account set state = 'disconnected', disconnected_at = now(), sync_error = null
   where owner_id = p_user and address = e and state <> 'disconnected';
  return jsonb_build_object('forgotten', true);
end;
$$;

-- THE SINGLE-FLIGHT LOCK. One UPDATE decides who refreshes: the caller whose
-- update matches a row holds the lock until p_ttl seconds from now, and every
-- other caller finds the lock held and waits for the holder's result. Decision
-- and action are one statement, so two workers cannot both win. The TTL means
-- a worker that dies mid-refresh blocks an account for seconds, not forever.
create or replace function google_refresh_lock(p_user uuid, p_email text, p_ttl integer default 15)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update google_tokens set refresh_lock_until = now() + make_interval(secs => greatest(1, least(coalesce(p_ttl, 15), 60)))
   where user_id = p_user and email = lower(coalesce(p_email, '')) and state = 'VALID'
     and (refresh_lock_until is null or refresh_lock_until <= now());
  return found;
end;
$$;

revoke all on function google_signin_keep(uuid, text, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function google_refresh_record(uuid, text, text, timestamptz, text, timestamptz, text) from public, anon, authenticated;
revoke all on function google_refresh_failed(uuid, text) from public, anon, authenticated;
revoke all on function google_grant_revoked(uuid, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function google_signin_forget(uuid, text) from public, anon, authenticated;
revoke all on function google_refresh_lock(uuid, text, integer) from public, anon, authenticated;
grant execute on function google_signin_keep(uuid, text, text, text, timestamptz, timestamptz, text) to service_role;
grant execute on function google_refresh_record(uuid, text, text, timestamptz, text, timestamptz, text) to service_role;
grant execute on function google_refresh_failed(uuid, text) to service_role;
grant execute on function google_grant_revoked(uuid, text, text, text, integer, text) to service_role;
grant execute on function google_signin_forget(uuid, text) to service_role;
grant execute on function google_refresh_lock(uuid, text, integer) to service_role;
