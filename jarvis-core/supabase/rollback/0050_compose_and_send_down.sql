-- Rollback for 0050 (compose, replies and the exact send).
-- Not a migration: lives outside supabase/migrations so nothing applies it by
-- accident. Removes the draft and send functions, puts 0048's body store and
-- message read back (without the reply headers), and drops the headers
-- column. Draft rows are 0044's and stay; a draft marked sent stays sent.

drop function if exists outbox_claim_action(text, uuid, interval);
drop function if exists draft_outcome(uuid, text, text);
drop function if exists send_approve(uuid, text, text, text);
drop function if exists send_review(uuid, integer);
drop function if exists draft_discard(uuid);
drop function if exists draft_list();
drop function if exists draft_get(uuid);
drop function if exists draft_save(uuid, uuid, jsonb, integer);
drop function if exists jarvis_draft_json(email_draft);
drop function if exists jarvis_draft_fields_bad(jsonb);
drop function if exists jarvis_address_norm(text);
drop function if exists jarvis_address_ok(text);

drop function if exists email_body_store(uuid, uuid, text, text, jsonb, jsonb);
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
revoke all on function email_body_store(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function email_body_store(uuid, uuid, text, text, jsonb) to service_role;

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

alter table email_message_body drop column if exists reply_headers;
