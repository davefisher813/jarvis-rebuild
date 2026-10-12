-- Rollback of 0069: the five replaced functions go back to the bodies they had before it (draft_save from 0063,
-- send_review and draft_discard from 0050, outbox_claim and outbox_claim_action from 0059), and the two new ones go.
-- No row is touched: a draft 0069 already moved from 'sending' to 'failed' stays 'failed' (what draft_outcome would
-- have written), which the old bodies accept.

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

drop function if exists draft_reopen(uuid);
drop function if exists jarvis_draft_release_paused(uuid, uuid);
