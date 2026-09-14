-- Track 3, migration 0004: connections (build master section 5). NOT
-- org-scoped like every other table here, on purpose: a connection links two
-- Clerk users who may sit in two different Personal orgs. The policies check
-- the two user id columns, never current_org_id(). Anyone "fixing" this into
-- an org_id column breaks cross-org connections; that is the whole point.
--
-- The two canonicalized partial unique indexes close the crossed-request
-- race (A asks B while B asks A, or two taps at once): at most one pending
-- and one accepted row per pair, whichever way round.

create table connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null,
  recipient_id uuid not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester_id <> recipient_id)
);

create unique index connections_no_duplicate_pending
  on connections (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where status = 'pending';

create unique index connections_no_duplicate_accepted
  on connections (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where status = 'accepted';

alter table connections enable row level security;
create policy "party can read" on connections for select
  using (requester_id = auth.uid() or recipient_id = auth.uid());
create policy "requester can write" on connections for insert
  with check (requester_id = auth.uid());
create policy "party can update" on connections for update
  using (requester_id = auth.uid() or recipient_id = auth.uid());

-- Reserved now, wired later: every future scope is a new row here and a new
-- reader, never a new table. On accept the app inserts
-- scope_key = 'schedule_visibility' and sets persons.connected_user_id.
create table connection_permissions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references connections(id) on delete cascade,
  scope_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (connection_id, scope_key)
);

alter table connection_permissions enable row level security;
create policy "party can read" on connection_permissions for select
  using (exists (
    select 1 from connections c
    where c.id = connection_permissions.connection_id
      and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
  ));

-- An accepted connection may book directly: one more booking mode.
alter table booking_permissions drop constraint booking_permissions_mode_check;
alter table booking_permissions add constraint booking_permissions_mode_check
  check (mode in ('open_link','approved_contacts','org_internal','connection'));
