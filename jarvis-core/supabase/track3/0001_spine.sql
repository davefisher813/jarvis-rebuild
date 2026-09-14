-- Track 3, migration 0001: the unified spine, Area > Goal > Project > Task,
-- with Person attached to any node (JARVIS_TRACK3_BUILD_MASTER_2026_09_14.md,
-- section 1). Written 2026-09-14 for a Supabase project that does not exist
-- yet; nothing here has run anywhere. Apply in file order once Clerk is wired
-- as the project's third-party auth provider (auth.uid() is then the Clerk
-- user id and auth.jwt()->>'org_id' the Clerk org).

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template text not null check (template in ('personal','business','student')),
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  color text,
  icon text,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  area_id uuid not null references areas(id) on delete restrict,
  title text not null,
  status text not null default 'on_track' check (status in ('on_track','stalled','done','paused')),
  measure_kind text check (measure_kind in ('milestones','checkin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  area_id uuid not null references areas(id) on delete restrict,
  goal_id uuid references goals(id) on delete set null,
  title text not null,
  status text not null default 'on_track' check (status in ('on_track','stalled','done','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every task carries its area directly (denormalized, never null), which is
-- the hole the live app's tagged-but-unfiled tasks fell through.
create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  area_id uuid not null references areas(id) on delete restrict,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  due date,
  status text not null default 'open' check (status in ('open','done','skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on goals (org_id, area_id);
create index on projects (org_id, area_id);
create index on projects (org_id, goal_id);
create index on tasks (org_id, area_id);
create index on tasks (org_id, project_id);

-- A person attaches to at most one node. connected_user_id is set when a
-- Connection is accepted (0004) and is here from day one so no live row ever
-- needs it retrofitted.
create table persons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  connected_user_id uuid,
  area_id uuid references areas(id),
  goal_id uuid references goals(id),
  project_id uuid references projects(id),
  task_id uuid references tasks(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(area_id, goal_id, project_id, task_id) <= 1)
);

create index on persons (org_id);
create index on persons (connected_user_id) where connected_user_id is not null;

-- RLS through one stable helper, so auth.jwt() is read once per statement.
create or replace function current_org_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt()->>'org_id', '')::uuid
$$;

alter table areas enable row level security;
alter table goals enable row level security;
alter table projects enable row level security;
alter table tasks enable row level security;
alter table persons enable row level security;

create policy "org read" on areas for select using (org_id = current_org_id());
create policy "org write" on areas for all using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org read" on goals for select using (org_id = current_org_id());
create policy "org write" on goals for all using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org read" on projects for select using (org_id = current_org_id());
create policy "org write" on projects for all using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org read" on tasks for select using (org_id = current_org_id());
create policy "org write" on tasks for all using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy "org read" on persons for select using (org_id = current_org_id());
create policy "org write" on persons for all using (org_id = current_org_id()) with check (org_id = current_org_id());
