-- Email open tracking (Email 3). One row per tracked outgoing email, keyed by
-- an unguessable client-generated uuid embedded in the email's pixel URL.
-- Deliberately minimal: NO recipient address, NO subject, NO body — the row
-- cannot identify who was emailed, only that a given send was opened.
-- Writes come exclusively from the /api/open edge function using the service
-- role; clients have no direct access at all (no RLS policies = no access),
-- and read their own opens through the same function, authenticated.
create table if not exists email_opens (
  track_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now(),
  first_open timestamptz,
  open_count integer not null default 0
);

alter table email_opens enable row level security;
-- No policies on purpose: service-role only.

create index if not exists email_opens_user_idx on email_opens (user_id, sent_at desc);
