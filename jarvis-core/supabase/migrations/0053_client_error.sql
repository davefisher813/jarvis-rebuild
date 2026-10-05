-- Migration 0053: client crash reports get a home (2026-10-05).
--
-- api/client-error.ts has received crash reports from the app since
-- 2026-09-05 and written one console.error line per report. Vercel keeps
-- function logs for a very short time, so a crash on a tester's phone was
-- effectively lost within hours, and nobody had a place to LOOK at crashes.
-- This table is that place. The receiver (src/monitoring/receiver.ts) inserts
-- one row per report with the service key; the Admin panel's Errors section
-- (api/admin/errors.ts) reads the newest ones back, grouped by fingerprint.
--
--   fingerprint  sha-256 (hex) of name + message + first stack frame, computed
--                by the receiver, so the same bug on a hundred phones is one
--                group with a count instead of a hundred rows to read.
--   platform     web | ios | other. The receiver derives it, and an unknown
--                value is stored as other rather than refused: a crash report
--                is never worth a 4xx the client would only retry.
--   context      the report's own scrubbed context object, as sent.
--
-- Deliberately NOT stored: the caller's IP (the receiver uses it for its
-- throttle only), the user id (the receiver has no auth on purpose, because
-- the launch gate and the boot path can fail before there is a session), and
-- any query string or hash (the client never sends them).
--
-- Service role only, the same posture as feedback (0033/0035) and email_opens
-- (0017): RLS on with NO policies, and every privilege revoked from the API
-- roles. The revoke is not decoration. Supabase grants new tables in public to
-- anon and authenticated by default, and RLS with no policy denies rows but
-- leaves the table visible and its grants in place; revoking removes both.
-- service_role bypasses RLS and keeps its grant.
--
-- Retention is opportunistic and lives in the receiver (about one request in
-- 200 deletes rows older than 30 days), so no extension or cron is needed.
--
-- Forward twice is a no-op. Rollback: rollback/0053_client_error_down.sql.

create table if not exists public.client_error (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  build text,
  platform text check (platform in ('web', 'ios', 'other')),
  name text,
  message text,
  stack text,
  path text,
  user_agent text,
  context jsonb,
  fingerprint text not null
);

alter table public.client_error enable row level security;
-- No policies on purpose: service-role only.

-- The admin read takes the newest rows; retention deletes by age.
create index if not exists client_error_created_idx on public.client_error (created_at desc);
-- "How many of this one, and when did it start": grouped reads by fingerprint.
create index if not exists client_error_fingerprint_idx on public.client_error (fingerprint, created_at desc);

revoke all on table public.client_error from public, anon, authenticated;
revoke all on sequence public.client_error_id_seq from public, anon, authenticated;
