-- Rollback of 0072 (the email signature builder): the three replaced functions go back to the bodies they had before it
-- (email_signature_set from 0063, email_accounts from 0065, send_review from 0069), the two new functions go, and the three
-- columns go with them. A built signature's lines stay as plain text in signature_text (the old reader still shows them);
-- only the picture and the saved fields are lost, and the picture's stored object is left where it is.

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
    'sync_state', a.sync_state, 'verified_through_at', a.verified_through_at, 'coverage_start', a.coverage_start,
    'cached', (select count(*) from email_message m where m.account_id = a.id and m.deleted_at is null)) order by a.connected_at), '[]'::jsonb)
  from email_account a where a.owner_id = auth.uid();
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

drop function if exists email_signature_build_set(uuid, uuid, jsonb, jsonb, integer);
drop function if exists jarvis_signature_text(jsonb);
alter table email_account drop column if exists signature_image;
alter table email_account drop column if exists signature_fields;
alter table email_account drop column if exists signature_kind;
revoke all on function email_signature_set(uuid, uuid, text, integer) from public, anon;
grant execute on function email_signature_set(uuid, uuid, text, integer) to authenticated;
