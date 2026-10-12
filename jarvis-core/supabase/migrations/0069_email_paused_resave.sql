-- Migration 0069: a paused send can be opened, saved and reviewed again (Email v1 spec 2026-10-08, section 9.1:
-- paused_review_required -> draft/review_ready only after a fresh review; the prior attempt stays immutable; a new
-- approval makes a new hold). Additive: create or replace only, no table, no column, no row rewritten by the migration
-- itself. Rollback: rollback/0069_email_paused_resave_down.sql.
--
-- THE DEFECT. paused_sends() (0068) lists a draft that is still send_state 'sending' when its command never reached
-- Gmail: the worker refused it at claim (outbox 'failed', PROVIDER_AUTH) or cancelled it (NOT_APPROVED,
-- APPROVAL_EXPIRED). The claim wrote the outbox row and left the draft 'sending'; only a SEPARATE later call
-- (api/_outboxWorker.ts settleDraft -> draft_outcome) moved the draft to 'failed', and when that call never happened
-- (the request died, the read failed, an older row) the draft stayed 'sending' for good. Opening it from the paused
-- list and saving it then hit draft_save's guard
--     if d.send_state in ('sending', 'sent', 'unknown') then return jsonb_build_object('error', 'DRAFT_SENT', ...)
-- and Review Send hit send_review's
--     if d.send_state in ('sending', 'sent') then return jsonb_build_object('error', 'DRAFT_SENT', ...)
-- so the person saw "Already Sent · Nothing Left to Change" on a message that was never sent, and could not discard
-- it either (draft_discard has the same guard).
--
-- THE FIX, two halves.
--  1. jarvis_draft_release_paused(owner, draft), internal: a draft still 'sending' whose OWN command is terminal
--     without dispatch (outbox state 'failed' or 'cancelled' AND dispatched_at is null, a send_email command) becomes
--     'failed', exactly what draft_outcome would have written: sent_action_id is kept as the history the paused list
--     and the receipts read, the revision does not move (state columns never move it, 0050 section 4). Nothing else
--     is released: a command that is queued, claimed, dispatched, confirmed or outcome_unknown leaves the draft as it
--     is, so an unknown or possibly-sent message can never become resendable here. A terminal row cannot change
--     again (claims take queued/claimed, settle takes claimed/dispatched, reconcile takes outcome_unknown), so it is
--     read without a lock and the draft row is the only lock taken (no new lock order against the worker).
--     draft_save, send_review and draft_discard call it first, and draft_reopen (new, the paused list's door) calls
--     it and returns the draft, so opening a paused item lands on an editable draft atomically.
--  2. outbox_claim and outbox_claim_action (the 0059 bodies) settle the draft in the same transaction when they
--     refuse a command (NOT_APPROVED, APPROVAL_EXPIRED, PROVIDER_AUTH): 'failed', sent_action_id kept, only when the
--     draft is still 'sending' for that very action. HOLD_EXPIRED already freed the draft (0059) and is unchanged.
--     The worker's settleDraft still runs after and writes the same 'failed' (draft_outcome, unchanged).
-- The prior attempt (action, outbox row, receipts) is never touched. A fresh Review Send makes a new action and a
-- new outbox row through command_review; send_approve_held stamps a new 30-second hold on it. Unchanged here:
-- send_approve, send_approve_held, command_cancel, draft_outcome, paused_sends.
--
-- Bodies: draft_save is 0063's, send_review and draft_discard are 0050's, the two claims are 0059's, each with only
-- the lines marked "0069" added. The production database was not reachable from the session that wrote this
-- (pg_get_functiondef could not be read), so the repo's latest bodies stand in for production: before applying,
-- compare pg_get_functiondef of these five against them.

-- ---------------------------------------------------------------------------
-- 1. The release, and the paused list's door.
-- ---------------------------------------------------------------------------
create or replace function jarvis_draft_release_paused(p_owner uuid, p_draft uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  d email_draft%rowtype;
  ob outbox_command%rowtype;
begin
  if p_owner is null or p_draft is null then return false; end if;
  select * into d from email_draft where id = p_draft and owner_id = p_owner for update;
  if not found or d.send_state <> 'sending' or d.sent_action_id is null then return false; end if;
  select * into ob from outbox_command where action_id = d.sent_action_id and owner_id = p_owner;
  if not found or ob.kind <> 'send_email' or ob.state not in ('failed', 'cancelled') or ob.dispatched_at is not null then return false; end if;
  update email_draft set send_state = 'failed' where id = d.id;
  return true;
end;
$$;

-- Open a paused draft: released when its send stopped before Gmail, then read. editable says whether the composer may
-- take it ('draft' or 'failed'); a draft that is held, sending, sent or unknown is returned as it is, never released.
create or replace function draft_reopen(p_draft uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  d email_draft%rowtype;
  released boolean;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  released := jarvis_draft_release_paused(owner, p_draft);
  select * into d from email_draft where id = p_draft and owner_id = owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jarvis_draft_json(d) || jsonb_build_object('released', released, 'editable', d.send_state in ('draft', 'failed'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The person's doors: release first, then exactly as before.
-- ---------------------------------------------------------------------------
-- draft_save (0063's body)
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
  -- 0069: a send that stopped before Gmail is the person's again (the prior attempt stays as it was).
  perform jarvis_draft_release_paused(owner, p_draft);
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

-- send_review (0050's body)
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
  -- 0069: a send that stopped before Gmail is the person's again (the prior attempt stays as it was).
  perform jarvis_draft_release_paused(owner, p_draft);
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
       -- the owner's folder segment by segment: no "..", no ".", no empty segment, so the path cannot fold out of it
       or (e ->> 'storage_id') ~ '(^|/)\.\.?(/|$)' or (e ->> 'storage_id') ~ '(^|/)(/|$)' 
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

-- draft_discard (0050's body)
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
  -- 0069: a send that stopped before Gmail is the person's again (the prior attempt stays as it was).
  perform jarvis_draft_release_paused(owner, p_draft);
  select * into d from email_draft where id = p_draft and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if d.send_state in ('sending', 'sent', 'unknown') then return jsonb_build_object('error', 'DRAFT_SENT', 'send_state', d.send_state); end if;
  delete from email_draft where id = d.id;
  return jsonb_build_object('draft_id', d.id, 'discarded', true, 'draft', jarvis_draft_json(d));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The worker's claims: a refused command settles its draft in the same transaction.
-- ---------------------------------------------------------------------------
-- outbox_claim (0059's body)
create or replace function outbox_claim(p_worker text, p_lease interval default interval '2 minutes')
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
   where hold_until is not null and ((state = 'queued' and hold_until <= now()) or (state = 'claimed' and claim_expires_at <= now()))
   order by created_at
   for update skip locked
   limit 1;
  if not found then return null; end if;
  select * into a from action where id = ob.action_id for update;
  select consumed_at into approved_at from approval where action_id = a.id order by consumed_at desc nulls last limit 1;
  -- Recheck just before dispatch: the person approved it (a user action, the
  -- approval consumed), within the last five minutes, nothing cancelled, the
  -- account still connected.
  if a.state not in ('approved', 'running') or a.actor_kind <> 'user' or approved_at is null then
    update outbox_command set state = 'cancelled', error_code = 'NOT_APPROVED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', left('Cancelled · ' || a.verb, 200), 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'NOT_APPROVED');
    -- 0069: the draft is settled in the same transaction (failed, never left), not left 'sending' for a later call.
    update email_draft set send_state = 'failed' where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
    return jsonb_build_object('skipped', ob.id, 'reason', 'NOT_APPROVED');
  end if;
  -- A held send that no worker reached by its deadline is never sent late: it comes back as a draft for a fresh look.
  if ob.state = 'queued' and ob.dispatch_deadline is not null and now() > ob.dispatch_deadline then
    update outbox_command set state = 'cancelled', error_code = 'HOLD_EXPIRED' where id = ob.id;
    update email_draft set send_state = 'draft', sent_action_id = null where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Held Too Long · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'HOLD_EXPIRED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'HOLD_EXPIRED');
  end if;
  if ob.state = 'queued' and ob.hold_until is null and approved_at + interval '5 minutes' <= now() then
    update outbox_command set state = 'cancelled', error_code = 'APPROVAL_EXPIRED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Approval Expired · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'APPROVAL_EXPIRED');
    -- 0069: the draft is settled in the same transaction (failed, never left), not left 'sending' for a later call.
    update email_draft set send_state = 'failed' where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
    return jsonb_build_object('skipped', ob.id, 'reason', 'APPROVAL_EXPIRED');
  end if;
  if not exists (select 1 from email_account where id = ob.provider_account_id and owner_id = ob.owner_id and state = 'connected') then
    update outbox_command set state = 'failed', error_code = 'PROVIDER_AUTH' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'failed', 'Not Sent · Reconnect Gmail', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'PROVIDER_AUTH');
    -- 0069: the draft is settled in the same transaction (failed, never left), not left 'sending' for a later call.
    update email_draft set send_state = 'failed' where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
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

-- outbox_claim_action (0059's body)
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
   where action_id = p_action and ((state = 'queued' and (hold_until is null or hold_until <= now())) or (state = 'claimed' and claim_expires_at <= now()))
   for update skip locked;
  if not found then return null; end if;
  select * into a from action where id = ob.action_id for update;
  select consumed_at into approved_at from approval where action_id = a.id order by consumed_at desc nulls last limit 1;
  if a.state not in ('approved', 'running') or a.actor_kind <> 'user' or approved_at is null then
    update outbox_command set state = 'cancelled', error_code = 'NOT_APPROVED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', left('Cancelled · ' || a.verb, 200), 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'NOT_APPROVED');
    -- 0069: the draft is settled in the same transaction (failed, never left), not left 'sending' for a later call.
    update email_draft set send_state = 'failed' where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
    return jsonb_build_object('skipped', ob.id, 'reason', 'NOT_APPROVED');
  end if;
  if ob.state = 'queued' and ob.dispatch_deadline is not null and now() > ob.dispatch_deadline then
    update outbox_command set state = 'cancelled', error_code = 'HOLD_EXPIRED' where id = ob.id;
    update email_draft set send_state = 'draft', sent_action_id = null where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Held Too Long · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'HOLD_EXPIRED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'HOLD_EXPIRED');
  end if;
  if ob.state = 'queued' and ob.hold_until is null and approved_at + interval '5 minutes' <= now() then
    update outbox_command set state = 'cancelled', error_code = 'APPROVAL_EXPIRED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Approval Expired · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'APPROVAL_EXPIRED');
    -- 0069: the draft is settled in the same transaction (failed, never left), not left 'sending' for a later call.
    update email_draft set send_state = 'failed' where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
    return jsonb_build_object('skipped', ob.id, 'reason', 'APPROVAL_EXPIRED');
  end if;
  if not exists (select 1 from email_account where id = ob.provider_account_id and owner_id = ob.owner_id and state = 'connected') then
    update outbox_command set state = 'failed', error_code = 'PROVIDER_AUTH' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'failed', 'Not Sent · Reconnect Gmail', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'PROVIDER_AUTH');
    -- 0069: the draft is settled in the same transaction (failed, never left), not left 'sending' for a later call.
    update email_draft set send_state = 'failed' where owner_id = ob.owner_id and sent_action_id = a.id and send_state = 'sending';
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

-- ---------------------------------------------------------------------------
-- 4. Grants. The replaced functions keep their grants (create or replace keeps the ACL); restated for the record.
-- ---------------------------------------------------------------------------
revoke all on function jarvis_draft_release_paused(uuid, uuid) from public, anon, authenticated;
revoke all on function draft_reopen(uuid) from public, anon;
grant execute on function draft_reopen(uuid) to authenticated;
revoke all on function draft_save(uuid, uuid, jsonb, integer) from public, anon;
revoke all on function send_review(uuid, integer) from public, anon;
revoke all on function draft_discard(uuid) from public, anon;
grant execute on function draft_save(uuid, uuid, jsonb, integer) to authenticated;
grant execute on function send_review(uuid, integer) to authenticated;
grant execute on function draft_discard(uuid) to authenticated;
revoke all on function outbox_claim(text, interval) from public, anon, authenticated;
revoke all on function outbox_claim_action(text, uuid, interval) from public, anon, authenticated;
grant execute on function outbox_claim(text, interval) to service_role;
grant execute on function outbox_claim_action(text, uuid, interval) to service_role;
