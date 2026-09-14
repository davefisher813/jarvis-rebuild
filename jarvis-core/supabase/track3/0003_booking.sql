-- Track 3, migration 0003: booking (build master section 3). The one line
-- that answers "no double-book race": an exclusion constraint on the owner
-- and the time range, enforced by Postgres under concurrent inserts, not by
-- an application check. Bookable types and bookings attach to at most one
-- spine node, the same rule persons follow.
--
-- Open, not designed here: Business round-robin (booking_links.owner_id as a
-- rotation rather than one person) changes this shape; flagged in the
-- master's section 7 and left alone.

create extension if not exists btree_gist;

create table bookable_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  owner_id uuid not null,
  area_id uuid references areas(id),
  goal_id uuid references goals(id),
  project_id uuid references projects(id),
  task_id uuid references tasks(id),
  name text not null,
  duration_min int not null,
  buffer_before_min int not null default 0,
  buffer_after_min int not null default 0,
  min_notice_hours int not null default 0,
  max_per_day int,
  check (num_nonnulls(area_id, goal_id, project_id, task_id) <= 1)
);

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  timezone text not null
);

create table availability_overrides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  the_date date not null,
  is_blocked boolean not null default true,
  override_start time,
  override_end time
);

create table booking_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  owner_id uuid not null,
  bookable_type_id uuid references bookable_types(id),
  slug text not null unique,
  visibility text not null check (visibility in ('public','link_only','named_contacts')),
  created_at timestamptz not null default now()
);

-- mode is a CHECK, not a native enum, on purpose: 0004 adds 'connection' by
-- swapping the constraint, which a native enum could not do inside the same
-- transaction that uses it on older Postgres.
create table booking_permissions (
  id uuid primary key default gen_random_uuid(),
  booking_link_id uuid not null references booking_links(id) on delete cascade,
  mode text not null check (mode in ('open_link','approved_contacts','org_internal')),
  approved_person_ids uuid[] default '{}'
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  owner_id uuid not null,
  booking_link_id uuid not null references booking_links(id),
  bookable_type_id uuid not null references bookable_types(id),
  requester_person_id uuid references persons(id),
  requester_name text not null,
  requester_email text not null,
  time_range tstzrange not null,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled','completed')),
  area_id uuid references areas(id),
  goal_id uuid references goals(id),
  project_id uuid references projects(id),
  task_id uuid references tasks(id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(area_id, goal_id, project_id, task_id) <= 1),
  -- Two confirmed bookings for one owner can never overlap, however many
  -- servers are taking requests.
  exclude using gist (owner_id with =, time_range with &&)
    where (status = 'confirmed')
);

alter table bookable_types enable row level security;
alter table availability_rules enable row level security;
alter table availability_overrides enable row level security;
alter table booking_links enable row level security;
alter table booking_permissions enable row level security;
alter table bookings enable row level security;
create policy "org read" on bookable_types for select using (org_id = current_org_id());
create policy "org write" on bookable_types for all using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "own rules" on availability_rules for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own overrides" on availability_overrides for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "org read" on booking_links for select using (org_id = current_org_id());
create policy "own links" on booking_links for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "link owner" on booking_permissions for all
  using (exists (select 1 from booking_links l where l.id = booking_permissions.booking_link_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from booking_links l where l.id = booking_permissions.booking_link_id and l.owner_id = auth.uid()));
create policy "org read" on bookings for select using (org_id = current_org_id());
create policy "own bookings" on bookings for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- The public slot page inserts a booking without an org session; that write
-- goes through a server function with the service role, never this policy.
