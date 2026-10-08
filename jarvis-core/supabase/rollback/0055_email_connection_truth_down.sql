-- Rollback of 0055: the six old function bodies come back (0048's), the five
-- new functions go. The additive columns on email_account STAY: a rollback
-- must not drop data, and the old bodies simply ignore them. The legacy
-- `state` column was kept in step, so the old readers see a true word.

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
  insert into email_account (owner_id, provider, provider_subject, address, scopes, state, capabilities, connected_at, disconnected_at, sync_error)
  values (p_owner, 'gmail', lower(p_address), lower(p_address), coalesce(p_scopes, '{}'), 'connected', coalesce(p_capabilities, '{}'::jsonb), now(), null, null)
  on conflict (owner_id, provider, provider_subject) do update
    set state = 'connected', scopes = excluded.scopes, capabilities = excluded.capabilities, disconnected_at = null, sync_error = null,
        connected_at = case when email_account.state = 'connected' then email_account.connected_at else now() end
  returning id into aid;
  insert into jarvis_private.email_credential (account_id, owner_id, credential_ref)
  values (aid, p_owner, 'google_tokens:' || lower(p_address))
  on conflict (account_id) do update set credential_ref = excluded.credential_ref;
  return jsonb_build_object('account_id', aid);
end;
$$;

create or replace function email_sync_apply(p_owner uuid, p_account uuid, p_messages jsonb, p_removed text[] default '{}', p_cursor text default null, p_advance boolean default true)
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
    update email_account set last_sync_at = now(), cursor = coalesce(p_cursor, cursor), sync_error = null, state = case when state = 'reauth' then 'connected' else state end where id = p_account;
  end if;
  return jsonb_build_object('account_id', p_account, 'upserted', n, 'removed', gone, 'last_sync_at', (select last_sync_at from email_account where id = p_account));
end;
$$;

create or replace function email_sync_failed(p_owner uuid, p_account uuid, p_error text, p_reauth boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update email_account set sync_error = left(coalesce(p_error, 'Sync failed'), 200), state = case when p_reauth then 'reauth' else state end where id = p_account and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jsonb_build_object('account_id', p_account, 'recorded', true);
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
    'cached', (select count(*) from email_message m where m.account_id = a.id and m.deleted_at is null)) order by a.connected_at), '[]'::jsonb)
  from email_account a where a.owner_id = auth.uid();
$$;

create or replace function email_account_state(p_owner uuid, p_account uuid, p_state text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_state not in ('connected', 'reauth', 'disconnected') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  update email_account set state = p_state, sync_error = left(p_error, 200), disconnected_at = case when p_state = 'disconnected' then now() else null end
   where id = p_account and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jsonb_build_object('account_id', p_account, 'state', p_state);
end;
$$;

drop function if exists email_sync_commit(uuid, uuid, jsonb, text[], text, boolean, boolean);
drop function if exists email_account_proved(uuid, uuid, text[]);
drop function if exists email_account_fail(uuid, uuid, text, text);
drop function if exists email_account_mark(uuid, text, text, text);
drop function if exists jarvis_legacy_account_state(text);
