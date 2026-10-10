-- Migration 0061: the saved signature (Email v1 spec 2026-10-08, section 6;
-- Dave's locked decision L3). Additive; rollback in rollback/0061_email_signature_down.sql.
--
-- One saved plain-text signature per provider account. Empty is valid.
-- Settings reads and writes it through email_signature_set, the only door:
-- the table carries no direct grant beyond the existing email_account select
-- policy, so a change always goes through the ownership and conflict checks
-- below. signature_revision on email_account is the signature's own version,
-- bumped on every save; it is NOT the row's generic optimistic-concurrency
-- `revision` (jarvis_touch_revision), which still bumps on every update for
-- its own, unrelated purpose.
--
-- email_draft.signature_revision records which account-signature-revision
-- was last inserted into that draft's body as the managed block. Null means
-- no managed block has ever been inserted (a fresh draft, or one whose
-- account's signature was empty at compose time, per spec "skip the whole
-- block entirely"). The client compares this against the account's CURRENT
-- signature_revision to know whether the block it finds at the end of
-- body_text is still exactly what it inserted (untouched) before replacing
-- it on an account switch (AC19); this migration only carries the column and
-- the RPC plumbing, the comparison itself is client-side (src/email/drafts.ts).
--
-- draft_save, jarvis_draft_fields_bad and jarvis_draft_json (0050) are
-- redefined here to carry the one new scalar field through, the same way
-- 0059 redefined outbox_claim and outbox_claim_action for the send hold:
-- the bodies are the originals with the new field threaded in, nothing else
-- changes.

alter table email_account add column if not exists signature_text text not null default '';
alter table email_account add column if not exists signature_revision integer not null default 1;
alter table email_draft add column if not exists signature_revision integer;

-- ---- email_accounts(): the signature rides with the rest of the account's own facts ----
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
    'signature_text', a.signature_text, 'signature_revision', a.signature_revision,
    'cached', (select count(*) from email_message m where m.account_id = a.id and m.deleted_at is null)) order by a.connected_at), '[]'::jsonb)
  from email_account a where a.owner_id = auth.uid();
$$;

-- ---- jarvis_draft_fields_bad: the one new scalar, checked like the others ----
create or replace function jarvis_draft_fields_bad(p jsonb)
returns text
language plpgsql
immutable
as $$
declare
  k text;
  v jsonb;
  n integer;
begin
  if jsonb_typeof(p) <> 'object' then return 'fields'; end if;
  foreach k in array array['to_addresses', 'cc_addresses', 'bcc_addresses'] loop
    v := coalesce(p -> k, '[]'::jsonb);
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 100 then return k; end if;
    if exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 320 or (e #>> '{}') ~ E'[\\r\\n]') then return k; end if;
  end loop;
  if p ? 'subject' and (jsonb_typeof(p -> 'subject') <> 'string' or length(p ->> 'subject') > 998 or (p ->> 'subject') ~ E'[\\r\\n]') then return 'subject'; end if;
  if p ? 'body_text' and (jsonb_typeof(p -> 'body_text') <> 'string' or length(p ->> 'body_text') > 60000) then return 'body_text'; end if;
  if p ? 'thread_id' and jsonb_typeof(p -> 'thread_id') not in ('string', 'null') then return 'thread_id'; end if;
  if p ? 'reply_headers' and jsonb_typeof(p -> 'reply_headers') <> 'object' then return 'reply_headers'; end if;
  if p ? 'signature_revision' and jsonb_typeof(p -> 'signature_revision') not in ('number', 'null') then return 'signature_revision'; end if;
  v := coalesce(p -> 'attachment_refs', '[]'::jsonb);
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then return 'attachment_refs'; end if;
  select count(*) into n from jsonb_array_elements(v) e
   where jsonb_typeof(e) <> 'object'
      or coalesce(e ->> 'filename', '') = '' or length(e ->> 'filename') > 255 or (e ->> 'filename') ~ E'[\\r\\n"]'
      or coalesce(e ->> 'storage_id', '') = '' or length(e ->> 'storage_id') > 512
      or (e ->> 'storage_id') ~ '(^|/)\.\.?(/|$)' or (e ->> 'storage_id') ~ '(^|/)(/|$)'
      or jsonb_typeof(e -> 'size_bytes') <> 'number' or (e ->> 'size_bytes')::numeric <= 0 or (e ->> 'size_bytes')::numeric > 20971520
      or (e ? 'sha256' and not (e ->> 'sha256') ~ '^[0-9a-f]{64}$')
      or length(coalesce(e ->> 'mime_type', '')) > 255;
  if n > 0 then return 'attachment_refs'; end if;
  return null;
end;
$$;

-- ---- jarvis_draft_json: the draft as the browser reads it, now with signature_revision ----
create or replace function jarvis_draft_json(d email_draft)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id, 'account_id', d.account_id, 'account', (select address from email_account where id = d.account_id),
    'thread_id', d.thread_id, 'to_addresses', d.to_addresses, 'cc_addresses', d.cc_addresses, 'bcc_addresses', d.bcc_addresses,
    'subject', d.subject, 'body_text', d.body_text, 'attachment_refs', d.attachment_refs, 'reply_headers', d.reply_headers,
    'send_state', d.send_state, 'saved_at', d.saved_at, 'revision', d.revision, 'updated_at', d.updated_at, 'signature_revision', d.signature_revision,
    'sent_action_id', d.sent_action_id, 'provider_message_id', d.provider_message_id,
    'action_state', (select a.state from action a where a.id = d.sent_action_id),
    'action_verb', (select a.verb from action a where a.id = d.sent_action_id),
    'outbox_state', (select ob.state from outbox_command ob where ob.action_id = d.sent_action_id),
    'error_code', coalesce((select ob.error_code from outbox_command ob where ob.action_id = d.sent_action_id), (select a.error_code from action a where a.id = d.sent_action_id)),
    'provider_ack', (select ob.provider_ack from outbox_command ob where ob.action_id = d.sent_action_id));
$$;

-- ---- draft_save: unchanged logic, signature_revision now saved and returned through jarvis_draft_json ----
create or replace function draft_save(p_draft uuid, p_account uuid, p_fields jsonb, p_expected_revision integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  d email_draft%rowtype;
  bad text;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if jsonb_typeof(p_fields) <> 'object' or length(p_fields::text) > 400000 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'fields'); end if;
  bad := jarvis_draft_fields_bad(p_fields);
  if bad is not null then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', bad); end if;
  if p_account is null or not exists (select 1 from email_account where id = p_account and owner_id = owner and state <> 'disconnected') then
    return jsonb_build_object('error', 'PROVIDER_AUTH');
  end if;
  if p_draft is null then
    insert into email_draft (owner_id, account_id, thread_id, to_addresses, cc_addresses, bcc_addresses, subject, body_text, attachment_refs, reply_headers, signature_revision, saved_at)
    values (owner, p_account, nullif(p_fields ->> 'thread_id', ''),
            coalesce(p_fields -> 'to_addresses', '[]'::jsonb), coalesce(p_fields -> 'cc_addresses', '[]'::jsonb), coalesce(p_fields -> 'bcc_addresses', '[]'::jsonb),
            coalesce(p_fields ->> 'subject', ''), coalesce(p_fields ->> 'body_text', ''),
            coalesce(p_fields -> 'attachment_refs', '[]'::jsonb), coalesce(p_fields -> 'reply_headers', '{}'::jsonb), (p_fields ->> 'signature_revision')::integer, now())
    returning * into d;
    return jsonb_build_object('draft_id', d.id, 'revision', d.revision, 'saved_at', d.saved_at, 'send_state', d.send_state);
  end if;
  select * into d from email_draft where id = p_draft and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if d.send_state in ('sending', 'sent', 'unknown') then return jsonb_build_object('error', 'DRAFT_SENT', 'send_state', d.send_state, 'action_id', d.sent_action_id); end if;
  if p_expected_revision is not null and p_expected_revision <> d.revision then
    return jsonb_build_object('error', 'DRAFT_CONFLICT', 'revision', d.revision, 'draft', jarvis_draft_json(d));
  end if;
  update email_draft
     set account_id = p_account, thread_id = nullif(p_fields ->> 'thread_id', ''),
         to_addresses = coalesce(p_fields -> 'to_addresses', '[]'::jsonb), cc_addresses = coalesce(p_fields -> 'cc_addresses', '[]'::jsonb), bcc_addresses = coalesce(p_fields -> 'bcc_addresses', '[]'::jsonb),
         subject = coalesce(p_fields ->> 'subject', ''), body_text = coalesce(p_fields ->> 'body_text', ''),
         attachment_refs = coalesce(p_fields -> 'attachment_refs', '[]'::jsonb), reply_headers = coalesce(p_fields -> 'reply_headers', '{}'::jsonb),
         signature_revision = (p_fields ->> 'signature_revision')::integer,
         saved_at = now(), send_state = 'draft', sent_action_id = null
   where id = d.id
  returning * into d;
  return jsonb_build_object('draft_id', d.id, 'revision', d.revision, 'saved_at', d.saved_at, 'send_state', d.send_state);
end;
$$;

-- ---- email_signature_set: the one door to the saved signature ----
-- Verifies the account belongs to p_owner (and that p_owner is the caller),
-- optionally checks p_expected_revision for 409-style conflict semantics
-- (the same optimistic-concurrency shape draft_save already uses), then
-- saves and bumps the signature's own revision. Empty text is a valid,
-- explicit save.
create or replace function email_signature_set(p_owner uuid, p_account uuid, p_text text, p_expected_revision integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  a email_account%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_owner is null or p_owner <> owner then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_text is null or length(p_text) > 10000 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'text'); end if;
  select * into a from email_account where id = p_account and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if p_expected_revision is not null and p_expected_revision <> a.signature_revision then
    return jsonb_build_object('error', 'SIGNATURE_CONFLICT', 'signature_revision', a.signature_revision, 'signature_text', a.signature_text);
  end if;
  update email_account set signature_text = p_text, signature_revision = signature_revision + 1 where id = a.id returning * into a;
  return jsonb_build_object('account_id', a.id, 'signature_text', a.signature_text, 'signature_revision', a.signature_revision);
end;
$$;

revoke all on function email_signature_set(uuid, uuid, text, integer) from public, anon;
grant execute on function email_signature_set(uuid, uuid, text, integer) to authenticated;
