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
