-- Migration 0058: the server's record of a reconnect attempt (Foundation Fix
-- Spec 4, 2026-10-07). Additive; rollback in rollback/0058_google_reconnect_attempt_down.sql.
--
-- A reconnect used to be whatever the browser said it was: the popup closed,
-- the app assumed. Now the SERVER owns the attempt. When Dave taps Reconnect,
-- api/google.ts writes a row here (which account, whose request, when it
-- expires, a nonce) and hands back an OAuth `state` that names that row. The
-- callback is verified against it BEFORE any code is exchanged, the row moves
-- through its states as the six checks run, and a killed app can ask the
-- server on reopen what became of the attempt instead of guessing.
--
--   one open attempt per (user, account): a new tap supersedes the old one, so
--   there is exactly one live link per account per incident and an old link
--   can never complete a newer attempt (single use is the partial unique index
--   plus the compare-and-set in api/google.ts).
--   expires_at is at most ten minutes after created_at (a check constraint).
--   outcome holds codes, an address and a provider reason. Never a token,
--   a code, or any mail.
--
-- Service role only, the same posture as client_error (0053) and google_tokens
-- (0057): RLS on with no policies, every API-role privilege revoked. The code
-- degrades without this table: the state is signed, so it still verifies and
-- still expires, it is just not single-use and its progress is not recorded.
create table if not exists public.google_reconnect_attempt (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text not null check (email = lower(email)),
  nonce text not null,
  status text not null default 'started'
    check (status in ('started', 'verified', 'wrong_account', 'needs_step', 'scope_missing', 'unverified', 'denied', 'cancelled', 'expired', 'superseded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  outcome jsonb,
  constraint google_reconnect_ttl check (expires_at <= created_at + interval '10 minutes')
);
create unique index if not exists google_reconnect_one_open_idx on public.google_reconnect_attempt (user_id, email) where status = 'started';
create index if not exists google_reconnect_user_idx on public.google_reconnect_attempt (user_id, email, created_at desc);

alter table public.google_reconnect_attempt enable row level security;
revoke all on table public.google_reconnect_attempt from public, anon, authenticated;
