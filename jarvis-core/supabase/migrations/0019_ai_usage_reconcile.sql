-- Migration 0019: reconcile ai_usage with the corrections pack spec
-- (2026-08-14 session, corrections item 5; the pack numbered this 0015 but
-- 0015-0018 were already taken in this repo, so it lands as 0019).
--
-- What the pack asked for vs what 0012 built:
--   1. Usage detail columns (kind, input_bytes, output_tokens) so What Ran
--      and the admin dashboard can show more than a bare call count.
--      0012 had only id/user_id/created_at. Added here, idempotently.
--      DEVIATION from the pack text: kind gets a default of '' because
--      ai_try_consume (0013) inserts only user_id; a no-default not null
--      column would break every admission the moment this runs.
--   2. The ai_usage_time index for global daily counting. 0012 only had the
--      (user_id, created_at) index. Added here.
--   3. Service-role only: NO user policies, matching the email_opens pattern.
--      0012 created insert-own/select-own policies for the legacy client-token
--      logging path in api/ai.ts. That path is retired in the same commit as
--      this migration (the fallback now logs with the service role), so the
--      policies drop here. The proxy writes via ai_try_consume, which is
--      security definer and needs no policy.
--
-- The live table was created by hand before 0012 existed, so its real shape
-- may drift from the repo. Everything here is idempotent (if not exists /
-- drop if exists), which absorbs the known drift. After running, confirm in
-- the dashboard that ai_usage has: id, user_id, created_at, kind,
-- input_bytes, output_tokens, and zero policies.

alter table ai_usage add column if not exists kind text not null default '';
alter table ai_usage add column if not exists input_bytes integer not null default 0;
alter table ai_usage add column if not exists output_tokens integer not null default 0;

create index if not exists ai_usage_user_time on ai_usage (user_id, created_at desc);
create index if not exists ai_usage_time on ai_usage (created_at desc);

alter table ai_usage enable row level security;

-- Service-role only from here on: no user may read or write usage rows
-- directly. The proxy records through ai_try_consume; admin endpoints read
-- with the service role, which bypasses RLS.
drop policy if exists ai_usage_insert_own on ai_usage;
drop policy if exists ai_usage_select_own on ai_usage;
