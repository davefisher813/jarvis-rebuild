-- Track 3, migration 0005: shared projects (build master section 6). Tier 1
-- is read-only visibility of one project and its tasks for one connection;
-- tier 2 adds an assignee label and lets an 'edit' share touch tasks. There
-- is deliberately no shared policy on projects, goals or areas: a
-- collaborator can never rename the project, move it, or see what it rolls
-- up to. That boundary is which tables get a policy, not a check inside one.

create table project_shares (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references connections(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  permission text not null check (permission in ('view','edit')),
  shared_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (connection_id, project_id)
);

-- A share can only be made while the connection has shared_projects on.
create or replace function check_shared_projects_scope() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from connection_permissions
    where connection_id = new.connection_id
      and scope_key = 'shared_projects'
      and enabled
  ) then
    raise exception 'shared_projects scope is not enabled for this connection';
  end if;
  return new;
end;
$$;

create trigger project_shares_scope_guard
  before insert on project_shares
  for each row execute function check_shared_projects_scope();

alter table project_shares enable row level security;
create policy "party can read" on project_shares for select
  using (exists (
    select 1 from connections c
    where c.id = project_shares.connection_id
      and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
  ));

create or replace function can_view_shared_project(p_project_id uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from project_shares ps
    join connections c on c.id = ps.connection_id
    where ps.project_id = p_project_id
      and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
  )
$$;

create or replace function can_edit_shared_project(p_project_id uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from project_shares ps
    join connections c on c.id = ps.connection_id
    where ps.project_id = p_project_id
      and ps.permission = 'edit'
      and (c.requester_id = auth.uid() or c.recipient_id = auth.uid())
  )
$$;

-- Permissive policies combine with OR, so these add the shared party's read
-- on top of 0001's org-only policies without touching them. Worth one real
-- test against a live project before anyone relies on it.
create policy "shared read" on projects for select using (can_view_shared_project(id));
create policy "shared read" on tasks for select using (can_view_shared_project(project_id));

-- Tier 2: who is responsible, independent of who owns. A label, not a gate.
alter table tasks add column assigned_to_user_id uuid;
create index on tasks (assigned_to_user_id) where assigned_to_user_id is not null;

create policy "shared edit" on tasks for update
  using (can_edit_shared_project(project_id))
  with check (can_edit_shared_project(project_id));
create policy "shared insert" on tasks for insert
  with check (can_edit_shared_project(project_id));
