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
