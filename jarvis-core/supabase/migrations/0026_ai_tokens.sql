-- Migration 0026: measured token accounting (queue item 12, AI Quality +
-- Cost Pack).
--
-- ai_usage stays what it is: the ADMISSION ledger, written before the
-- upstream call so the caps count attempts exactly. Tokens cannot live there
-- because token counts only exist AFTER the upstream reply, and updating the
-- admission row would mean threading its id through the proxy and racing the
-- reply against the caps. Separate concerns, separate table:
--
--   ai_usage   one row per admitted attempt, BEFORE the call  -> rate limits
--   ai_tokens  one row per completed call, AFTER the reply    -> cost model
--
-- Written only by the server (service role) from api/ai.ts, best effort: a
-- failed accounting write never blocks a served reply. No user policies at
-- all, same posture as ai_usage since 0021: clients cannot read or write
-- accounting.

create table if not exists ai_tokens (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null default '',
  model text not null default '',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);

-- The cost model reads by time window, then slices by kind and user.
create index if not exists ai_tokens_created_at_idx on ai_tokens (created_at);
create index if not exists ai_tokens_user_created_idx on ai_tokens (user_id, created_at);

alter table ai_tokens enable row level security;
-- No policies on purpose: service role bypasses RLS; everyone else is locked out.
