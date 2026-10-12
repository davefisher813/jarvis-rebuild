-- Rollback for 0067 (the mail home's facts).
-- Not a migration: lives outside supabase/migrations so nothing applies it by accident.
-- email_sync_apply and email_inbox go back to 0048's bodies and email_body_store to 0050's; the
-- thread index and the five fact columns go. No message, body, draft or saved record is removed:
-- the columns hold copies of headers Gmail still has, and the next sync after a re-apply refills them.

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

drop index if exists email_message_account_thread_idx;
alter table email_message drop column if exists content_class;
alter table email_message drop column if exists mime_type;
alter table email_message drop column if exists list_unsubscribe;
alter table email_message drop column if exists list_id;
alter table email_message drop column if exists rfc_message_id;
