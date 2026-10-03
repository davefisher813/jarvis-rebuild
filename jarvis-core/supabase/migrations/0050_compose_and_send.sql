-- 0050: COMPOSE, REPLIES AND THE EXACT SEND (docs/jarvis-unified, slice 07;
-- IMPLEMENTATION-SPEC.md 07.3, 08 E16 to E19, 09 M5 to M7, 11;
-- API-AND-VALIDATION.md "Canonical hashes", "Validation by payload" Send).
--
-- Additive. Three things:
--
--  1. The cached body keeps the headers a reply needs (Message-ID, References,
--     Reply-To), stored on open and read back with the message. Slice 05's
--     body store gains one argument; its old signature is dropped so PostgREST
--     has one function to call.
--  2. Drafts (0044's email_draft) get their doors: save with the revision the
--     device last saw (a different one is a conflict with both versions
--     returned, never a silent overwrite), read, list, discard. A draft that
--     has been handed to the send is no longer the browser's to edit.
--  3. The exact send: send_review builds the snapshot FROM THE DRAFT ROW (the
--     browser cannot review one text and send another), checks every address,
--     the From identity, the attachments' refs and the header lines, and hands
--     it to slice 03's command_review, whose hash binds account, recipients
--     (Bcc included), subject, body, attachment hashes, reply headers and the
--     draft revision. send_approve locks the draft, checks the review is this
--     draft's at this revision, consumes the approval through command_approve
--     and marks the draft sending; a second tap, from any device, is the same
--     action or a refusal, never a second send. draft_outcome is the worker's:
--     sent, failed or unknown, after the provider answered.
--
-- No send leaves from here. The worker (api/email/send.ts) claims the queued
-- command under 0046's fence and calls Gmail; the outcome comes back through
-- outbox_settle and draft_outcome.

-- ---------------------------------------------------------------------------
-- 1. Reply headers on the cached body.
-- ---------------------------------------------------------------------------
alter table email_message_body add column if not exists reply_headers jsonb not null default '{}'::jsonb;

drop function if exists email_body_store(uuid, uuid, text, text, jsonb);
create or replace function email_body_store(p_owner uuid, p_message uuid, p_text text, p_html text default null, p_attachments jsonb default null, p_headers jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if not exists (select 1 from email_message where id = p_message and owner_id = p_owner) then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  insert into email_message_body (message_id, owner_id, sanitized_text, html, sanitizer_version, reply_headers)
  values (p_message, p_owner, left(coalesce(p_text, ''), 200000), left(p_html, 1000000), 0,
          case when jsonb_typeof(p_headers) = 'object' then p_headers else '{}'::jsonb end)
  on conflict (message_id) do update
    set sanitized_text = excluded.sanitized_text, html = excluded.html, sanitizer_version = 0,
        reply_headers = case when jsonb_typeof(p_headers) = 'object' then p_headers else email_message_body.reply_headers end;
  update email_message set has_body = true, attachment_metadata = coalesce(p_attachments, attachment_metadata) where id = p_message;
  return jsonb_build_object('message_id', p_message, 'stored', true);
end;
$$;

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
    'has_body', b.message_id is not null, 'text', b.sanitized_text, 'html', b.html,
    'reply_headers', coalesce(b.reply_headers, '{}'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Drafts.
-- ---------------------------------------------------------------------------

-- An address line is one address: no spaces, no header breaks, one @, a
-- dotted domain. Validity is checked at the review; a draft may hold a
-- half-typed one.
create or replace function jarvis_address_ok(a text)
returns boolean
language sql
immutable
as $$
  select a is not null and length(a) between 3 and 320 and a ~ '^[^[:space:]@<>,;"\\]+@[^[:space:]@<>,;"\\]+\.[^[:space:]@<>,;"\\]+$';
$$;

-- The domain lowercased, the local part as typed (API-AND-VALIDATION.md).
create or replace function jarvis_address_norm(a text)
returns text
language sql
immutable
as $$
  select case when position('@' in a) > 0
              then split_part(btrim(a), '@', 1) || '@' || lower(substring(btrim(a) from position('@' in btrim(a)) + 1))
              else btrim(a) end;
$$;

-- The field, when a draft's typed fields are not a draft's; null when fine.
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
  v := coalesce(p -> 'attachment_refs', '[]'::jsonb);
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then return 'attachment_refs'; end if;
  select count(*) into n from jsonb_array_elements(v) e
   where jsonb_typeof(e) <> 'object'
      or coalesce(e ->> 'filename', '') = '' or length(e ->> 'filename') > 255 or (e ->> 'filename') ~ E'[\\r\\n"]'
      or coalesce(e ->> 'storage_id', '') = '' or length(e ->> 'storage_id') > 512
      or jsonb_typeof(e -> 'size_bytes') <> 'number' or (e ->> 'size_bytes')::numeric <= 0 or (e ->> 'size_bytes')::numeric > 20971520
      or (e ? 'sha256' and not (e ->> 'sha256') ~ '^[0-9a-f]{64}$')
      or length(coalesce(e ->> 'mime_type', '')) > 255;
  if n > 0 then return 'attachment_refs'; end if;
  return null;
end;
$$;

-- The draft as the browser reads it: the typed fields, the server's state,
-- and when sent, the action's state and the provider's answer.
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
    'send_state', d.send_state, 'saved_at', d.saved_at, 'revision', d.revision, 'updated_at', d.updated_at,
    'sent_action_id', d.sent_action_id, 'provider_message_id', d.provider_message_id,
    'action_state', (select a.state from action a where a.id = d.sent_action_id),
    'action_verb', (select a.verb from action a where a.id = d.sent_action_id),
    'outbox_state', (select ob.state from outbox_command ob where ob.action_id = d.sent_action_id),
    'error_code', coalesce((select ob.error_code from outbox_command ob where ob.action_id = d.sent_action_id), (select a.error_code from action a where a.id = d.sent_action_id)),
    'provider_ack', (select ob.provider_ack from outbox_command ob where ob.action_id = d.sent_action_id));
$$;

-- Save: a new draft, or this one at the revision the device last saw. A
-- different revision is DRAFT_CONFLICT with the server's copy, so the screen
-- can offer Keep This Draft or Use Newer Draft with both in view. A draft that
-- was handed to the send is DRAFT_SENT. A failed send's draft becomes a draft
-- again when it is saved.
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
    insert into email_draft (owner_id, account_id, thread_id, to_addresses, cc_addresses, bcc_addresses, subject, body_text, attachment_refs, reply_headers, saved_at)
    values (owner, p_account, nullif(p_fields ->> 'thread_id', ''),
            coalesce(p_fields -> 'to_addresses', '[]'::jsonb), coalesce(p_fields -> 'cc_addresses', '[]'::jsonb), coalesce(p_fields -> 'bcc_addresses', '[]'::jsonb),
            coalesce(p_fields ->> 'subject', ''), coalesce(p_fields ->> 'body_text', ''),
            coalesce(p_fields -> 'attachment_refs', '[]'::jsonb), coalesce(p_fields -> 'reply_headers', '{}'::jsonb), now())
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
         saved_at = now(), send_state = 'draft', sent_action_id = null
   where id = d.id
  returning * into d;
  return jsonb_build_object('draft_id', d.id, 'revision', d.revision, 'saved_at', d.saved_at, 'send_state', d.send_state);
end;
$$;

create or replace function draft_get(p_draft uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  d email_draft%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into d from email_draft where id = p_draft and owner_id = owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jarvis_draft_json(d);
end;
$$;

-- Drafts (and the sends that failed, so Review Again is a tap away) newest
-- saved first; the sends (sending, sent, unknown) newest first.
create or replace function draft_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'drafts', coalesce((select jsonb_agg(jarvis_draft_json(d) order by d.saved_at desc, d.id desc) from (select * from email_draft where owner_id = auth.uid() and send_state in ('draft', 'failed') order by saved_at desc limit 200) d), '[]'::jsonb),
    'sent', coalesce((select jsonb_agg(jarvis_draft_json(d) order by d.updated_at desc, d.id desc) from (select * from email_draft where owner_id = auth.uid() and send_state in ('sending', 'sent', 'unknown') order by updated_at desc limit 200) d), '[]'::jsonb));
$$;

-- Discard: gone, with the copy returned so Undo can save it again as a new
-- draft while nothing else changed. A draft in the send's hands stays.
create or replace function draft_discard(p_draft uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  d email_draft%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into d from email_draft where id = p_draft and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if d.send_state in ('sending', 'sent', 'unknown') then return jsonb_build_object('error', 'DRAFT_SENT', 'send_state', d.send_state); end if;
  delete from email_draft where id = d.id;
  return jsonb_build_object('draft_id', d.id, 'discarded', true, 'draft', jarvis_draft_json(d));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The exact review and the tap.
-- ---------------------------------------------------------------------------

-- The snapshot is built here, from the row, never taken from the browser:
-- what the person reviews is what the worker sends. Every address is checked
-- and normalised (domain lowercased); Bcc is in the snapshot and in the hash;
-- the From identity is the account's address and nothing else; each
-- attachment ref must be owned (under the owner's own folder), sized and
-- hashed; the subject and the addresses carry no header breaks. Empty subject
-- and empty body are warnings the review shows, never text the server makes
-- up. The verb is the receipt's exact line.
create or replace function send_review(p_draft uuid, p_expected_revision integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  d email_draft%rowtype;
  acct email_account%rowtype;
  to_n jsonb := '[]'::jsonb;
  cc_n jsonb := '[]'::jsonb;
  bcc_n jsonb := '[]'::jsonb;
  atts jsonb := '[]'::jsonb;
  e jsonb;
  total bigint := 0;
  in_reply_to text;
  refs jsonb;
  thread text;
  snapshot jsonb;
  verb text;
  warnings jsonb := '[]'::jsonb;
  n integer;
  r jsonb;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into d from email_draft where id = p_draft and owner_id = owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if d.send_state in ('sending', 'sent') then return jsonb_build_object('error', 'DRAFT_SENT', 'send_state', d.send_state, 'action_id', d.sent_action_id); end if;
  if d.send_state = 'unknown' then return jsonb_build_object('error', 'OUTCOME_UNKNOWN', 'action_id', d.sent_action_id); end if;
  if p_expected_revision is not null and p_expected_revision <> d.revision then
    return jsonb_build_object('error', 'DRAFT_CONFLICT', 'revision', d.revision, 'draft', jarvis_draft_json(d));
  end if;
  select * into acct from email_account where id = d.account_id and owner_id = owner;
  if not found or acct.state <> 'connected' then return jsonb_build_object('error', 'PROVIDER_AUTH'); end if;

  for e in select * from jsonb_array_elements(d.to_addresses) loop
    if not jarvis_address_ok(btrim(e #>> '{}')) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'to', 'address', e #>> '{}'); end if;
    to_n := to_n || to_jsonb(jarvis_address_norm(e #>> '{}'));
  end loop;
  for e in select * from jsonb_array_elements(d.cc_addresses) loop
    if not jarvis_address_ok(btrim(e #>> '{}')) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'cc', 'address', e #>> '{}'); end if;
    cc_n := cc_n || to_jsonb(jarvis_address_norm(e #>> '{}'));
  end loop;
  for e in select * from jsonb_array_elements(d.bcc_addresses) loop
    if not jarvis_address_ok(btrim(e #>> '{}')) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'bcc', 'address', e #>> '{}'); end if;
    bcc_n := bcc_n || to_jsonb(jarvis_address_norm(e #>> '{}'));
  end loop;
  if jsonb_array_length(to_n) = 0 then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', jsonb_build_array('to')); end if;
  if d.subject ~ E'[\\r\\n]' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'subject'); end if;

  for e in select * from jsonb_array_elements(d.attachment_refs) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e ->> 'sha256', '') !~ '^[0-9a-f]{64}$' or coalesce(e ->> 'filename', '') = ''
       or coalesce(e ->> 'storage_id', '') = '' or position(owner::text || '/' in e ->> 'storage_id') <> 1
       or jsonb_typeof(e -> 'size_bytes') <> 'number' or (e ->> 'size_bytes')::numeric <= 0 then
      return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'attachment', 'filename', e ->> 'filename');
    end if;
    total := total + (e ->> 'size_bytes')::bigint;
    atts := atts || jsonb_build_object('storage_id', e ->> 'storage_id', 'filename', e ->> 'filename', 'size_bytes', (e ->> 'size_bytes')::bigint,
                                       'sha256', e ->> 'sha256', 'mime_type', coalesce(nullif(e ->> 'mime_type', ''), 'application/octet-stream'));
  end loop;
  if total > 20971520 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'attachments_size'); end if;

  in_reply_to := nullif(btrim(coalesce(d.reply_headers ->> 'in_reply_to', '')), '');
  refs := case when jsonb_typeof(d.reply_headers -> 'references') = 'array' then d.reply_headers -> 'references' else '[]'::jsonb end;
  thread := coalesce(nullif(d.reply_headers ->> 'thread_id', ''), d.thread_id);
  if in_reply_to is not null and in_reply_to ~ E'[\\r\\n]' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'reply_headers'); end if;

  snapshot := jsonb_build_object(
    'account_id', d.account_id, 'from_identity', acct.address,
    'to', to_n, 'cc', cc_n, 'bcc', bcc_n,
    'subject', d.subject, 'body_text', d.body_text, 'attachments', atts,
    'reply_headers', jsonb_build_object('in_reply_to', in_reply_to, 'references', refs, 'thread_id', thread),
    'draft_id', d.id, 'draft_revision', d.revision,
    'client_message_id', '<' || d.id::text || '.' || d.revision::text || '@jarvis.local>');

  n := jsonb_array_length(to_n) + jsonb_array_length(cc_n) + jsonb_array_length(bcc_n);
  verb := case when in_reply_to is not null then 'Sent Reply to ' else 'Sent to ' end || (to_n ->> 0)
          || case when n > 1 then ' and ' || (n - 1)::text || ' More' else '' end;
  if length(btrim(d.subject)) = 0 then warnings := warnings || to_jsonb('empty_subject'::text); end if;
  if length(btrim(d.body_text)) = 0 then warnings := warnings || to_jsonb('empty_body'::text); end if;

  r := command_review('send_email', snapshot, d.account_id, left(verb, 200), d.revision);
  if r ? 'error' then return r; end if;
  return jsonb_build_object('review', r, 'exact', snapshot, 'warnings', warnings, 'verb', left(verb, 200), 'draft_revision', d.revision);
end;
$$;

-- The tap. The draft row is the lock: two taps, two devices, one action.
create or replace function send_approve(p_draft uuid, p_review_nonce text, p_shown_payload_hash text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  d email_draft%rowtype;
  act action%rowtype;
  ob outbox_command%rowtype;
  r jsonb;
  seen boolean;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into d from email_draft where id = p_draft and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select ac.* into act from action ac join approval ap on ap.action_id = ac.id where ap.nonce = p_review_nonce and ac.owner_id = owner;
  seen := found;
  if d.send_state in ('sending', 'sent', 'unknown') then
    if seen and act.id = d.sent_action_id then return jarvis_action_replay(act) || jsonb_build_object('draft_id', d.id, 'send_state', d.send_state); end if;
    return jsonb_build_object('error', 'DRAFT_SENT', 'send_state', d.send_state, 'action_id', d.sent_action_id);
  end if;
  if not seen then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select * into ob from outbox_command where action_id = act.id;
  if not found or ob.kind <> 'send_email' or (ob.payload ->> 'draft_id') is distinct from d.id::text then return jsonb_build_object('error', 'REVIEW_CHANGED', 'detail', 'draft'); end if;
  if act.expected_revision is distinct from d.revision then return jsonb_build_object('error', 'REVIEW_CHANGED', 'detail', 'revision', 'revision', d.revision); end if;
  r := command_approve(p_review_nonce, p_shown_payload_hash, p_idempotency_key);
  if r ? 'error' then return r; end if;
  update email_draft set send_state = 'sending', sent_action_id = (r ->> 'action_id')::uuid where id = d.id;
  return r || jsonb_build_object('draft_id', d.id, 'send_state', 'sending');
end;
$$;

-- The worker's claim of ONE command: the one the request that approved it
-- now carries out. The same checks as 0046's outbox_claim (approved by the
-- person, within five minutes, the account still connected), the same fence;
-- only the choice of row differs, so a send never waits behind, or runs
-- inside, somebody else's request.
create or replace function outbox_claim_action(p_worker text, p_action uuid, p_lease interval default interval '2 minutes')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ob outbox_command%rowtype;
  a action%rowtype;
  tok uuid := gen_random_uuid();
  approved_at timestamptz;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into ob from outbox_command
   where action_id = p_action and (state = 'queued' or (state = 'claimed' and claim_expires_at <= now()))
   for update skip locked;
  if not found then return null; end if;
  select * into a from action where id = ob.action_id for update;
  select consumed_at into approved_at from approval where action_id = a.id order by consumed_at desc nulls last limit 1;
  if a.state not in ('approved', 'running') or a.actor_kind <> 'user' or approved_at is null then
    update outbox_command set state = 'cancelled', error_code = 'NOT_APPROVED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', left('Cancelled · ' || a.verb, 200), 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'NOT_APPROVED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'NOT_APPROVED');
  end if;
  if ob.state = 'queued' and approved_at + interval '5 minutes' <= now() then
    update outbox_command set state = 'cancelled', error_code = 'APPROVAL_EXPIRED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Approval Expired · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'APPROVAL_EXPIRED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'APPROVAL_EXPIRED');
  end if;
  if not exists (select 1 from email_account where id = ob.provider_account_id and owner_id = ob.owner_id and state = 'connected') then
    update outbox_command set state = 'failed', error_code = 'PROVIDER_AUTH' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'failed', 'Not Sent · Reconnect Gmail', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'PROVIDER_AUTH');
    return jsonb_build_object('skipped', ob.id, 'reason', 'PROVIDER_AUTH');
  end if;
  update outbox_command
     set state = 'claimed', claim_token = tok, claimed_by = left(coalesce(p_worker, ''), 100), claimed_at = now(), claim_expires_at = now() + p_lease, attempt = attempt + 1
   where id = ob.id;
  update action set state = 'running', attempt = ob.attempt + 1 where id = a.id;
  return jsonb_build_object('outbox_id', ob.id, 'action_id', a.id, 'owner_id', ob.owner_id, 'kind', ob.kind, 'payload', ob.payload,
                            'payload_hash', ob.payload_hash, 'provider_account_id', ob.provider_account_id, 'claim_token', tok, 'attempt', ob.attempt + 1,
                            'lease_until', now() + p_lease);
end;
$$;

-- The worker's word, after outbox_settle or outbox_reconcile: the draft is
-- sent (with the provider's id), failed (a draft again, with Review Again a
-- tap away), or unknown (blocked until reconciled; never resent by anyone).
create or replace function draft_outcome(p_action uuid, p_state text, p_provider_message_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d email_draft%rowtype;
  st text;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into d from email_draft where sent_action_id = p_action for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  st := case p_state when 'confirmed' then 'sent' when 'failed' then 'failed' when 'outcome_unknown' then 'unknown' else null end;
  if st is null then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'state'); end if;
  if d.send_state = 'sent' and st <> 'sent' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'already sent'); end if;
  update email_draft set send_state = st, provider_message_id = case when st = 'sent' then coalesce(p_provider_message_id, provider_message_id) else provider_message_id end where id = d.id;
  return jsonb_build_object('draft_id', d.id, 'send_state', st, 'action_id', p_action);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants.
-- ---------------------------------------------------------------------------
revoke all on function email_body_store(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function email_body_store(uuid, uuid, text, text, jsonb, jsonb) to service_role;

revoke all on function jarvis_address_ok(text) from public, anon, authenticated;
revoke all on function jarvis_address_norm(text) from public, anon, authenticated;
revoke all on function jarvis_draft_fields_bad(jsonb) from public, anon, authenticated;
revoke all on function jarvis_draft_json(email_draft) from public, anon, authenticated;

revoke all on function draft_save(uuid, uuid, jsonb, integer) from public, anon;
revoke all on function draft_get(uuid) from public, anon;
revoke all on function draft_list() from public, anon;
revoke all on function draft_discard(uuid) from public, anon;
revoke all on function send_review(uuid, integer) from public, anon;
revoke all on function send_approve(uuid, text, text, text) from public, anon;
grant execute on function draft_save(uuid, uuid, jsonb, integer) to authenticated;
grant execute on function draft_get(uuid) to authenticated;
grant execute on function draft_list() to authenticated;
grant execute on function draft_discard(uuid) to authenticated;
grant execute on function send_review(uuid, integer) to authenticated;
grant execute on function send_approve(uuid, text, text, text) to authenticated;

revoke all on function draft_outcome(uuid, text, text) from public, anon, authenticated;
grant execute on function draft_outcome(uuid, text, text) to service_role;
revoke all on function outbox_claim_action(text, uuid, interval) from public, anon, authenticated;
grant execute on function outbox_claim_action(text, uuid, interval) to service_role;
