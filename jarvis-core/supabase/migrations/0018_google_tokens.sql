-- Persistent Google sign-in (2026-08-04). One row per (user, Google account):
-- the ENCRYPTED refresh token that lets the server mint fresh access tokens,
-- so the app stays signed in across opens with no popup.
-- Access is service-role only (RLS enabled, no policies): clients never see
-- refresh tokens in any form; they receive short-lived access tokens from the
-- /api/google function. token_enc is AES-GCM ciphertext, keyed by
-- GOOGLE_TOKEN_KEY held only in the server's environment: a database dump
-- alone cannot recover tokens.
create table if not exists google_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  token_enc text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, email)
);

alter table google_tokens enable row level security;
-- No policies on purpose: service-role only.
