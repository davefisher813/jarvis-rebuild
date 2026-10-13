-- Migration 0072: the email signature BUILDER (issue 113; Dave 2026-10-13: "Upload a pic. It auto scales. Enter your info and it
-- creates a perfect signature."). Additive; rollback in rollback/0072_email_signature_builder_down.sql.
--
-- A built signature is the account's own: its info fields (name, title, organization, phone, email, website) and one
-- picture (a small PNG or JPEG the browser scaled to fit, stored in the user's own folder of the private user-files
-- bucket, never public). The composed text lines are what the existing signature column already carries
-- (signature_text), so the composer, the draft, Review Send, the revision machinery (AC17 to AC19) and the plain-text
-- part of every sent message are UNCHANGED: the lines appear once, in the draft body, as they always did. The picture
-- is not in the body. It rides with the reviewed message as a reference (send_review, below) and only while the draft
-- still ends with the current signature block, so a picture is never sent next to words the person changed.
--
--   signature_kind    'text' (typed or pasted, the existing editor: no picture) or 'built' (the builder)
--   signature_fields  the six info fields as saved; blank ones are simply absent
--   signature_image   null, or {storage_id, sha256, size_bytes, mime_type, width, height}
--
-- email_signature_build_set is the one door for a built signature (same shape as email_signature_set: owner check,
-- optimistic revision, definer). email_signature_set (the plain editor) now also puts the account back to 'text' and
-- removes the picture, so a stale picture can never ride with hand-written words. email_accounts() returns the three
-- new keys. send_review is 0069's body plus one rider. No statement here removes anything.

alter table email_account add column if not exists signature_kind text not null default 'text' check (signature_kind in ('text', 'built'));
alter table email_account add column if not exists signature_fields jsonb not null default '{}'::jsonb;
alter table email_account add column if not exists signature_image jsonb;

-- ---- the composed lines: THE one definition of "blank fields simply do not appear" ----
-- name, title, organization, phone, email, website, in that order, each trimmed, a blank one left out, joined by a line
-- break. The browser's composer (src/email/signature.ts) must produce exactly the same text; tests hold the two together.
create or replace function jarvis_signature_text(p_fields jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(string_agg(v, E'\n' order by ord), '')
  from (
    select ord, btrim(p_fields ->> k) as v
    from unnest(array['name', 'title', 'organization', 'phone', 'email', 'website']) with ordinality as t(k, ord)
  ) x
  where v is not null and v <> '';
$$;

-- ---- email_signature_build_set: the one door for a built signature ----
create or replace function email_signature_build_set(p_owner uuid, p_account uuid, p_fields jsonb, p_image jsonb, p_expected_revision integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  a email_account%rowtype;
  k text;
  v jsonb;
  txt text;
  sid text;
  lim integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_owner is null or p_owner <> owner then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;

  -- the info: an object of at most the six known keys, text only, one line each, a sane length
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'fields'); end if;
  for k, v in select * from jsonb_each(p_fields) loop
    if k not in ('name', 'title', 'organization', 'phone', 'email', 'website') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'fields'); end if;
    if jsonb_typeof(v) <> 'string' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'fields'); end if;
    if (v #>> '{}') ~ '[[:cntrl:]]' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'fields'); end if;
    lim := case when k = 'email' then 254 else 200 end;
    if length(v #>> '{}') > lim then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'fields'); end if;
  end loop;
  txt := jarvis_signature_text(p_fields);
  -- a signature with nothing in it is the plain editor's empty save, not a built one
  if txt = '' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'empty'); end if;

  -- the picture: null, or a reference to one small image already uploaded to THIS owner's own folder
  if p_image is not null and jsonb_typeof(p_image) <> 'null' then
    if jsonb_typeof(p_image) <> 'object' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'image'); end if;
    sid := p_image ->> 'storage_id';
    if sid is null or length(sid) > 512 or position(owner::text || '/' in sid) <> 1
       or sid ~ '(^|/)\.\.?(/|$)' or sid ~ '(^|/)(/|$)' then
      return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'image');
    end if;
    if coalesce(p_image ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'image'); end if;
    if coalesce(p_image ->> 'mime_type', '') not in ('image/png', 'image/jpeg') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'image'); end if;
    if jsonb_typeof(p_image -> 'size_bytes') <> 'number' or coalesce(p_image ->> 'size_bytes', '') !~ '^[0-9]{1,6}$'
       or (p_image ->> 'size_bytes')::integer not between 1 and 60000 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'image'); end if;
    if jsonb_typeof(p_image -> 'width') <> 'number' or coalesce(p_image ->> 'width', '') !~ '^[0-9]{1,3}$' or (p_image ->> 'width')::integer not between 1 and 512
       or jsonb_typeof(p_image -> 'height') <> 'number' or coalesce(p_image ->> 'height', '') !~ '^[0-9]{1,3}$' or (p_image ->> 'height')::integer not between 1 and 512 then
      return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'image');
    end if;
    -- it must really be there: a signature never points at an object nobody uploaded
    if not exists (select 1 from storage.objects o where o.bucket_id = 'user-files' and o.name = sid) then
      return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'image_missing');
    end if;
    p_image := jsonb_build_object('storage_id', sid, 'sha256', p_image ->> 'sha256', 'size_bytes', (p_image ->> 'size_bytes')::integer,
                                  'mime_type', p_image ->> 'mime_type', 'width', (p_image ->> 'width')::integer, 'height', (p_image ->> 'height')::integer);
  else
    p_image := null;
  end if;

  select * into a from email_account where id = p_account and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if p_expected_revision is not null and p_expected_revision <> a.signature_revision then
    return jsonb_build_object('error', 'SIGNATURE_CONFLICT', 'signature_revision', a.signature_revision, 'signature_text', a.signature_text,
                              'signature_kind', a.signature_kind, 'signature_fields', a.signature_fields, 'signature_image', a.signature_image);
  end if;
  update email_account
     set signature_text = txt, signature_kind = 'built', signature_fields = (select coalesce(jsonb_object_agg(key, btrim(value #>> '{}')), '{}'::jsonb) from jsonb_each(p_fields) where btrim(value #>> '{}') <> ''),
         signature_image = p_image, signature_revision = signature_revision + 1
   where id = a.id returning * into a;
  return jsonb_build_object('account_id', a.id, 'signature_text', a.signature_text, 'signature_revision', a.signature_revision,
                            'signature_kind', a.signature_kind, 'signature_fields', a.signature_fields, 'signature_image', a.signature_image);
end;
$$;

-- ---- email_signature_set (the plain editor): 0063's body, and the account goes back to plain text with no picture ----
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
    return jsonb_build_object('error', 'SIGNATURE_CONFLICT', 'signature_revision', a.signature_revision, 'signature_text', a.signature_text,
                              'signature_kind', a.signature_kind, 'signature_fields', a.signature_fields, 'signature_image', a.signature_image);
  end if;
  -- 0072: what is typed or pasted is the whole signature; a picture from the builder does not ride with hand-written words.
  update email_account set signature_text = p_text, signature_revision = signature_revision + 1,
                           signature_kind = 'text', signature_fields = '{}'::jsonb, signature_image = null where id = a.id returning * into a;
  return jsonb_build_object('account_id', a.id, 'signature_text', a.signature_text, 'signature_revision', a.signature_revision,
                            'signature_kind', a.signature_kind, 'signature_fields', a.signature_fields, 'signature_image', a.signature_image);
end;
$$;

-- ---- email_accounts(): 0065's body plus the three new keys ----
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
    'signature_kind', a.signature_kind, 'signature_fields', a.signature_fields, 'signature_image', a.signature_image,
    'sync_state', a.sync_state, 'verified_through_at', a.verified_through_at, 'coverage_start', a.coverage_start,
    'cached', (select count(*) from email_message m where m.account_id = a.id and m.deleted_at is null)) order by a.connected_at), '[]'::jsonb)
  from email_account a where a.owner_id = auth.uid();
$$;

-- ---- send_review: 0069's body plus the picture rider ----
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

  -- 0072: a built signature's picture rides with the exact message, and ONLY while the draft still ends with the account's
  -- current signature block and was made against its current revision: the SQL mirror of the client's signatureUntouched
  -- (src/email/drafts.ts). The picture is never sent next to words the person changed, or next to a signature that has
  -- moved on since the draft was made; then the message goes out as text, exactly as typed. What rides is a reference
  -- (the stored object, its hash and size) and the fields, never the bytes: the worker fetches and checks them at send time.
  if acct.signature_kind = 'built' and acct.signature_image is not null and acct.signature_text <> ''
     and d.signature_revision is not distinct from acct.signature_revision
     and right(d.body_text, length(E'\n\n-- \n' || acct.signature_text)) = E'\n\n-- \n' || acct.signature_text then
    snapshot := snapshot || jsonb_build_object('signature', jsonb_build_object('fields', acct.signature_fields, 'image', acct.signature_image));
  end if;

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

revoke all on function jarvis_signature_text(jsonb) from public, anon;
grant execute on function jarvis_signature_text(jsonb) to authenticated, service_role;
revoke all on function email_signature_build_set(uuid, uuid, jsonb, jsonb, integer) from public, anon;
grant execute on function email_signature_build_set(uuid, uuid, jsonb, jsonb, integer) to authenticated;
revoke all on function email_signature_set(uuid, uuid, text, integer) from public, anon;
grant execute on function email_signature_set(uuid, uuid, text, integer) to authenticated;
