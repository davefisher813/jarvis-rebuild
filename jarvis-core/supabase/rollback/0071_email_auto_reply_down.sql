-- Rollback for 0071 (an automatic reply is not a New Reply).
-- Not a migration: lives outside supabase/migrations so nothing applies it by accident.
-- email_sync_apply goes back to 0067's body and threads_latest to 0051's; the auto_reply column goes. No message is
-- removed: the column holds a fact read from headers Gmail still has, and the next sync after a re-apply refills it.

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
                               has_body, attachment_metadata, provider_labels, provider_revision, source_hash, deleted_at,
                               rfc_message_id, list_id, list_unsubscribe, mime_type, content_class)
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
            null,
            nullif(left(m ->> 'rfc_message_id', 998), ''), nullif(left(m ->> 'list_id', 998), ''), nullif(left(m ->> 'list_unsubscribe', 2000), ''),
            nullif(left(m ->> 'mime_type', 200), ''), nullif(left(m ->> 'content_class', 200), ''))
    on conflict (account_id, provider_id) do update
      set thread_id = excluded.thread_id, internal_date = excluded.internal_date, from_address = excluded.from_address, from_name = excluded.from_name,
          to_addresses = excluded.to_addresses, cc_addresses = excluded.cc_addresses, subject = excluded.subject, snippet = excluded.snippet,
          -- A metadata read carries no parts, so it never clears what an open stored (email_body_store).
          attachment_metadata = case when jsonb_array_length(excluded.attachment_metadata) > 0 then excluded.attachment_metadata else email_message.attachment_metadata end,
          provider_labels = excluded.provider_labels, provider_revision = excluded.provider_revision,
          source_hash = excluded.source_hash, deleted_at = null,
          rfc_message_id = coalesce(excluded.rfc_message_id, email_message.rfc_message_id),
          list_id = excluded.list_id, list_unsubscribe = excluded.list_unsubscribe,
          mime_type = coalesce(excluded.mime_type, email_message.mime_type), content_class = excluded.content_class;
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

create or replace function threads_latest(p_threads text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(t.thread_id, jsonb_build_object(
           'message_id', t.id, 'internal_date', t.internal_date, 'from_address', t.from_address, 'from_name', t.from_name, 'subject', t.subject, 'account_id', t.account_id)), '{}'::jsonb)
  from (
    select distinct on (m.thread_id) m.thread_id, m.id, m.internal_date, m.from_address, m.from_name, m.subject, m.account_id
      from email_message m
     where m.owner_id = auth.uid() and m.deleted_at is null and m.thread_id = any (coalesce(p_threads, '{}'::text[]))
     order by m.thread_id, m.internal_date desc, m.provider_id desc
  ) t;
$$;

revoke all on function email_sync_apply(uuid, uuid, jsonb, text[], text, boolean) from public, anon, authenticated;
revoke all on function threads_latest(text[]) from public, anon;
grant execute on function email_sync_apply(uuid, uuid, jsonb, text[], text, boolean) to service_role;
grant execute on function threads_latest(text[]) to authenticated;

alter table email_message drop column if exists auto_reply;
