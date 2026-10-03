-- 0051: WAITING AND THE RESTRAINED TODAY FEED (docs/jarvis-unified, slice 08;
-- IMPLEMENTATION-SPEC.md 08 E12 to E15, 09 M4 and T1, 12, 13).
--
-- Additive. Three doors on a Waiting record and four reads:
--
--  1. waiting_resolve, waiting_reopen, waiting_follow_up: one item write and
--     one receipt in one transaction, as the person. Resolve means the person
--     says it arrived or stopped mattering (a note optional); Reopen reverses
--     it; a follow-up date is tracker metadata on the record, never a task
--     and never an event. A second tap is the same answer; an item that moved
--     under the person is DESTINATION_CHANGED; nothing here sends mail.
--  2. thread_messages (the source message and every cached message in its
--     thread, for the evidence, Open in Gmail and the follow-up's real
--     address), threads_latest (the newest cached message per thread, so a
--     reply can say New Reply and never close anything), evidence_read (the
--     excerpt a record was tracked from, with its availability), and
--     candidate_review_count (the one number Today may say: actionable cards
--     in the mailboxes that are still here, counted per card, never a title
--     or an amount).

-- ---------------------------------------------------------------------------
-- 1. The Waiting doors.
-- ---------------------------------------------------------------------------

-- The common write: lock the record, check it has not moved, apply the
-- patch, record the action and its receipt. Called only by the three doors.
create or replace function jarvis_waiting_write(p_item uuid, p_patch jsonb, p_drop text[], p_kind text, p_verb text, p_diff jsonb, p_idempotency_key text, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  it item%rowtype;
  a action%rowtype;
  new_data jsonb;
  new_upd timestamptz;
  k text;
  act uuid;
  rid uuid;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into it from item where id = p_item and owner_id = owner and entity_type = 'waiting' for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if p_expected_updated_at is not null and it.updated_at <> p_expected_updated_at then
    return jsonb_build_object('error', 'DESTINATION_CHANGED', 'item_updated_at', it.updated_at);
  end if;
  if p_idempotency_key is not null then
    select * into a from action where owner_id = owner and idempotency_key = p_idempotency_key;
    if found then return jarvis_action_replay(a) || jsonb_build_object('item_id', it.id, 'data', it.data, 'item_updated_at', it.updated_at); end if;
  end if;
  new_data := it.data || coalesce(p_patch, '{}'::jsonb);
  if p_drop is not null then
    foreach k in array p_drop loop new_data := new_data - k; end loop;
  end if;
  update item set data = new_data where id = it.id returning updated_at into new_upd;
  insert into action (owner_id, kind, actor_kind, initiated_by_user_id, verb, surface, state, payload_hash, idempotency_key, destination_id, authorization_snapshot)
  values (owner, p_kind, 'user', owner, left(p_verb, 200), 'email', 'confirmed',
          encode(sha256(convert_to(new_data::text, 'UTF8')), 'hex'),
          coalesce(p_idempotency_key, p_kind || ':' || it.id::text || ':' || clock_timestamp()::text),
          it.id, jsonb_build_object('approved_by', owner, 'at', now()))
  returning id into act;
  rid := jarvis_receipt_append(owner, act, 'confirmed', left(p_verb, 200), 'user', null, 'Waiting', 'verified_jarvis', '{}', it.id, it.id, coalesce(p_diff, '[]'::jsonb));
  return jsonb_build_object('action_id', act, 'receipt_id', rid, 'item_id', it.id, 'item_updated_at', new_upd, 'data', new_data, 'state', 'confirmed', 'safe_message', left(p_verb, 200));
end;
$$;

-- The person says it arrived, or stopped mattering. The note is optional and
-- rides on the record. Resolving a resolved record is the same answer.
create or replace function waiting_resolve(p_item uuid, p_note text default null, p_idempotency_key text default null, p_expected_updated_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  it item%rowtype;
  patch jsonb;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into it from item where id = p_item and owner_id = owner and entity_type = 'waiting';
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if it.data ->> 'status' = 'resolved' then
    return jsonb_build_object('item_id', it.id, 'status', 'resolved', 'replay', true, 'item_updated_at', it.updated_at, 'data', it.data,
                              'action_id', (select id from action where owner_id = owner and destination_id = it.id and kind = 'waiting_resolve' order by created_at desc limit 1));
  end if;
  patch := jsonb_build_object('status', 'resolved', 'resolvedAt', now());
  if length(btrim(coalesce(p_note, ''))) > 0 then patch := patch || jsonb_build_object('resolutionNote', left(btrim(p_note), 2000)); end if;
  return jarvis_waiting_write(p_item, patch, null, 'waiting_resolve',
    'Resolved · ' || coalesce(nullif(it.data ->> 'title', ''), 'Waiting'),
    jsonb_build_array(jsonb_build_object('field', 'status', 'before', coalesce(it.data ->> 'status', 'open'), 'after', 'resolved')),
    p_idempotency_key, p_expected_updated_at);
end;
$$;

-- Back to open: the note and the resolved time go, nothing else changes.
create or replace function waiting_reopen(p_item uuid, p_idempotency_key text default null, p_expected_updated_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  it item%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into it from item where id = p_item and owner_id = owner and entity_type = 'waiting';
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if coalesce(it.data ->> 'status', 'open') = 'open' then
    return jsonb_build_object('item_id', it.id, 'status', 'open', 'replay', true, 'item_updated_at', it.updated_at, 'data', it.data,
                              'action_id', (select id from action where owner_id = owner and destination_id = it.id and kind = 'waiting_reopen' order by created_at desc limit 1));
  end if;
  return jarvis_waiting_write(p_item, jsonb_build_object('status', 'open'), array['resolvedAt', 'resolutionNote'], 'waiting_reopen',
    'Reopened · ' || coalesce(nullif(it.data ->> 'title', ''), 'Waiting'),
    jsonb_build_array(jsonb_build_object('field', 'status', 'before', it.data ->> 'status', 'after', 'open')),
    p_idempotency_key, p_expected_updated_at);
end;
$$;

-- A local follow-up date on the record, or none. It is a date the tracker
-- shows, not a deadline: no task and no event is made here, by construction.
create or replace function waiting_follow_up(p_item uuid, p_date date default null, p_idempotency_key text default null, p_expected_updated_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  it item%rowtype;
  before_on text;
  after_on text := case when p_date is null then null else to_char(p_date, 'YYYY-MM-DD') end;
  title text;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into it from item where id = p_item and owner_id = owner and entity_type = 'waiting';
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  before_on := it.data ->> 'followUpOn';
  if before_on is not distinct from after_on then return jsonb_build_object('item_id', it.id, 'follow_up_on', after_on, 'replay', true, 'item_updated_at', it.updated_at, 'data', it.data); end if;
  title := coalesce(nullif(it.data ->> 'title', ''), 'Waiting');
  if p_date is null then
    return jarvis_waiting_write(p_item, '{}'::jsonb, array['followUpOn'], 'waiting_follow_up', 'Follow Up Cleared · ' || title,
      jsonb_build_array(jsonb_build_object('field', 'followUpOn', 'before', before_on, 'after', null)), p_idempotency_key, p_expected_updated_at);
  end if;
  return jarvis_waiting_write(p_item, jsonb_build_object('followUpOn', after_on), null, 'waiting_follow_up',
    'Follow Up ' || trim(to_char(p_date, 'Mon FMDD')) || ' · ' || title,
    jsonb_build_array(jsonb_build_object('field', 'followUpOn', 'before', before_on, 'after', after_on)), p_idempotency_key, p_expected_updated_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The reads.
-- ---------------------------------------------------------------------------

-- Every cached message of one thread, newest first, with the Reply-To the
-- body kept: the source a record was tracked from, the replies since, and
-- the real addresses a follow-up may be sent to.
create or replace function thread_messages(p_thread text, p_account uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.internal_date desc, t.provider_id desc), '[]'::jsonb)
  from (
    select m.id, m.account_id, a.address as account, m.provider_id, m.thread_id, m.internal_date, m.from_address, m.from_name,
           m.to_addresses, m.cc_addresses, m.subject, m.snippet, m.has_body, (m.deleted_at is not null) as deleted, m.source_hash,
           coalesce(b.reply_headers ->> 'reply_to', '') as reply_to,
           coalesce(b.reply_headers ->> 'message_id', '') as message_id_header,
           case when jsonb_typeof(b.reply_headers -> 'references') = 'array' then b.reply_headers -> 'references' else '[]'::jsonb end as references
      from email_message m
      join email_account a on a.id = m.account_id
      left join email_message_body b on b.message_id = m.id
     where m.owner_id = auth.uid() and p_thread is not null and m.thread_id = p_thread
       and (p_account is null or m.account_id = p_account)
     order by m.internal_date desc, m.provider_id desc
     limit 50
  ) t;
$$;

-- The newest cached message per thread that is still there, so a tracker
-- can say New Reply without ever resolving anything.
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

-- The excerpt a record was tracked from, and whether its source is still
-- there. The excerpt is the person's own copy; a deleted source keeps it.
create or replace function evidence_read(p_evidence uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  e source_evidence%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into e from source_evidence where id = p_evidence and owner_id = owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jsonb_build_object('id', e.id, 'type', e.type, 'account_id', e.account_id, 'message_id', e.message_id, 'provider_message_id', e.provider_message_id, 'thread_id', e.thread_id,
                            'excerpt', e.excerpt, 'captured_at', e.captured_at, 'source_timezone', e.source_timezone,
                            'availability', case when e.message_id is not null and exists (select 1 from email_message m where m.id = e.message_id and m.deleted_at is not null) then 'deleted' else e.availability end);
end;
$$;

-- The one number Today may carry for Email (12, T1): cards still waiting
-- for the person (proposed or needing details) on messages that are still
-- here, in mailboxes that are connected or merely need reconnecting. Counted
-- per card, never per message; dismissed, saved and stale cards are not
-- counted; no title and no amount leaves Email through this.
create or replace function candidate_review_count()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'messages', count(distinct c.message_id))
  from email_candidate c
  join email_message m on m.id = c.message_id
  join email_account a on a.id = m.account_id
  where c.owner_id = auth.uid() and c.status in ('proposed', 'needs_details') and m.deleted_at is null and a.state <> 'disconnected';
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants.
-- ---------------------------------------------------------------------------
revoke all on function jarvis_waiting_write(uuid, jsonb, text[], text, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function waiting_resolve(uuid, text, text, timestamptz) from public, anon;
revoke all on function waiting_reopen(uuid, text, timestamptz) from public, anon;
revoke all on function waiting_follow_up(uuid, date, text, timestamptz) from public, anon;
revoke all on function thread_messages(text, uuid) from public, anon;
revoke all on function threads_latest(text[]) from public, anon;
revoke all on function evidence_read(uuid) from public, anon;
revoke all on function candidate_review_count() from public, anon;
grant execute on function waiting_resolve(uuid, text, text, timestamptz) to authenticated;
grant execute on function waiting_reopen(uuid, text, timestamptz) to authenticated;
grant execute on function waiting_follow_up(uuid, date, text, timestamptz) to authenticated;
grant execute on function thread_messages(text, uuid) to authenticated;
grant execute on function threads_latest(text[]) to authenticated;
grant execute on function evidence_read(uuid) to authenticated;
grant execute on function candidate_review_count() to authenticated;
