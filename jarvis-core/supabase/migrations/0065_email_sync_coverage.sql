-- Migration 0065: the coverage crawl (Email v1 spec 2026-10-08, sections 8.1 and 8.3; AC39, AC40).
-- Additive; rollback in rollback/0065_email_sync_coverage_down.sql.
--
-- What was wrong: a first sync (or one after Gmail's history expired) listed ONE page of 30 INBOX
-- messages and advanced last_sync_at, so the header claimed freshness for a mailbox it had barely
-- read. The spec: "Connected does not mean Current. Sync current means verified through
-- verified_through_at for an explicit coverage window, not all mail forever."
--
-- What this adds, so the server (api/email/sync.ts) can say the truth:
--
--   sync_state           the sync dimension (8.1). This file writes only 'catching_up' and 'current'.
--   coverage_start       the window's start: the crawl lists Inbox and Sent from here (now() - 90 days).
--   verified_through_at  when the window was last fully listed AND reconciled through Gmail's history.
--   sync_epoch           bumped on every crawl start; a page from an older crawl is refused.
--   coverage_crawl       the crawl in progress (null when none): the history checkpoint taken at its
--                        START, and per label the next page token, whether it is done, and how many it listed.
--
-- THE SCHEMA TRAP (read before editing). Production's email_account already carries sync_state,
-- coverage_start and verified_through_at (and auth_state, send_health, heartbeat_at, paused_at,
-- removed_at) from a production-only migration that is not in this repo ("0055_email_connection_truth").
-- Nothing wrote them before this file. Every column here is therefore `add column if not exists`, a
-- no-op where production already has it, and nothing here adds or changes a check constraint or a
-- default on a column production may already own. Live, sync_state defaults to 'catching_up'; here,
-- on a fresh chain, to 'not_started'. The functions below never assume either default: they decide
-- from coverage_crawl and verified_through_at, which only they write. The two values they write are
-- both in the spec's set (not_started, syncing, current, catching_up, stale, failed, paused), so a
-- production check constraint over that set accepts them.
--
-- The rules the functions hold, so no caller can get them wrong:
--   - a crawl page commits its messages AND its progress in one transaction, or neither (8.3: "Persist
--     ... pagination progress ... only after page changes are durable");
--   - a page is accepted only for the current epoch and only for the page token the crawl expects, so a
--     retried or racing page cannot skip or double-advance (stable identity keys; email_message is keyed
--     on (account_id, provider_id), so a repeat is an update, never a duplicate);
--   - a crawl page never advances freshness (last_sync_at) and never moves the cursor;
--   - 'current' is written only by email_coverage_complete (every label listed, the history checkpoint
--     taken at the crawl's start reconciled, the new cursor given) or by email_coverage_checked on a
--     mailbox that has been verified before and has no crawl open;
--   - nothing here deletes a message, a draft or a saved record (8.3: "preserving drafts and saved records").

alter table email_account add column if not exists sync_state text not null default 'not_started';
alter table email_account add column if not exists coverage_start timestamptz;
alter table email_account add column if not exists verified_through_at timestamptz;
alter table email_account add column if not exists sync_epoch integer not null default 0;
alter table email_account add column if not exists coverage_crawl jsonb;

-- The account's sync facts as the server reads them before deciding what a sync call does.
create or replace function jarvis_coverage_json(a email_account)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'account_id', a.id, 'sync_state', a.sync_state, 'sync_epoch', a.sync_epoch, 'coverage_start', a.coverage_start,
    'verified_through_at', a.verified_through_at, 'last_sync_at', a.last_sync_at, 'cursor', a.cursor, 'crawl', a.coverage_crawl);
$$;

create or replace function email_coverage_state(p_owner uuid, p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a email_account%rowtype;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into a from email_account where id = p_account and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jarvis_coverage_json(a);
end;
$$;

-- Start (or restart) the crawl: a first sync, Gmail's history expired, or a page token Gmail no longer
-- takes. The history checkpoint is the mailbox's own clock read BEFORE the first page is listed, so
-- whatever changes while the crawl runs is reconciled from it before the mailbox is called current.
-- A restart keeps every cached message: the upserts are idempotent and nothing is deleted.
create or replace function email_coverage_begin(p_owner uuid, p_account uuid, p_history_id text, p_labels text[] default array['INBOX', 'SENT'], p_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a email_account%rowtype;
  lbl text;
  labels jsonb := '{}'::jsonb;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if coalesce(length(p_history_id), 0) = 0 or length(p_history_id) > 64 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'history_id'); end if;
  if p_labels is null or cardinality(p_labels) = 0 or exists (select 1 from unnest(p_labels) l where l not in ('INBOX', 'SENT')) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'labels'); end if;
  if p_days is null or p_days < 1 or p_days > 365 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'days'); end if;
  foreach lbl in array p_labels loop
    labels := labels || jsonb_build_object(lbl, jsonb_build_object('next', null, 'done', false, 'listed', 0));
  end loop;
  update email_account
     set sync_state = 'catching_up', sync_epoch = sync_epoch + 1, coverage_start = now() - make_interval(days => p_days),
         coverage_crawl = jsonb_build_object('epoch', sync_epoch + 1, 'history_id', p_history_id, 'order', to_jsonb(p_labels), 'labels', labels, 'started_at', now())
   where id = p_account and owner_id = p_owner
  returning * into a;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jarvis_coverage_json(a);
end;
$$;

-- One crawl page, applied with its progress in the same transaction. p_page is the token the page was
-- listed WITH (null for a label's first page); p_next is the token Gmail gave for the page after it
-- (null: the label is fully listed). Freshness and the cursor do not move.
create or replace function email_coverage_page(p_owner uuid, p_account uuid, p_epoch integer, p_label text, p_page text, p_next text, p_messages jsonb, p_removed text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a email_account%rowtype;
  lp jsonb;
  applied jsonb;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_messages, '[]'::jsonb)) <> 'array' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'messages'); end if;
  if length(coalesce(p_next, '')) > 512 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'next'); end if;
  select * into a from email_account where id = p_account and owner_id = p_owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  lp := a.coverage_crawl -> 'labels' -> p_label;
  -- A page from another crawl, for a label this crawl does not cover, for a label already listed, or
  -- listed from a token the crawl is no longer waiting on, is refused whole: nothing is written.
  if a.coverage_crawl is null or a.sync_epoch <> p_epoch or lp is null or (lp ->> 'done')::boolean
     or (lp ->> 'next') is distinct from p_page then
    return jsonb_build_object('error', 'STALE_PAGE', 'state', jarvis_coverage_json(a));
  end if;
  applied := email_sync_apply(p_owner, p_account, coalesce(p_messages, '[]'::jsonb), coalesce(p_removed, '{}'), null, false);
  if applied ? 'error' then return applied; end if;
  update email_account
     set coverage_crawl = jsonb_set(coverage_crawl, array['labels', p_label],
           jsonb_build_object('next', p_next, 'done', p_next is null, 'listed', coalesce((lp ->> 'listed')::integer, 0) + jsonb_array_length(coalesce(p_messages, '[]'::jsonb))))
   where id = p_account
  returning * into a;
  return jsonb_build_object('upserted', applied -> 'upserted', 'removed', applied -> 'removed', 'state', jarvis_coverage_json(a));
end;
$$;

-- The crawl is done: every label listed, and the changes Gmail recorded since the crawl's history
-- checkpoint (p_messages, p_removed) applied. Only now does the mailbox become current: the cursor
-- moves to p_cursor, freshness advances, verified_through_at is stamped, the crawl is closed.
create or replace function email_coverage_complete(p_owner uuid, p_account uuid, p_epoch integer, p_messages jsonb, p_removed text[], p_cursor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a email_account%rowtype;
  applied jsonb;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if coalesce(length(p_cursor), 0) = 0 or length(p_cursor) > 64 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'cursor'); end if;
  select * into a from email_account where id = p_account and owner_id = p_owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if a.coverage_crawl is null or a.sync_epoch <> p_epoch then return jsonb_build_object('error', 'STALE_PAGE', 'state', jarvis_coverage_json(a)); end if;
  if exists (select 1 from jsonb_each(coalesce(a.coverage_crawl -> 'labels', '{}'::jsonb)) l where not coalesce((l.value ->> 'done')::boolean, false)) then
    return jsonb_build_object('error', 'NOT_LISTED', 'state', jarvis_coverage_json(a));
  end if;
  applied := email_sync_apply(p_owner, p_account, coalesce(p_messages, '[]'::jsonb), coalesce(p_removed, '{}'), p_cursor, true);
  if applied ? 'error' then return applied; end if;
  update email_account set sync_state = 'current', verified_through_at = now(), coverage_crawl = null where id = p_account
  returning * into a;
  return jsonb_build_object('upserted', applied -> 'upserted', 'removed', applied -> 'removed', 'last_sync_at', a.last_sync_at, 'state', jarvis_coverage_json(a));
end;
$$;

-- A refresh from the cursor on a mailbox verified before and with no crawl open. p_complete: Gmail's
-- history was read to its end and the cursor moved (current, verified now); false: the read was cut
-- at its page bound and the cursor stayed (catching up, verified_through_at unchanged).
create or replace function email_coverage_checked(p_owner uuid, p_account uuid, p_epoch integer, p_complete boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a email_account%rowtype;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into a from email_account where id = p_account and owner_id = p_owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if a.coverage_crawl is not null or a.sync_epoch <> p_epoch then return jsonb_build_object('error', 'STALE_PAGE', 'state', jarvis_coverage_json(a)); end if;
  if a.verified_through_at is null then return jsonb_build_object('error', 'NOT_LISTED', 'state', jarvis_coverage_json(a)); end if;
  update email_account
     set sync_state = case when coalesce(p_complete, false) then 'current' else 'catching_up' end,
         verified_through_at = case when coalesce(p_complete, false) then now() else verified_through_at end
   where id = p_account
  returning * into a;
  return jsonb_build_object('state', jarvis_coverage_json(a));
end;
$$;

-- ---- email_accounts(): the sync facts ride with the rest (0063's body plus three keys) ----
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

revoke all on function jarvis_coverage_json(email_account) from public, anon, authenticated;
revoke all on function email_coverage_state(uuid, uuid) from public, anon, authenticated;
revoke all on function email_coverage_begin(uuid, uuid, text, text[], integer) from public, anon, authenticated;
revoke all on function email_coverage_page(uuid, uuid, integer, text, text, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function email_coverage_complete(uuid, uuid, integer, jsonb, text[], text) from public, anon, authenticated;
revoke all on function email_coverage_checked(uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function jarvis_coverage_json(email_account) to service_role;
grant execute on function email_coverage_state(uuid, uuid) to service_role;
grant execute on function email_coverage_begin(uuid, uuid, text, text[], integer) to service_role;
grant execute on function email_coverage_page(uuid, uuid, integer, text, text, text, jsonb, text[]) to service_role;
grant execute on function email_coverage_complete(uuid, uuid, integer, jsonb, text[], text) to service_role;
grant execute on function email_coverage_checked(uuid, uuid, integer, boolean) to service_role;
