-- Migration 0055: Email connection truth (Email v1 spec 2026-10-08, section 8,
-- phase P1). Dave approved the build on 2026-10-08.
--
-- Why. email_account.state is one three-value word (connected, reauth,
-- disconnected). The spec separates four things that must never be conflated:
-- whether durable provider access works (authorization), whether the cache has
-- caught up with a declared window (sync), whether sending is possible (send
-- health), and whether the phone is online (client only). "Connected" must not
-- read as "Current", a quota error must not read as "reauthenticate", and a
-- revoked grant must keep the cached mail and drafts, not hide the account.
--
-- What this adds, all additive, all server-written:
--   * auth_state, sync_state, send_health, verified_through_at, coverage_start,
--     heartbeat_at, paused_at, removed_at on email_account.
--   * email_account_fail(): record one failure by KIND (reauth, permission,
--     storage, transient, quota). Only reauth/permission/storage touch
--     authorization; transient and quota only touch sync. Quota never reauths.
--   * email_account_mark(): by address, for the sign-in routes (revoked at
--     Google, forgotten by the person). A revoked grant becomes
--     reauth_required, cache kept; a forgotten one becomes removed.
--   * email_account_upsert() no longer lifts a broken account back to
--     "connected" on every call. Only a proof (a real authorized read)
--     does, through email_account_proved().
--   * email_sync_apply() records catching_up / current honestly.
--   * email_accounts() reports the new fields.
--
-- The legacy `state` column stays (the inbox reads it; the old client reads
-- it) and is kept in step. Rollback: supabase/rollback/0055_email_connection_truth_down.sql
-- puts the 0048 function bodies back and keeps the additive columns (no data
-- is dropped by a rollback).

alter table email_account add column if not exists auth_state text not null default 'ready'
  check (auth_state in ('unconnected', 'checking', 'ready', 'temporary', 'reauth_required', 'permission_missing', 'storage_error', 'paused_by_user', 'removed'));
alter table email_account add column if not exists sync_state text not null default 'not_started'
  check (sync_state in ('not_started', 'syncing', 'current', 'catching_up', 'stale', 'failed', 'paused'));
alter table email_account add column if not exists send_health text not null default 'unverified'
  check (send_health in ('unverified', 'available', 'blocked', 'unavailable'));
alter table email_account add column if not exists verified_through_at timestamptz;
alter table email_account add column if not exists coverage_start timestamptz;
alter table email_account add column if not exists heartbeat_at timestamptz;
alter table email_account add column if not exists paused_at timestamptz;
alter table email_account add column if not exists removed_at timestamptz;

-- Existing rows: authorization follows the legacy word; sync is honestly
-- catching_up (the cache holds the newest page, not a declared 90-day window).
update email_account set
  auth_state = case state when 'reauth' then 'reauth_required' when 'disconnected' then 'removed' else 'ready' end,
  removed_at = case when state = 'disconnected' then coalesce(disconnected_at, now()) else null end,
  sync_state = case when last_sync_at is null then 'not_started' else 'catching_up' end
 where auth_state = 'ready' and sync_state = 'not_started';

-- Map an authorization value back to the legacy word the inbox still reads.
create or replace function jarvis_legacy_account_state(p_auth text)
returns text
language sql
immutable
as $$
  select case p_auth
    when 'ready' then 'connected'
    when 'temporary' then 'connected'
    when 'checking' then 'connected'
    when 'paused_by_user' then 'connected'
    when 'removed' then 'disconnected'
    when 'unconnected' then 'disconnected'
    else 'reauth'
  end;
$$;

-- A first connect makes the row. A repeat call must NOT clear a failure: a
-- broken account stays broken until a real authorized read proves otherwise.
create or replace function email_account_upsert(p_owner uuid, p_address text, p_scopes text[] default '{}', p_capabilities jsonb default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  aid uuid;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_owner is null or coalesce(length(p_address), 0) = 0 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  insert into email_account (owner_id, provider, provider_subject, address, scopes, state, auth_state, capabilities, connected_at, disconnected_at, removed_at, sync_error)
  values (p_owner, 'gmail', lower(p_address), lower(p_address), coalesce(p_scopes, '{}'), 'connected', 'ready', coalesce(p_capabilities, '{}'::jsonb), now(), null, null, null)
  on conflict (owner_id, provider, provider_subject) do update
    set capabilities = excluded.capabilities,
        scopes = case when cardinality(excluded.scopes) > 0 then excluded.scopes else email_account.scopes end,
        -- A forgotten account that comes back is a fresh authorization to prove.
        state = case when email_account.auth_state = 'removed' then 'connected' else email_account.state end,
        auth_state = case when email_account.auth_state = 'removed' then 'checking' else email_account.auth_state end,
        disconnected_at = case when email_account.auth_state = 'removed' then null else email_account.disconnected_at end,
        removed_at = case when email_account.auth_state = 'removed' then null else email_account.removed_at end,
        connected_at = case when email_account.auth_state = 'removed' then now() else email_account.connected_at end
  returning id into aid;
  insert into jarvis_private.email_credential (account_id, owner_id, credential_ref)
  values (aid, p_owner, 'google_tokens:' || lower(p_address))
  on conflict (account_id) do update set credential_ref = excluded.credential_ref;
  return jsonb_build_object('account_id', aid);
end;
$$;

-- A real authorized read succeeded (a profile fetch with a freshly refreshed
-- token): that, and only that, proves the connection. Clears an auth failure
-- unless the person paused or removed the account.
create or replace function email_account_proved(p_owner uuid, p_account uuid, p_scopes text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a email_account%rowtype;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into a from email_account where id = p_account and owner_id = p_owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if a.auth_state in ('paused_by_user', 'removed') then return jsonb_build_object('account_id', p_account, 'auth_state', a.auth_state); end if;
  update email_account set
    auth_state = 'ready', state = 'connected', sync_error = null,
    disconnected_at = null, removed_at = null,
    scopes = case when p_scopes is not null and cardinality(p_scopes) > 0 then p_scopes else scopes end,
    heartbeat_at = now()
   where id = p_account;
  return jsonb_build_object('account_id', p_account, 'auth_state', 'ready');
end;
$$;

-- One failure, by kind. Only the kinds that mean "the grant is the problem"
-- touch authorization; a quota or a network blip only makes sync stale.
create or replace function email_account_fail(p_owner uuid, p_account uuid, p_kind text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a email_account%rowtype;
  new_auth text;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_kind not in ('reauth', 'permission', 'storage', 'transient', 'quota') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  select * into a from email_account where id = p_account and owner_id = p_owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if a.auth_state in ('paused_by_user', 'removed') then return jsonb_build_object('account_id', p_account, 'auth_state', a.auth_state); end if;
  new_auth := case p_kind
    when 'reauth' then 'reauth_required'
    when 'permission' then 'permission_missing'
    when 'storage' then 'storage_error'
    else a.auth_state
  end;
  update email_account set
    auth_state = new_auth,
    state = jarvis_legacy_account_state(new_auth),
    sync_state = case when sync_state in ('paused') then sync_state when p_kind in ('transient', 'quota') then 'stale' else 'failed' end,
    sync_error = left(coalesce(p_error, 'Sync failed'), 200)
   where id = p_account;
  return jsonb_build_object('account_id', p_account, 'auth_state', new_auth);
end;
$$;

-- The older state door (the send worker and the sign-in mirror still call it) keeps both words in step: a legacy
-- 'reauth' is reauth_required, a legacy 'disconnected' is removed, and a legacy 'connected' never lifts a failure
-- by itself (only email_account_proved / a complete sync do).
create or replace function email_account_state(p_owner uuid, p_account uuid, p_state text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_state not in ('connected', 'reauth', 'disconnected') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  update email_account set
    state = case when p_state = 'connected' and auth_state in ('reauth_required', 'permission_missing', 'storage_error', 'removed') then state else p_state end,
    auth_state = case p_state
      when 'reauth' then case when auth_state in ('paused_by_user', 'removed') then auth_state else 'reauth_required' end
      when 'disconnected' then 'removed'
      else auth_state end,
    sync_error = left(p_error, 200),
    disconnected_at = case when p_state = 'disconnected' then now() else null end,
    removed_at = case when p_state = 'disconnected' then now() else removed_at end
   where id = p_account and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jsonb_build_object('account_id', p_account, 'state', p_state);
end;
$$;

-- By address, for the sign-in routes (they know the address, not the row).
-- 'reauth_required' = the grant was revoked at Google (cache and drafts kept);
-- 'removed' = the person forgot the account.
create or replace function email_account_mark(p_owner uuid, p_address text, p_auth text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_auth not in ('reauth_required', 'removed') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  update email_account set
    auth_state = p_auth,
    state = jarvis_legacy_account_state(p_auth),
    disconnected_at = case when p_auth = 'removed' then now() else disconnected_at end,
    removed_at = case when p_auth = 'removed' then now() else removed_at end,
    sync_error = case when p_auth = 'reauth_required' then left(coalesce(p_error, 'Reconnect Gmail to continue.'), 200) else null end
   where owner_id = p_owner and address = lower(p_address) and auth_state not in ('paused_by_user');
  return jsonb_build_object('marked', found);
end;
$$;

-- A sync's result. Freshness (last_sync_at, cursor, verified_through_at)
-- advances only on a complete step; an incomplete one leaves the account
-- catching_up. p_complete says the declared window is reconciled through now.
-- (email_sync_apply, the older six-argument door, stays and calls this with
-- p_complete false: a different name, not a new overload, so a named-argument
-- call never meets two candidates.)
create or replace function email_sync_commit(p_owner uuid, p_account uuid, p_messages jsonb, p_removed text[] default '{}', p_cursor text default null, p_advance boolean default true, p_complete boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb;
  n integer := 0;
  gone integer := 0;
  acct email_account%rowtype;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into acct from email_account where id = p_account and owner_id = p_owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if jsonb_typeof(coalesce(p_messages, '[]'::jsonb)) <> 'array' then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  for m in select * from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) loop
    if coalesce(m ->> 'provider_id', '') = '' then continue; end if;
    insert into email_message (owner_id, account_id, provider_id, thread_id, internal_date, from_address, from_name, to_addresses, cc_addresses, subject, snippet,
                               has_body, attachment_metadata, provider_labels, provider_revision, source_hash, deleted_at)
    values (p_owner, p_account, m ->> 'provider_id', coalesce(m ->> 'thread_id', m ->> 'provider_id'),
            coalesce((m ->> 'internal_date')::timestamptz, now()),
            left(coalesce(m ->> 'from_address', ''), 320), left(coalesce(m ->> 'from_name', ''), 200),
            case when jsonb_typeof(m -> 'to_addresses') = 'array' then m -> 'to_addresses' else '[]'::jsonb end,
            case when jsonb_typeof(m -> 'cc_addresses') = 'array' then m -> 'cc_addresses' else '[]'::jsonb end,
            left(coalesce(m ->> 'subject', ''), 998), left(coalesce(m ->> 'snippet', ''), 400),
            false,
            case when jsonb_typeof(m -> 'attachments') = 'array' then m -> 'attachments' else '[]'::jsonb end,
            case when jsonb_typeof(m -> 'labels') = 'array' then array(select jsonb_array_elements_text(m -> 'labels')) else '{}'::text[] end,
            m ->> 'history_id',
            encode(sha256(convert_to(coalesce(m ->> 'provider_id', '') || '|' || coalesce(m ->> 'subject', '') || '|' || coalesce(m ->> 'snippet', '') || '|' || coalesce(m ->> 'internal_date', ''), 'UTF8')), 'hex'),
            null)
    on conflict (account_id, provider_id) do update
      set thread_id = excluded.thread_id, internal_date = excluded.internal_date, from_address = excluded.from_address, from_name = excluded.from_name,
          to_addresses = excluded.to_addresses, cc_addresses = excluded.cc_addresses, subject = excluded.subject, snippet = excluded.snippet,
          attachment_metadata = excluded.attachment_metadata, provider_labels = excluded.provider_labels, provider_revision = excluded.provider_revision,
          source_hash = excluded.source_hash, deleted_at = null;
    n := n + 1;
  end loop;
  if cardinality(coalesce(p_removed, '{}')) > 0 then
    update email_message set deleted_at = now() where owner_id = p_owner and account_id = p_account and provider_id = any (p_removed) and deleted_at is null;
    get diagnostics gone = row_count;
  end if;
  if p_advance then
    update email_account set
      last_sync_at = now(),
      cursor = coalesce(p_cursor, cursor),
      sync_error = null,
      heartbeat_at = now(),
      -- A sync that read the mailbox proves authorization (unless paused or removed).
      auth_state = case when auth_state in ('paused_by_user', 'removed') then auth_state else 'ready' end,
      state = case when auth_state in ('paused_by_user', 'removed') then state else 'connected' end,
      -- Current only when the declared window is reconciled; otherwise Catching up.
      sync_state = case when sync_state = 'paused' then sync_state when p_complete then 'current' else 'catching_up' end,
      verified_through_at = case when p_complete then now() else verified_through_at end
     where id = p_account;
  end if;
  return jsonb_build_object('account_id', p_account, 'upserted', n, 'removed', gone, 'last_sync_at', (select last_sync_at from email_account where id = p_account));
end;
$$;

create or replace function email_sync_apply(p_owner uuid, p_account uuid, p_messages jsonb, p_removed text[] default '{}', p_cursor text default null, p_advance boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  return email_sync_commit(p_owner, p_account, p_messages, p_removed, p_cursor, p_advance, false);
end;
$$;

-- Failures from the old door keep working, by kind: a reauth is a reauth, any
-- other failure only makes sync stale (it can never open a reconnect prompt).
create or replace function email_sync_failed(p_owner uuid, p_account uuid, p_error text, p_reauth boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  return email_account_fail(p_owner, p_account, case when p_reauth then 'reauth' else 'transient' end, p_error);
end;
$$;

create or replace function email_accounts()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'address', a.address, 'state', a.state, 'last_sync_at', a.last_sync_at, 'sync_error', a.sync_error,
    'capabilities', a.capabilities, 'connected_at', a.connected_at, 'scopes', a.scopes,
    'auth_state', a.auth_state, 'sync_state', a.sync_state, 'send_health', a.send_health,
    'verified_through_at', a.verified_through_at, 'coverage_start', a.coverage_start, 'heartbeat_at', a.heartbeat_at,
    'cached', (select count(*) from email_message m where m.account_id = a.id and m.deleted_at is null)) order by a.connected_at), '[]'::jsonb)
  from email_account a where a.owner_id = auth.uid();
$$;

revoke all on function jarvis_legacy_account_state(text) from public, anon, authenticated;
revoke all on function email_account_upsert(uuid, text, text[], jsonb) from public, anon, authenticated;
revoke all on function email_account_state(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function email_account_proved(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function email_account_fail(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function email_account_mark(uuid, text, text, text) from public, anon, authenticated;
revoke all on function email_sync_commit(uuid, uuid, jsonb, text[], text, boolean, boolean) from public, anon, authenticated;
revoke all on function email_sync_apply(uuid, uuid, jsonb, text[], text, boolean) from public, anon, authenticated;
revoke all on function email_sync_failed(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function email_accounts() from public, anon;
grant execute on function email_account_upsert(uuid, text, text[], jsonb) to service_role;
grant execute on function email_account_state(uuid, uuid, text, text) to service_role;
grant execute on function email_account_proved(uuid, uuid, text[]) to service_role;
grant execute on function email_account_fail(uuid, uuid, text, text) to service_role;
grant execute on function email_account_mark(uuid, text, text, text) to service_role;
grant execute on function email_sync_commit(uuid, uuid, jsonb, text[], text, boolean, boolean) to service_role;
grant execute on function email_sync_apply(uuid, uuid, jsonb, text[], text, boolean) to service_role;
grant execute on function email_sync_failed(uuid, uuid, text, boolean) to service_role;
grant execute on function email_accounts() to authenticated;
