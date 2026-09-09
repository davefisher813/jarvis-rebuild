-- =====================================================================
-- JARVIS: migrations 0031 through 0036, in order, as one paste.
-- Generated 2026-09-06 from jarvis-core/supabase/migrations/.
--
-- HOW TO RUN
--   Supabase dashboard, SQL Editor, New query, paste all of this, Run.
--   Expect "Success. No rows returned."
--
-- SAFE TO RUN BEFORE YOU PUSH THE CODE, AND SAFE TO RUN TWICE.
--   Every statement is idempotent (create or replace, if not exists, or a
--   setting that is a no-op when already set). Running this against the
--   database today does not break the version of the app on your phone:
--   each one is either invisible to old code or a strictly better answer to
--   a call the old code already makes.
--
-- WHAT EACH ONE IS FOR
--   0031  a cleared field leaves no null behind in the row
--   0032  an offline edit can never overwrite a newer edit from another device
--   0033  token counts record what prompt caching saved
--   0034  a delete made on the laptop reaches the phone live
--   0035  the feedback table behind Settings, Support, Send Feedback
--   0036  Delete Account removes the five owned tables in one transaction
--
-- AFTERWARDS, one check that proves the set landed:
--   select proname from pg_proc
--    where proname in ('item_apply_patch','item_apply_patch_if_older','delete_owned');
--   Three rows.
-- =====================================================================




-- ===================================================================
-- 0031_apply_patch_strip_nulls.sql
-- ===================================================================

-- Migration 0031: item_apply_patch strips nulls after the merge.
--
-- SCHED-F-01 (2026-09-05): "Clearing a field never saves on the real
-- backend." The app now sends a cleared field as an explicit null (the only
-- value JSON can carry that means "gone"; undefined never reached the wire,
-- so `data || p_patch` never saw the key and the old value came back on the
-- next refresh). A null merged into the row is a correct clear, but it
-- leaves `"recurrence": null` sitting in data forever. jsonb_strip_nulls
-- removes every null object field after the merge, so a cleared key is
-- simply absent, the same shape a row had before the field was ever set.
-- Everything else about the function is unchanged: security invoker, RLS
-- scoped, returns whether a row the caller owns was updated (D6, D9), and
-- the trigger from 0001 still stamps the monotonic updated_at.
create or replace function item_apply_patch(p_id uuid, p_patch jsonb)
returns boolean
language plpgsql
security invoker
as $$
declare
  n int;
begin
  update item
     set data = jsonb_strip_nulls(data || p_patch)
   where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;


-- ===================================================================
-- 0032_apply_patch_if_older.sql
-- ===================================================================

-- Migration 0032: an offline edit carries its own age.
--
-- PLUMB-F-10 (2026-09-05): "a replayed offline patch overwrites a newer edit
-- made on another device." The phone is offline at 9 AM and he renames a
-- task. At noon he renames it again on the laptop. At 5 PM the phone
-- reconnects and the 9 AM name replaced the noon name, because
-- last-write-wins (D7, D10) was only ever about ARRIVAL order at the server:
-- item_apply_patch merges unconditionally, and a queued write's age was never
-- carried anywhere.
--
-- This is item_apply_patch with one extra question asked first: is the row
-- already newer than the moment this edit was made? If it is, nothing is
-- touched and the caller is told, so the app can say it kept the newer edit
-- instead of silently losing one. Live writes keep using item_apply_patch:
-- a write happening now is the newest thing there is and has nothing to
-- compare itself against.
--
-- Three answers, so "there is no such row" cannot be mistaken for "your edit
-- was too old":
--   applied  the patch landed
--   stale    the row has been changed since the edit was made
--   missing  no such row, or not this caller's (RLS, so D6 and D9 hold)
--
-- security invoker, so row-level security applies exactly as it does to
-- item_apply_patch; the trigger from 0001 still stamps the monotonic
-- updated_at, and jsonb_strip_nulls (0031) still removes a cleared key.
create or replace function item_apply_patch_if_older(p_id uuid, p_patch jsonb, p_client_at timestamptz)
returns text
language plpgsql
security invoker
as $$
declare
  cur timestamptz;
  n int;
begin
  select updated_at into cur from item where id = p_id;
  if cur is null then
    return 'missing';
  end if;
  -- Strictly newer only. A row written in the same instant is not newer, so
  -- a replay can never be refused by its own earlier attempt.
  if cur > p_client_at then
    return 'stale';
  end if;
  update item
     set data = jsonb_strip_nulls(data || p_patch)
   where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then
    return 'missing';
  end if;
  return 'applied';
end;
$$;


-- ===================================================================
-- 0033_ai_tokens_cache_counts.sql
-- ===================================================================

-- Migration 0033: what prompt caching actually saved (UP-PLAT-02,
-- 2026-09-06).
--
-- Every AI call sends the same assembled context block ahead of a few
-- hundred characters of feature-specific instruction, and paid full input
-- price for it every time. The proxy now marks that block cacheable, and
-- Anthropic bills a cache READ at 0.1x the input price with a five-minute
-- TTL and a cache WRITE at 1.25x, once.
--
-- Those two are separate counters on the upstream reply, and without them
-- input_tokens alone cannot tell a call that paid full price from a call
-- that read the whole context back for a tenth. The cost model needs both
-- to say whether caching is paying for itself, so they land in the same
-- ledger under Anthropic's own names.
--
-- Same posture as 0026: service role only, no user policies, best effort
-- from api/ai.ts. Safe to run at any time: existing rows get 0, which is
-- honest for calls made before caching existed.

alter table ai_tokens add column if not exists cache_read_input_tokens int not null default 0;
alter table ai_tokens add column if not exists cache_creation_input_tokens int not null default 0;


-- ===================================================================
-- 0034_item_replica_identity_full.sql
-- ===================================================================

-- Migration 0034: deletes made on another device arrive live too
-- (UP-PLAT-06, 2026-09-06).
--
-- The app now subscribes to postgres_changes on `item`, filtered to the
-- signed-in user's own rows, so a change made on the laptop repaints the
-- phone while both are open. Postgres sends the OLD row for a DELETE only
-- when the table's replica identity carries it; by default it carries the
-- primary key alone, and Supabase Realtime therefore cannot evaluate a
-- filter like owner_id=eq.<uid> against a delete and drops the event.
--
-- Without this, inserts and updates converge live and deletes do not: a note
-- deleted on the laptop stays on the phone's screen until the next foreground
-- or list. With it, the delete arrives with enough of the row to route.
--
-- Cost: the write-ahead log carries the whole old row for updates and deletes
-- on this table rather than just its key. `item` rows are small JSONB
-- documents, and this is the table the whole app is built on, so the trade is
-- worth it. Safe to run at any time and safe to run twice.
--
-- The subscription itself also needs `item` in the realtime publication; the
-- second statement adds it if it is not already there.

alter table item replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'item'
  ) then
    alter publication supabase_realtime add table item;
  end if;
end $$;


-- ===================================================================
-- 0035_feedback.sql
-- ===================================================================

-- Migration 0033: Send Feedback (UP-LAUNCH-16, 2026-09-05).
--
-- The only channel a TestFlight tester will actually use. One row per
-- message, written by api/feedback.ts with the service role after it has
-- verified the caller's own JWT. Deliberately NOT an item entity: this is not
-- the user's data, it is a message TO us, it must survive the account being
-- deleted (an unread bug report about the delete flow is exactly the one that
-- matters), and nothing in the app ever reads it back.
--
-- What it carries and why:
--   text     what they wrote, capped at 2 KB by the endpoint
--   build    the build stamp (__BUILD_ID__), so a report maps to a commit
--   device   the user agent string, trimmed: "it only happens on my iPad"
--   template personal | business | student, because the same screen differs
--   last_error  the newest crash from the in-memory ring, when they ticked
--            the switch. Message and stack only, already scrubbed.
--
-- There is no tier or plan column. Nothing in this app can be bought yet, and
-- a column for a tier that does not exist would be a guess baked into the
-- schema; it can be added the day there is something to put in it.
--
-- user_id does NOT cascade from auth.users, and that is the one deliberate
-- difference from every other table here: a person who deletes their account
-- after reporting a bug should not delete the bug report. It is set null
-- instead, so the message survives with no owner. api/account/delete.ts is
-- the other half of that decision and must not delete these rows.
create table if not exists feedback (
  id uuid primary key,
  user_id uuid references auth.users (id) on delete set null,
  text text not null,
  build text not null default '',
  device text not null default '',
  template text not null default '',
  last_error text,
  created_at timestamptz not null default now()
);

alter table feedback enable row level security;
-- No policies on purpose: service-role only, the same posture as email_opens
-- (0017) and ai_tokens (0026). A client can neither read nor write this table
-- directly; everything goes through the endpoint, which is where the rate
-- limit and the size cap live.

-- The admin panel reads the newest first; the rate limit counts one user's
-- rows in the last hour.
create index if not exists feedback_created_idx on feedback (created_at desc);
create index if not exists feedback_user_created_idx on feedback (user_id, created_at desc);


-- ===================================================================
-- 0036_delete_owned.sql
-- ===================================================================

-- Migration 0034: delete_owned(p_uid) (UP-LAUNCH-06, 2026-09-05).
--
-- Account deletion walked five tables with five separate REST calls, in
-- order, throwing on the first failure. That is honest but not atomic: a
-- network drop between the third and the fourth leaves an account whose
-- notes are gone and whose event log is not. The endpoint retries safely
-- (every step is idempotent), but a person who tapped Delete Account and got
-- an error has no idea which half happened.
--
-- One function, one transaction, all five tables or none of them.
--
-- SECURITY DEFINER so the function can delete past row level security, and a
-- pinned empty search_path so nothing on the caller's path can be resolved
-- instead of the intended table. EXECUTE is granted to service_role only:
-- the endpoint that calls this has already verified the caller's own JWT and
-- passes the id Supabase returned for that token, so a client can never
-- reach this with somebody else's uid. Revoking from public and authenticated
-- is the load-bearing half of that sentence.
--
-- feedback is deliberately absent: a bug report is a message to us, not the
-- user's data, and migration 0033 sets its user_id to null when the auth user
-- goes. email_opens and google_tokens are absent too, for the opposite
-- reason: both cascade from auth.users already (0017, 0018).
create or replace function delete_owned(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.item where owner_id = p_uid;
  delete from public.scalar_setting where owner_id = p_uid;
  delete from public.event_log where owner_id = p_uid;
  delete from public.ai_usage where user_id = p_uid;
  delete from public.ai_tokens where user_id = p_uid;
end;
$$;

revoke all on function delete_owned(uuid) from public;
revoke all on function delete_owned(uuid) from anon;
revoke all on function delete_owned(uuid) from authenticated;
grant execute on function delete_owned(uuid) to service_role;
