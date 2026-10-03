-- Migration 0048: the Email cache's writers and readers, slice 05 of the
-- unified substrate (2026-10-03). IMPLEMENTATION-SPEC.md sections 08 (E01 to
-- E06, E20 to E23, E28), 11 (operations and synchronization), 09 (M1, M2,
-- M8, M9).
--
-- The provider cache (0044's email_account, email_message, email_message_body)
-- is written by the server only: api/email/*.ts holds the Gmail token, calls
-- Gmail, and writes here through these functions with the service role. The
-- browser reads through the person's session: a keyset page of the inbox
-- across accounts, newest first by the provider's receipt time with a stable
-- id tiebreak, one message with its body, a literal search over the cache,
-- the accounts with their freshness. Nothing here ranks, collapses, extracts
-- or infers; a card is slice 06's and only from a person's tap or a rule.
--
-- Additive. Rollback: supabase/rollback/0048_email_cache_and_provider_down.sql.

-- The sender's HTML as it arrived, rendered only through the app's sandboxed
-- sanitizer (messages/mailHtml.ts). sanitized_html stays for a server-side
-- sanitizer when there is one; an edge function has no DOM to sanitize with.
alter table email_message_body add column if not exists html text;
-- Where the message sits, as Gmail labels it; a row leaves the inbox page
-- when INBOX leaves its labels (archive, trash) and comes back when it returns.
create index if not exists email_message_owner_inbox_idx on email_message (owner_id, internal_date desc, provider_id desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 1. Server writers (service role).
-- ---------------------------------------------------------------------------

-- An account row for a connected mailbox, keyed by the provider subject (the
-- address, for Gmail), with its private credential reference pointing at the
-- stored sign-in. Idempotent: a second connect moves the state back.
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

-- The account's state when the provider says so: reauth (the grant is gone
-- or lacks a scope), disconnected (the person forgot it), connected again.
-- A disconnected account keeps its cache and every approved record; only
-- the token goes.
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

-- One sync's result: the rows (new or changed), the ids that left, the new
-- cursor, and the freshness. Rows are keyed by the provider's id; a changed
-- row (labels, snippet) moves its source_hash so a stale card can notice.
-- Freshness advances only here, on success.
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

-- A sync that failed: the error is recorded, the cache and the freshness are
-- left exactly as they were (the last good read stays readable).
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

-- A message's body, read on open: the plain text, the HTML as sent, the
-- attachments' metadata (never their bytes).
create or replace function email_body_store(p_owner uuid, p_message uuid, p_text text, p_html text default null, p_attachments jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if not exists (select 1 from email_message where id = p_message and owner_id = p_owner) then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  insert into email_message_body (message_id, owner_id, sanitized_text, html, sanitizer_version)
  values (p_message, p_owner, left(coalesce(p_text, ''), 200000), left(p_html, 1000000), 0)
  on conflict (message_id) do update set sanitized_text = excluded.sanitized_text, html = excluded.html, sanitizer_version = 0;
  update email_message set has_body = true, attachment_metadata = coalesce(p_attachments, attachment_metadata) where id = p_message;
  return jsonb_build_object('message_id', p_message, 'stored', true);
end;
$$;

-- The provider's answer to a label change (read, unread, archive, trash,
-- untrash): the cache follows the provider, never the other way round.
create or replace function email_labels_set(p_owner uuid, p_message uuid, p_labels text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update email_message set provider_labels = coalesce(p_labels, '{}') where id = p_message and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jsonb_build_object('message_id', p_message, 'labels', to_jsonb(coalesce(p_labels, '{}'::text[])));
end;
$$;

-- The receipt for a provider command the person tapped and Gmail confirmed
-- (archive, unarchive, trash, untrash: E29). Written by the server after the
-- provider's answer, never before, with the one idempotency key the route
-- derived from the command, so a repeated tap or a retried request lands on
-- the same action and the same receipt. Receipts are append-only, so the
-- provider's answer is written with the receipt, not onto it. Read and unread
-- are a mirrored state, not an action, and never come here.
create or replace function email_action_record(p_owner uuid, p_message uuid, p_kind text, p_verb text, p_idempotency text, p_provider_ack jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m email_message%rowtype;
  acct email_account%rowtype;
  existing uuid;
  a uuid;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_kind not in ('archive_mail', 'unarchive_mail', 'trash_mail', 'untrash_mail') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if coalesce(length(trim(p_verb)), 0) = 0 or coalesce(length(p_idempotency), 0) = 0 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  select * into m from email_message where id = p_message and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select * into acct from email_account where id = m.account_id;
  select id into existing from action where owner_id = p_owner and idempotency_key = p_idempotency;
  if existing is not null then return jsonb_build_object('action_id', existing, 'replay', true); end if;
  insert into action (owner_id, kind, actor_kind, actor_id, initiated_by_user_id, verb, surface, state, payload_hash, idempotency_key, provider_account_id, authorization_snapshot)
  values (p_owner, p_kind, 'user', null, p_owner, left(trim(p_verb), 200), 'email', 'confirmed', m.source_hash, p_idempotency, m.account_id,
          jsonb_build_object('actor_kind', 'user', 'at', now(), 'provider_id', m.provider_id))
  returning id into a;
  insert into receipt_event (owner_id, action_id, sequence, state, exact_verb, actor_kind, actor_id, actor_display, initiated_by_user_id, scope_summary, provider_ack, assurance)
  values (p_owner, a, 1, 'confirmed', left(trim(p_verb), 200), 'user', null, 'You', p_owner, acct.address, p_provider_ack, 'provider_ack');
  return jsonb_build_object('action_id', a, 'replay', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The person's reads (the session; the row policies decide).
-- ---------------------------------------------------------------------------

-- The accounts with their freshness and state, and what each can do.
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

-- One keyset page of the inbox across the chosen accounts (every account
-- when none is named): newest first by the provider's receipt time, then by
-- id, so equal timestamps never reorder between pages. Only rows still
-- labelled INBOX, in every account that is not disconnected.
create or replace function email_inbox(p_accounts uuid[] default null, p_before timestamptz default null, p_before_id text default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  rows jsonb;
  total integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into rows from (
    select m.id, m.account_id, a.address as account, m.provider_id, m.thread_id, m.internal_date, m.from_address, m.from_name, m.subject, m.snippet,
           m.has_body, m.attachment_metadata, m.provider_labels, m.source_hash,
           not ('UNREAD' = any (m.provider_labels)) as read
      from email_message m
      join email_account a on a.id = m.account_id
     where m.owner_id = owner and m.deleted_at is null and a.state <> 'disconnected'
       and 'INBOX' = any (m.provider_labels)
       and (p_accounts is null or m.account_id = any (p_accounts))
       and (p_before is null or m.internal_date < p_before or (m.internal_date = p_before and p_before_id is not null and m.provider_id < p_before_id))
     order by m.internal_date desc, m.provider_id desc
     limit lim) x;
  select count(*) into total from email_message m join email_account a on a.id = m.account_id
   where m.owner_id = owner and m.deleted_at is null and a.state <> 'disconnected' and 'INBOX' = any (m.provider_labels) and (p_accounts is null or m.account_id = any (p_accounts));
  return jsonb_build_object('rows', rows, 'cached_total', total, 'page', lim);
end;
$$;

-- One message with its body (when it has been read in) and its attachments'
-- metadata. The body is the sender's words, inert: the app sanitizes before
-- it draws them, in a frame that runs nothing.
create or replace function email_message_read(p_message uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  m email_message%rowtype;
  b email_message_body%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into m from email_message where id = p_message and owner_id = owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select * into b from email_message_body where message_id = m.id and owner_id = owner;
  return jsonb_build_object(
    'id', m.id, 'account_id', m.account_id, 'account', (select address from email_account where id = m.account_id), 'provider_id', m.provider_id, 'thread_id', m.thread_id,
    'internal_date', m.internal_date, 'from_address', m.from_address, 'from_name', m.from_name, 'to_addresses', m.to_addresses, 'cc_addresses', m.cc_addresses,
    'subject', m.subject, 'snippet', m.snippet, 'provider_labels', m.provider_labels, 'read', not ('UNREAD' = any (m.provider_labels)),
    'deleted', m.deleted_at is not null, 'source_hash', m.source_hash, 'attachments', m.attachment_metadata,
    'has_body', b.message_id is not null, 'text', b.sanitized_text, 'html', b.html);
end;
$$;

-- A literal search over the cache: sender, subject, snippet and body text,
-- chronological, across the chosen accounts. What it covers is what it says:
-- the cached window, never the mailbox; the provider's own search is the
-- server's, and the screen labels each.
create or replace function email_search_cached(p_q text, p_accounts uuid[] default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  q text := trim(coalesce(p_q, ''));
  pat text;
  rows jsonb;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if length(q) = 0 then return jsonb_build_object('rows', '[]'::jsonb, 'coverage', 'cached', 'q', q); end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into rows from (
    select m.id, m.account_id, a.address as account, m.provider_id, m.thread_id, m.internal_date, m.from_address, m.from_name, m.subject, m.snippet,
           m.has_body, m.attachment_metadata, m.provider_labels, m.source_hash, not ('UNREAD' = any (m.provider_labels)) as read
      from email_message m
      join email_account a on a.id = m.account_id
      left join email_message_body b on b.message_id = m.id
     where m.owner_id = owner and m.deleted_at is null and a.state <> 'disconnected'
       and (p_accounts is null or m.account_id = any (p_accounts))
       and (m.from_address ilike pat or m.from_name ilike pat or m.subject ilike pat or m.snippet ilike pat or coalesce(b.sanitized_text, '') ilike pat)
     order by m.internal_date desc, m.provider_id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  return jsonb_build_object('rows', rows, 'coverage', 'cached', 'q', q,
    'window', (select count(*) from email_message m where m.owner_id = owner and m.deleted_at is null and (p_accounts is null or m.account_id = any (p_accounts))));
end;
$$;

-- The one question a category preference earns (00.1, "Standing grants
-- learned from taps"; policy/categoryTaps.ts counts the taps on the device):
-- offered as a row the person owns, answered with Remember (accepted) or Not
-- Now (dismissed). A rule only tags locally; nothing here hides, archives or
-- touches the provider, and an accepted row is a record of consent, not a
-- grant of anything wider.
create or replace function policy_suggestion_offer(p_rule jsonb, p_evidence_tap_ids text[] default '{}')
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  sid uuid;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if not jarvis_policy_rule_ok(p_rule) then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if coalesce(length(trim(p_rule ->> 'sender_exact')), 0) = 0 or coalesce(length(p_rule ->> 'account_id'), 0) = 0 or coalesce(length(p_rule ->> 'category_id'), 0) = 0 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  -- One open question per exact rule.
  select id into sid from policy_suggestion where owner_id = owner and status = 'suggested' and rule = p_rule;
  if sid is not null then return jsonb_build_object('suggestion_id', sid, 'status', 'suggested', 'replay', true); end if;
  insert into policy_suggestion (owner_id, surface, action, rule, evidence_tap_ids, expires_at)
  values (owner, 'email', 'local.category.apply', p_rule, coalesce(p_evidence_tap_ids, '{}'), now() + interval '30 days')
  returning id into sid;
  return jsonb_build_object('suggestion_id', sid, 'status', 'suggested', 'replay', false);
end;
$$;

create or replace function policy_suggestion_answer(p_suggestion uuid, p_answer text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  st text;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_answer not in ('accepted', 'dismissed') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  select status into st from policy_suggestion where id = p_suggestion and owner_id = owner;
  if st is null then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if st <> 'suggested' then return jsonb_build_object('suggestion_id', p_suggestion, 'status', st, 'replay', true); end if;
  update policy_suggestion set status = p_answer, decided_at = now() where id = p_suggestion and owner_id = owner;
  return jsonb_build_object('suggestion_id', p_suggestion, 'status', p_answer, 'replay', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants.
-- ---------------------------------------------------------------------------
revoke all on function email_account_upsert(uuid, text, text[], jsonb) from public, anon, authenticated;
revoke all on function email_account_state(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function email_sync_apply(uuid, uuid, jsonb, text[], text, boolean) from public, anon, authenticated;
revoke all on function email_sync_failed(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function email_body_store(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function email_labels_set(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function email_action_record(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function email_account_upsert(uuid, text, text[], jsonb) to service_role;
grant execute on function email_account_state(uuid, uuid, text, text) to service_role;
grant execute on function email_sync_apply(uuid, uuid, jsonb, text[], text, boolean) to service_role;
grant execute on function email_sync_failed(uuid, uuid, text, boolean) to service_role;
grant execute on function email_body_store(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function email_labels_set(uuid, uuid, text[]) to service_role;
grant execute on function email_action_record(uuid, uuid, text, text, text, jsonb) to service_role;

revoke all on function email_accounts() from public, anon;
revoke all on function email_inbox(uuid[], timestamptz, text, integer) from public, anon;
revoke all on function email_message_read(uuid) from public, anon;
revoke all on function email_search_cached(text, uuid[], integer) from public, anon;
grant execute on function email_accounts() to authenticated;
grant execute on function email_inbox(uuid[], timestamptz, text, integer) to authenticated;
grant execute on function email_message_read(uuid) to authenticated;
grant execute on function email_search_cached(text, uuid[], integer) to authenticated;

revoke all on function policy_suggestion_offer(jsonb, text[]) from public, anon;
revoke all on function policy_suggestion_answer(uuid, text) from public, anon;
grant execute on function policy_suggestion_offer(jsonb, text[]) to authenticated;
grant execute on function policy_suggestion_answer(uuid, text) to authenticated;
