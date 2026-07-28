-- Migration 0012: track the ai_usage table that backs the AI proxy's rate
-- limiting and the admin usage dashboard.
--
-- HISTORY: this table was originally created by hand in the Supabase dashboard
-- and never captured in a migration, so its RLS was unverified and a fresh
-- environment could not be rebuilt from the repo. This migration makes it
-- reproducible and locks down its policies.
--
-- Shape matches what api/ai.ts writes (an empty POST with the caller's token,
-- so user_id fills from auth.uid()) and what the proxy/admin endpoints read
-- (count by user_id and created_at using the service role, which bypasses RLS).
--
-- Safe to run on a project where the table already exists: uses IF NOT EXISTS
-- and recreates policies idempotently.

create table if not exists ai_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Count queries filter by user and time; this index serves both.
create index if not exists ai_usage_user_time on ai_usage (user_id, created_at desc);

alter table ai_usage enable row level security;

-- A signed-in user may log their OWN usage rows (the proxy posts with the
-- user's token). with check pins user_id to the caller, so nobody can log
-- usage as someone else.
drop policy if exists ai_usage_insert_own on ai_usage;
create policy ai_usage_insert_own on ai_usage
  for insert to authenticated
  with check (user_id = auth.uid());

-- Users may read only their own usage. Admin/global counting is done with the
-- service role, which bypasses RLS, so no broad read policy is needed.
drop policy if exists ai_usage_select_own on ai_usage;
create policy ai_usage_select_own on ai_usage
  for select to authenticated
  using (user_id = auth.uid());

-- No update/delete policies: usage rows are append-only from the client's
-- perspective. (Service role can still prune old rows for retention.)
