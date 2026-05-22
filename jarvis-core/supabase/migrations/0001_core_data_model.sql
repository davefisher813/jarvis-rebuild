-- JARVIS Core Data Model
-- Migration 0001: the base spine every Personal feature will sit on.
--
-- Backs the approved behavior (D1-D10):
--   D4/D5  native DELETE, no tombstone table  -> deleted rows cannot resurrect
--   D6     row-level security per owner        -> a user reads only their rows
--   D7/D10 monotonic server updated_at         -> last write wins, deterministic
--   D9     missing/not-owned writes no-op       -> RLS + RPC return no rows
--
-- Identity: owner_id defaults to auth.uid() (Supabase Auth). At Milestone B,
-- swap the policies' auth.uid() for the Clerk JWT subject, e.g.
--   (auth.jwt() ->> 'sub')::uuid
-- and configure a Clerk -> Supabase JWT template. No table changes needed.

-- ---------------------------------------------------------------------------
-- Extensibility seam: the type registry. No Personal types are seeded yet
-- (org, workstream, project, meeting, contact arrive in their own gated steps).
-- ---------------------------------------------------------------------------
create table if not exists entity_type (
  key        text primary key,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The base item: common columns plus a typed JSONB payload. updated_at is the
-- server-authoritative monotonic clock used for last-write-wins.
-- ---------------------------------------------------------------------------
create table if not exists item (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  entity_type text not null references entity_type(key),
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists item_owner_idx on item (owner_id);
create index if not exists item_owner_type_idx on item (owner_id, entity_type);

-- ---------------------------------------------------------------------------
-- Scalar settings: server-authoritative single values (theme, budget, ...).
-- Same monotonic updated_at rule = the scalar-sync fix.
-- ---------------------------------------------------------------------------
create table if not exists scalar_setting (
  owner_id   uuid not null default auth.uid(),
  key        text not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- ---------------------------------------------------------------------------
-- Monotonic updated_at. Guarantees the stamp is strictly greater than the
-- prior one, so server time never ties or goes backwards. This is the
-- last-write-wins ordering guarantee (D7, D10) at the database level.
-- ---------------------------------------------------------------------------
create or replace function set_monotonic_updated_at()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    new.updated_at := now();
  else
    new.updated_at := greatest(now(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

drop trigger if exists item_set_updated_at on item;
create trigger item_set_updated_at
  before insert or update on item
  for each row execute function set_monotonic_updated_at();

drop trigger if exists scalar_setting_set_updated_at on scalar_setting;
create trigger scalar_setting_set_updated_at
  before insert or update on scalar_setting
  for each row execute function set_monotonic_updated_at();

-- ---------------------------------------------------------------------------
-- Atomic JSONB merge inside RLS. The store's update() calls this. Running as
-- the caller (security invoker) means RLS restricts the update to rows the
-- user owns: a missing or not-owned id updates nothing and returns false
-- (D6, D9). The trigger stamps a fresh monotonic updated_at on success.
-- ---------------------------------------------------------------------------
create or replace function item_apply_patch(p_id uuid, p_patch jsonb)
returns boolean
language plpgsql
security invoker
as $$
declare
  n int;
begin
  update item
     set data = data || p_patch
   where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security: the D6 enforcement. A user can touch only their own rows.
-- ---------------------------------------------------------------------------
alter table item enable row level security;
alter table scalar_setting enable row level security;
alter table entity_type enable row level security;

drop policy if exists item_select on item;
drop policy if exists item_insert on item;
drop policy if exists item_update on item;
drop policy if exists item_delete on item;
create policy item_select on item for select using (owner_id = auth.uid());
create policy item_insert on item for insert with check (owner_id = auth.uid());
create policy item_update on item for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy item_delete on item for delete using (owner_id = auth.uid());

drop policy if exists scalar_select on scalar_setting;
drop policy if exists scalar_insert on scalar_setting;
drop policy if exists scalar_update on scalar_setting;
drop policy if exists scalar_delete on scalar_setting;
create policy scalar_select on scalar_setting for select using (owner_id = auth.uid());
create policy scalar_insert on scalar_setting for insert with check (owner_id = auth.uid());
create policy scalar_update on scalar_setting for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy scalar_delete on scalar_setting for delete using (owner_id = auth.uid());

-- entity_type is a global registry: any signed-in user may read it; only
-- migrations / service role may write it (no write policy is granted).
drop policy if exists entity_type_select on entity_type;
create policy entity_type_select on entity_type for select using (auth.role() = 'authenticated');

-- The core spine is entity-type agnostic. One placeholder type lets the
-- foreign key hold until the real Personal types are seeded in a later step.
insert into entity_type (key) values ('item')
  on conflict (key) do nothing;
