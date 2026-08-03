-- Migration 0015: the durable event log (Brain rebuild, layer 1).
-- See jarvis-app/src/events/serverSink.ts and the Brain design doc.
--
-- WHY A SEPARATE TABLE: the client loads the user's ENTIRE item table on every
-- app open (listForUser). An append-only log there would reach tens of
-- thousands of rows within a year and slow every launch forever. This table is
-- NEVER bulk-loaded by the client; reads are windowed queries and server-side
-- aggregates only.
--
-- PRIVACY: typed fields only. No free text of the user's life ever lands here;
-- the client-side sink enforces the same rule before rows leave the device.
-- Receipts join live data at display time; rows referencing deleted items
-- render as "a deleted task".
--
-- Modeled on 0012_ai_usage.sql (the existing non-item table). Idempotent:
-- IF NOT EXISTS everywhere, policies recreated. Apply in the Supabase SQL
-- editor.

create table if not exists event_log (
  id          uuid primary key,                       -- client-generated; retry-safe upserts
  owner_id    uuid not null default auth.uid(),
  type        text not null,                          -- e.g. task.completed, plan.picked
  entity_type text,                                   -- e.g. task, event, note
  entity_id   text,                                   -- id only, never content
  at          timestamptz not null,                   -- when it happened (client clock)
  day         date not null,                          -- LOCAL date at capture (derivations key on this)
  h           smallint not null,                      -- local hour 0-23
  dow         smallint not null,                      -- local day of week 0-6
  category    text,                                   -- category id ('' if none)
  n           smallint,                               -- generic small number (e.g. plan pick position 1-3)
  flag        boolean,                                -- generic boolean (e.g. plan outcome done-same-day)
  kind        text,                                   -- suggestion channel: ai | pattern | first_step | link
  src         text not null default 'live',           -- 'live' | 'import' (Time Sense backfill)
  created_at  timestamptz not null default now()
);

-- Derivations read per-user windows by day; this serves them.
create index if not exists event_log_owner_day on event_log (owner_id, day desc);

alter table event_log enable row level security;

-- Users append their own rows. with check pins owner_id to the caller.
drop policy if exists event_log_insert_own on event_log;
create policy event_log_insert_own on event_log
  for insert to authenticated
  with check (owner_id = auth.uid());

-- Users read only their own rows (windowed queries from the client;
-- aggregates run with the service role, which bypasses RLS).
drop policy if exists event_log_select_own on event_log;
create policy event_log_select_own on event_log
  for select to authenticated
  using (owner_id = auth.uid());

-- "Delete my data" must be a real button: users may delete their own rows.
-- No update policy: the log is append-only from the client's perspective.
drop policy if exists event_log_delete_own on event_log;
create policy event_log_delete_own on event_log
  for delete to authenticated
  using (owner_id = auth.uid());

-- RETENTION (documented intent; enforced later, before multi-tenant scale):
-- raw rows roll up into per-day aggregates and old raw rows are pruned by a
-- service-role job. The client never depends on unbounded history.
