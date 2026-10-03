-- Migration 0044: the JARVIS unified substrate, slice 01 (2026-10-03).
--
-- One foundation for authorization, scoped context, proposals, commands,
-- approvals, receipts and durable decisions, with Email as its first consumer
-- (docs/jarvis-unified/IMPLEMENTATION-SPEC.md sections 03, 14, 17; the
-- physical mapping is docs/jarvis-unified/REPO-MAP.md). Additive only:
-- nothing here renames, drops or rewrites a row the app already stores. The
-- universal `item` table stays the one home for committed life records; the
-- tables below are the CONTROL PLANE around it and the PROVISIONAL mail store
-- beside it. An email candidate is not an item and never enters an item
-- query, by construction: it has its own table.
--
-- The rules this file carries:
--   1. Every table has RLS on and explicit grants. The browser (anon,
--      authenticated) gets exactly the rights a policy below names and
--      nothing by default; service_role gets everything. A table with no
--      write policy is written only by server code.
--   2. Every reference between two owned rows is a COMPOSITE foreign key on
--      (id, owner_id), so a row cannot point at another owner's row even if
--      an id leaks. `item` gets the matching unique index for that. A
--      set-null reference names its one column (Postgres 15 or newer), so a
--      deleted item clears destination_id and never owner_id.
--   3. Server-only columns are protected by trigger, not by convention: a
--      browser session cannot grant itself a capability, bump an auth epoch,
--      mark a candidate saved, or write a confirmed receipt.
--   4. Receipts are append-only. Erasure is an UPDATE by the server that
--      removes payload and leaves a tombstone; a row delete happens only when
--      the account itself is deleted.
--   5. No provider or agent credential lives in a public table. They live in
--      the jarvis_private schema, which PostgREST does not expose, reachable
--      only through server functions in later slices.
--   6. Every function below is revoked from PUBLIC, anon and authenticated
--      and granted back only where a browser session must call it.
--
-- Rollback: supabase/rollback/0044_jarvis_unified_substrate_down.sql.
-- Rehearsed forward and back on a local Postgres 16 by
-- supabase/tests/substrate.sh, which is also the RLS proof.

-- ---------------------------------------------------------------------------
-- 0. Item kinds this slice adds, only where no equivalent kind exists.
--    decision  -> the existing decision_record (0025) is the item; versions
--                 live in decision_version below.
--    waiting   -> new. The old Waiting On was derived from Gmail on the
--                 device and never a record.
--    exploration_note -> new. A kept Mentioned item that is not a decision.
-- ---------------------------------------------------------------------------
insert into entity_type (key) values ('waiting'), ('exploration_note')
  on conflict (key) do nothing;

-- Composite target for every owner-aware reference into item. Redundant with
-- the primary key for lookups; required for a (id, owner_id) foreign key.
create unique index if not exists item_id_owner_idx on item (id, owner_id);

-- ---------------------------------------------------------------------------
-- 1. The private schema. Not exposed through PostgREST; no browser role may
--    even see it. Credentials and encrypted context snapshots live here.
-- ---------------------------------------------------------------------------
create schema if not exists jarvis_private;
revoke all on schema jarvis_private from public;
revoke all on schema jarvis_private from anon, authenticated;
grant usage on schema jarvis_private to service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers.
-- ---------------------------------------------------------------------------

-- True when the statement runs as server code: the service role through
-- PostgREST, or a database role that is not a browser role (postgres in the
-- SQL editor, or the owner of a SECURITY DEFINER command function). False for
-- anon and authenticated, which is what every protection below keys on.
create or replace function jarvis_is_server()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or current_user not in ('anon', 'authenticated');
$$;

-- updated_at, kept strictly increasing the way item's is (0001).
create or replace function jarvis_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
  else
    new.updated_at := greatest(now(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

-- updated_at plus an integer revision that moves on every change. Commands
-- carry expected_revision and are refused when it no longer matches.
create or replace function jarvis_touch_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    if new.revision is null then new.revision := 1; end if;
  else
    new.updated_at := greatest(now(), old.updated_at + interval '1 microsecond');
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

-- Columns a browser session may never change. Named per table as trigger
-- arguments. Server code (jarvis_is_server) passes through.
create or replace function jarvis_protect_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  col text;
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
begin
  if jarvis_is_server() then
    return new;
  end if;
  foreach col in array tg_argv loop
    if (o -> col) is distinct from (n -> col) then
      raise exception 'column % of % is written by the server only', col, tg_table_name
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

-- Receipts: append-only. The server may erase payload (an UPDATE that only
-- touches the erasure columns) and may delete rows when the account goes.
create or replace function jarvis_receipt_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  col text;
  o jsonb;
  n jsonb;
begin
  if not jarvis_is_server() then
    raise exception 'receipt_event is append-only' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  o := to_jsonb(old);
  n := to_jsonb(new);
  for col in select key from jsonb_object_keys(o) as k(key) loop
    if col in ('diff', 'scope_summary', 'evidence_refs', 'provider_ack', 'before_ref', 'after_ref', 'erased_at') then
      continue;
    end if;
    if (o -> col) is distinct from (n -> col) then
      raise exception 'receipt_event.% cannot change after it is written', col using errcode = '42501';
    end if;
  end loop;
  if new.erased_at is null then
    raise exception 'the only update a receipt accepts is an erasure' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- A candidate's destination must be an item of the kind the candidate
-- promised. Bills and receipts go to Money and nowhere else; a bill can never
-- land as a task. Asserted here as well as in the adapter layer.
create or replace function jarvis_candidate_destination_kind()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  want text;
  got text;
begin
  if new.destination_id is null then
    return new;
  end if;
  want := case new.kind
    when 'bill' then 'money_bill'
    when 'receipt' then 'money_receipt'
    when 'task' then 'task'
    when 'event' then 'event'
    when 'waiting' then 'waiting'
  end;
  select entity_type into got from item where id = new.destination_id and owner_id = new.owner_id;
  if got is null then
    raise exception 'candidate destination % is not an item this owner holds', new.destination_id using errcode = '23503';
  end if;
  if got <> want then
    raise exception 'a % candidate cannot be saved as a % item', new.kind, got using errcode = '23514';
  end if;
  return new;
end;
$$;

-- The one policy rule shape v1 allows: exact sender, one account, one
-- category. No expressions, no code, nothing else.
create or replace function jarvis_policy_rule_ok(rule jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(rule) = 'object'
     and rule ? 'sender_exact' and jsonb_typeof(rule -> 'sender_exact') = 'string'
     and rule ? 'account_id' and jsonb_typeof(rule -> 'account_id') = 'string'
     and rule ? 'category_id' and jsonb_typeof(rule -> 'category_id') = 'string'
     and (select count(*) from jsonb_object_keys(rule)) = 3;
$$;

-- A decision cannot depend on itself.
create or replace function jarvis_dependency_no_self_edge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owner_item uuid;
begin
  select item_id into owner_item from decision_version where id = new.from_version_id and owner_id = new.owner_id;
  if owner_item is null then
    raise exception 'dependency names a version this owner does not hold' using errcode = '23503';
  end if;
  if owner_item = new.to_item_id then
    raise exception 'a decision cannot depend on itself' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Control plane.
-- ---------------------------------------------------------------------------

-- agent_connection: an outside assistant, or the manual export/import route.
create table if not exists agent_connection (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  provider_key text not null check (length(provider_key) between 1 and 64),
  display_name text not null check (length(display_name) between 1 and 120),
  status text not null default 'manual' check (status in ('manual', 'connected', 'revoked', 'expired', 'unavailable')),
  transport text not null default 'manual' check (transport in ('manual', 'https')),
  -- Server verified only. There is no 'execute' capability, by design.
  verified_capabilities text[] not null default '{}'
    check (verified_capabilities <@ array['read_context', 'propose', 'write_inert_draft', 'open_review_link']::text[]),
  capability_verified_at timestamptz,
  mode text not null default 'read_only' check (mode in ('read_only', 'help_me', 'just_handle_it')),
  remote_subject text,
  auth_epoch integer not null default 1 check (auth_epoch >= 1),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index if not exists agent_connection_subject_idx
  on agent_connection (owner_id, provider_key, remote_subject) where remote_subject is not null;
create index if not exists agent_connection_owner_active_idx
  on agent_connection (owner_id) where status in ('manual', 'connected');

drop trigger if exists agent_connection_touch on agent_connection;
create trigger agent_connection_touch before insert or update on agent_connection
  for each row execute function jarvis_touch_revision();
drop trigger if exists agent_connection_protect on agent_connection;
create trigger agent_connection_protect before update on agent_connection
  for each row execute function jarvis_protect_columns(
    'owner_id', 'provider_key', 'status', 'transport', 'verified_capabilities', 'capability_verified_at',
    'remote_subject', 'auth_epoch', 'last_used_at', 'revoked_at', 'schema_version');

alter table agent_connection enable row level security;
revoke all on table agent_connection from public;
revoke all on table agent_connection from anon, authenticated;
grant select, insert, update, delete on table agent_connection to authenticated;
grant all on table agent_connection to service_role;
drop policy if exists agent_connection_select on agent_connection;
drop policy if exists agent_connection_insert on agent_connection;
drop policy if exists agent_connection_update on agent_connection;
drop policy if exists agent_connection_delete on agent_connection;
create policy agent_connection_select on agent_connection for select using (owner_id = auth.uid());
-- A browser may add a MANUAL connection with no capabilities. Verified
-- adapters are connected by the server.
create policy agent_connection_insert on agent_connection for insert
  with check (owner_id = auth.uid() and status = 'manual' and transport = 'manual'
    and verified_capabilities = '{}' and capability_verified_at is null and remote_subject is null
    and auth_epoch = 1 and revoked_at is null and last_used_at is null);
-- display_name and mode; every other column is held by the protect trigger.
create policy agent_connection_update on agent_connection for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy agent_connection_delete on agent_connection for delete
  using (owner_id = auth.uid() and status = 'manual');

-- The credential behind a connected agent. Private; never selected by a
-- browser or returned to an agent.
create table if not exists jarvis_private.agent_credential (
  connection_id uuid primary key,
  owner_id uuid not null,
  token_hash text not null,
  token_enc text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  foreign key (connection_id, owner_id) references agent_connection (id, owner_id) on delete cascade
);
alter table jarvis_private.agent_credential enable row level security;
revoke all on table jarvis_private.agent_credential from public;
revoke all on table jarvis_private.agent_credential from anon, authenticated;
grant all on table jarvis_private.agent_credential to service_role;

-- scope_grant: what one agent may read, for one project or an explicit
-- resource slice. Server written after the user approved an exact preview.
create table if not exists scope_grant (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  agent_id uuid not null,
  project_id uuid,
  resource_ids uuid[] not null default '{}',
  fields text[] not null default '{}',
  purposes text[] not null default '{}',
  capability text not null default 'read_context' check (capability in ('read_context')),
  manifest_hash text not null,
  expires_at timestamptz,
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  grant_revision integer not null default 1,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (agent_id, owner_id) references agent_connection (id, owner_id) on delete cascade,
  foreign key (project_id, owner_id) references item (id, owner_id) on delete cascade,
  -- A grant names a project or explicit resources. Empty grants nothing.
  check (project_id is not null or cardinality(resource_ids) > 0),
  -- No wildcard, ever. Whole-database context is not an option.
  check (not ('*' = any(fields)) and not ('*' = any(purposes))),
  check (approved_by = owner_id)
);
create index if not exists scope_grant_owner_agent_project_idx on scope_grant (owner_id, agent_id, project_id);
create index if not exists scope_grant_owner_active_idx on scope_grant (owner_id) where revoked_at is null;

drop trigger if exists scope_grant_touch on scope_grant;
create trigger scope_grant_touch before insert or update on scope_grant
  for each row execute function jarvis_touch_revision();

alter table scope_grant enable row level security;
revoke all on table scope_grant from public;
revoke all on table scope_grant from anon, authenticated;
grant select on table scope_grant to authenticated;
grant all on table scope_grant to service_role;
drop policy if exists scope_grant_select on scope_grant;
create policy scope_grant_select on scope_grant for select using (owner_id = auth.uid());

-- policy_suggestion: "use this category next time?" after three matching
-- taps. Accepting it creates a LOCAL tag rule and nothing else.
create table if not exists policy_suggestion (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  agent_id uuid,
  surface text not null default 'email' check (surface in ('email')),
  action text not null default 'local.category.apply' check (action = 'local.category.apply'),
  rule jsonb not null check (jarvis_policy_rule_ok(rule)),
  evidence_tap_ids text[] not null default '{}',
  status text not null default 'suggested' check (status in ('suggested', 'accepted', 'dismissed')),
  expires_at timestamptz,
  decided_at timestamptz,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (agent_id, owner_id) references agent_connection (id, owner_id) on delete set null (agent_id)
);
create index if not exists policy_suggestion_owner_open_idx on policy_suggestion (owner_id) where status = 'suggested';

drop trigger if exists policy_suggestion_touch on policy_suggestion;
create trigger policy_suggestion_touch before insert or update on policy_suggestion
  for each row execute function jarvis_touch_revision();

alter table policy_suggestion enable row level security;
revoke all on table policy_suggestion from public;
revoke all on table policy_suggestion from anon, authenticated;
grant select, insert, update, delete on table policy_suggestion to authenticated;
grant all on table policy_suggestion to service_role;
drop policy if exists policy_suggestion_select on policy_suggestion;
drop policy if exists policy_suggestion_insert on policy_suggestion;
drop policy if exists policy_suggestion_update on policy_suggestion;
drop policy if exists policy_suggestion_delete on policy_suggestion;
create policy policy_suggestion_select on policy_suggestion for select using (owner_id = auth.uid());
create policy policy_suggestion_insert on policy_suggestion for insert
  with check (owner_id = auth.uid() and status = 'suggested' and agent_id is null);
create policy policy_suggestion_update on policy_suggestion for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy policy_suggestion_delete on policy_suggestion for delete using (owner_id = auth.uid());

-- job: one unit of purpose with exactly one normal project boundary.
create table if not exists job (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  agent_id uuid,
  project_id uuid,
  resource_ids uuid[] not null default '{}',
  purpose text not null check (length(purpose) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_by uuid not null default auth.uid(),
  scope_revision integer not null default 1,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (agent_id, owner_id) references agent_connection (id, owner_id) on delete set null (agent_id),
  foreign key (project_id, owner_id) references item (id, owner_id) on delete cascade,
  check (project_id is not null or cardinality(resource_ids) > 0),
  check (created_by = owner_id)
);
create index if not exists job_owner_open_idx on job (owner_id) where status = 'open';

drop trigger if exists job_touch on job;
create trigger job_touch before insert or update on job
  for each row execute function jarvis_touch_revision();
drop trigger if exists job_protect on job;
create trigger job_protect before update on job
  for each row execute function jarvis_protect_columns('owner_id', 'agent_id', 'project_id', 'resource_ids', 'created_by', 'scope_revision', 'schema_version');

alter table job enable row level security;
revoke all on table job from public;
revoke all on table job from anon, authenticated;
grant select, insert, update on table job to authenticated;
grant all on table job to service_role;
drop policy if exists job_select on job;
drop policy if exists job_insert on job;
drop policy if exists job_update on job;
create policy job_select on job for select using (owner_id = auth.uid());
create policy job_insert on job for insert with check (owner_id = auth.uid() and created_by = auth.uid());
create policy job_update on job for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- context_package: what was actually shared with an agent, as a manifest.
-- The permitted snapshot itself is private and expires.
create table if not exists context_package (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  job_id uuid not null,
  agent_id uuid,
  manifest jsonb not null default '[]' check (jsonb_typeof(manifest) = 'array'),
  expires_at timestamptz not null,
  auth_epoch integer not null,
  package_hash text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  omitted_counts jsonb not null default '{"unauthorized": 0, "over_limit": 0}',
  record_count integer not null default 0 check (record_count between 0 and 50),
  content_bytes integer not null default 0 check (content_bytes between 0 and 32768),
  purged_at timestamptz,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (job_id, owner_id) references job (id, owner_id) on delete cascade,
  foreign key (agent_id, owner_id) references agent_connection (id, owner_id) on delete set null (agent_id)
);
create index if not exists context_package_owner_active_idx on context_package (owner_id) where status = 'active';

drop trigger if exists context_package_touch on context_package;
create trigger context_package_touch before insert or update on context_package
  for each row execute function jarvis_touch_revision();

alter table context_package enable row level security;
revoke all on table context_package from public;
revoke all on table context_package from anon, authenticated;
grant select on table context_package to authenticated;
grant all on table context_package to service_role;
drop policy if exists context_package_select on context_package;
create policy context_package_select on context_package for select using (owner_id = auth.uid());

create table if not exists jarvis_private.context_snapshot (
  package_id uuid primary key,
  owner_id uuid not null,
  snapshot_enc text not null,
  purge_after timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (package_id, owner_id) references context_package (id, owner_id) on delete cascade
);
create index if not exists context_snapshot_purge_idx on jarvis_private.context_snapshot (purge_after);
alter table jarvis_private.context_snapshot enable row level security;
revoke all on table jarvis_private.context_snapshot from public;
revoke all on table jarvis_private.context_snapshot from anon, authenticated;
grant all on table jarvis_private.context_snapshot to service_role;

-- proposal: something an agent, an import or a person put forward. Never a
-- commitment. An Email proposal keeps its payload in email_candidate.
create table if not exists proposal (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  job_id uuid not null,
  agent_id uuid,
  surface text not null check (surface in ('project', 'email')),
  type text not null check (type in ('decision', 'constraint_change', 'capture')),
  payload_version integer not null default 1,
  payload jsonb,
  payload_hash text not null,
  evidence_refs uuid[] not null default '{}' check (cardinality(evidence_refs) <= 20),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed', 'superseded', 'stale')),
  created_by text not null check (created_by in ('agent', 'import', 'user')),
  origin_taint text not null default 'untrusted_suggestion' check (origin_taint in ('untrusted_suggestion', 'user_entered')),
  idempotency_key text,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (job_id, owner_id) references job (id, owner_id) on delete cascade,
  foreign key (agent_id, owner_id) references agent_connection (id, owner_id) on delete set null (agent_id),
  -- Email payload lives only in email_candidate; a project proposal carries its own.
  check ((surface = 'email' and payload is null) or (surface = 'project' and payload is not null))
);
create unique index if not exists proposal_idempotency_idx on proposal (owner_id, idempotency_key) where idempotency_key is not null;
create index if not exists proposal_owner_open_idx on proposal (owner_id, surface) where status = 'proposed';

drop trigger if exists proposal_touch on proposal;
create trigger proposal_touch before insert or update on proposal
  for each row execute function jarvis_touch_revision();

alter table proposal enable row level security;
revoke all on table proposal from public;
revoke all on table proposal from anon, authenticated;
grant select on table proposal to authenticated;
grant all on table proposal to service_role;
drop policy if exists proposal_select on proposal;
create policy proposal_select on proposal for select using (owner_id = auth.uid());

-- action: one logical command. Unique per owner and idempotency key, so two
-- taps or two devices resolve to one action.
create table if not exists action (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  kind text not null check (length(kind) between 1 and 64),
  actor_kind text not null check (actor_kind in ('user', 'rule', 'agent')),
  actor_id uuid,
  initiated_by_user_id uuid not null,
  proposal_id uuid,
  verb text not null check (length(verb) between 1 and 200),
  surface text not null check (surface in ('project', 'email', 'system')),
  state text not null default 'proposed'
    check (state in ('proposed', 'approved', 'running', 'confirmed', 'failed', 'cancelled', 'outcome_unknown', 'cancellation_requested')),
  payload_hash text not null,
  idempotency_key text not null,
  expected_revision integer,
  provider_account_id uuid,
  destination_id uuid,
  attempt integer not null default 1 check (attempt >= 1),
  authorization_snapshot jsonb not null default '{}',
  error_code text,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, idempotency_key),
  foreign key (actor_id, owner_id) references agent_connection (id, owner_id) on delete set null (actor_id),
  foreign key (proposal_id, owner_id) references proposal (id, owner_id) on delete set null (proposal_id),
  foreign key (destination_id, owner_id) references item (id, owner_id) on delete set null (destination_id),
  check (initiated_by_user_id = owner_id)
);
create index if not exists action_owner_state_idx on action (owner_id, state);
create index if not exists action_owner_created_idx on action (owner_id, created_at desc);

drop trigger if exists action_touch on action;
create trigger action_touch before insert or update on action
  for each row execute function jarvis_touch_revision();

alter table action enable row level security;
revoke all on table action from public;
revoke all on table action from anon, authenticated;
grant select on table action to authenticated;
grant all on table action to service_role;
drop policy if exists action_select on action;
create policy action_select on action for select using (owner_id = auth.uid());

-- receipt_event: what happened, in order, with an exact verb. Append-only.
create table if not exists receipt_event (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  action_id uuid not null,
  sequence integer not null check (sequence >= 1),
  state text not null,
  exact_verb text not null check (length(exact_verb) between 1 and 200),
  occurred_at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('user', 'rule', 'agent')),
  actor_id uuid,
  actor_display text not null default '',
  initiated_by_user_id uuid,
  scope_summary text not null default '',
  before_ref uuid,
  after_ref uuid,
  diff jsonb not null default '[]' check (jsonb_typeof(diff) = 'array'),
  evidence_refs uuid[] not null default '{}',
  provider_ack jsonb,
  error_code text,
  reversal_action_id uuid,
  assurance text not null check (assurance in ('verified_jarvis', 'provider_ack', 'reported_external')),
  erased_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (action_id, sequence),
  foreign key (action_id, owner_id) references action (id, owner_id) on delete cascade,
  foreign key (reversal_action_id, owner_id) references action (id, owner_id) on delete set null (reversal_action_id)
);
create index if not exists receipt_event_owner_action_idx on receipt_event (owner_id, action_id, sequence);
create index if not exists receipt_event_owner_time_idx on receipt_event (owner_id, occurred_at desc);

drop trigger if exists receipt_event_append_only on receipt_event;
create trigger receipt_event_append_only before update or delete on receipt_event
  for each row execute function jarvis_receipt_append_only();

alter table receipt_event enable row level security;
revoke all on table receipt_event from public;
revoke all on table receipt_event from anon, authenticated;
grant select on table receipt_event to authenticated;
grant all on table receipt_event to service_role;
drop policy if exists receipt_event_select on receipt_event;
create policy receipt_event_select on receipt_event for select using (owner_id = auth.uid());

-- approval: server created after a user session command. Bound to one
-- action, one payload hash, one source revision, one account. Never client
-- supplied.
create table if not exists approval (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  action_id uuid not null,
  payload_hash text not null,
  source_revision integer not null,
  destination_revision integer,
  account_id uuid,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  auth_epoch integer,
  nonce text not null unique,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (action_id, owner_id) references action (id, owner_id) on delete cascade,
  check (expires_at > granted_at)
);
create index if not exists approval_owner_open_idx on approval (owner_id) where consumed_at is null;

alter table approval enable row level security;
revoke all on table approval from public;
revoke all on table approval from anon, authenticated;
grant select on table approval to authenticated;
grant all on table approval to service_role;
drop policy if exists approval_select on approval;
create policy approval_select on approval for select using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Evidence and durable decisions.
-- ---------------------------------------------------------------------------

-- email_account: a connected Gmail mailbox. The credential is private.
create table if not exists email_account (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  provider text not null default 'gmail' check (provider in ('gmail')),
  provider_subject text not null,
  address text not null,
  scopes text[] not null default '{}',
  state text not null default 'connected' check (state in ('connected', 'reauth', 'disconnected')),
  last_sync_at timestamptz,
  cursor text,
  sync_error text,
  capabilities jsonb not null default '{}',
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, provider, provider_subject)
);

drop trigger if exists email_account_touch on email_account;
create trigger email_account_touch before insert or update on email_account
  for each row execute function jarvis_touch_revision();

alter table email_account enable row level security;
revoke all on table email_account from public;
revoke all on table email_account from anon, authenticated;
grant select on table email_account to authenticated;
grant all on table email_account to service_role;
drop policy if exists email_account_select on email_account;
create policy email_account_select on email_account for select using (owner_id = auth.uid());

-- Which stored Google grant (google_tokens, 0018) a mailbox reads with.
-- Private: the browser sees the account, never the credential reference.
create table if not exists jarvis_private.email_credential (
  account_id uuid primary key,
  owner_id uuid not null,
  credential_ref text not null,
  created_at timestamptz not null default now(),
  foreign key (account_id, owner_id) references email_account (id, owner_id) on delete cascade
);
alter table jarvis_private.email_credential enable row level security;
revoke all on table jarvis_private.email_credential from public;
revoke all on table jarvis_private.email_credential from anon, authenticated;
grant all on table jarvis_private.email_credential to service_role;

-- email_message: the provider cache. Metadata here; the sanitized body in
-- its own table so a list never carries bodies.
create table if not exists email_message (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  account_id uuid not null,
  provider_id text not null,
  thread_id text not null,
  internal_date timestamptz not null,
  from_address text not null default '',
  from_name text not null default '',
  to_addresses jsonb not null default '[]',
  cc_addresses jsonb not null default '[]',
  subject text not null default '',
  snippet text not null default '',
  has_body boolean not null default false,
  attachment_metadata jsonb not null default '[]',
  provider_labels text[] not null default '{}',
  provider_revision text,
  source_hash text not null,
  deleted_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (account_id, provider_id),
  foreign key (account_id, owner_id) references email_account (id, owner_id) on delete cascade
);
create index if not exists email_message_account_date_idx on email_message (account_id, internal_date desc, provider_id desc);
create index if not exists email_message_owner_date_idx on email_message (owner_id, internal_date desc);

drop trigger if exists email_message_touch on email_message;
create trigger email_message_touch before insert or update on email_message
  for each row execute function jarvis_touch_updated_at();

alter table email_message enable row level security;
revoke all on table email_message from public;
revoke all on table email_message from anon, authenticated;
grant select on table email_message to authenticated;
grant all on table email_message to service_role;
drop policy if exists email_message_select on email_message;
create policy email_message_select on email_message for select using (owner_id = auth.uid());

create table if not exists email_message_body (
  message_id uuid primary key,
  owner_id uuid not null default auth.uid(),
  sanitized_text text not null default '',
  sanitized_html text,
  sanitizer_version integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  foreign key (message_id, owner_id) references email_message (id, owner_id) on delete cascade
);
alter table email_message_body enable row level security;
revoke all on table email_message_body from public;
revoke all on table email_message_body from anon, authenticated;
grant select on table email_message_body to authenticated;
grant all on table email_message_body to service_role;
drop policy if exists email_message_body_select on email_message_body;
create policy email_message_body_select on email_message_body for select using (owner_id = auth.uid());

-- source_evidence: the stable thing a card, a decision or a receipt points
-- at. A manual capture may write one; everything else comes from the server.
create table if not exists source_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  type text not null check (type in ('email', 'manual', 'import')),
  account_id uuid,
  message_id uuid,
  provider_message_id text,
  thread_id text,
  source_hash text not null,
  excerpt text not null default '' check (length(excerpt) <= 2000),
  offsets jsonb not null default '{}',
  captured_at timestamptz not null default now(),
  source_timezone text,
  availability text not null default 'available' check (availability in ('available', 'deleted', 'disconnected')),
  encrypted_snapshot_ref text,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (account_id, owner_id) references email_account (id, owner_id) on delete set null (account_id),
  foreign key (message_id, owner_id) references email_message (id, owner_id) on delete set null (message_id)
);
create index if not exists source_evidence_owner_idx on source_evidence (owner_id, captured_at desc);

drop trigger if exists source_evidence_touch on source_evidence;
create trigger source_evidence_touch before insert or update on source_evidence
  for each row execute function jarvis_touch_updated_at();

alter table source_evidence enable row level security;
revoke all on table source_evidence from public;
revoke all on table source_evidence from anon, authenticated;
grant select, insert on table source_evidence to authenticated;
grant all on table source_evidence to service_role;
drop policy if exists source_evidence_select on source_evidence;
drop policy if exists source_evidence_insert on source_evidence;
create policy source_evidence_select on source_evidence for select using (owner_id = auth.uid());
create policy source_evidence_insert on source_evidence for insert
  with check (owner_id = auth.uid() and type = 'manual' and encrypted_snapshot_ref is null);

-- decision_version: the durable, versioned statement behind a decision item
-- (entity_type decision_record). Written by the command functions of a later
-- slice; the browser reads.
create table if not exists decision_version (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  item_id uuid not null,
  version integer not null check (version >= 1),
  title text not null check (length(title) between 1 and 200),
  statement text not null check (length(statement) between 1 and 500),
  rationale text not null check (length(rationale) between 1 and 4000),
  alternatives text[] not null default '{}',
  constraints jsonb not null default '[]' check (jsonb_typeof(constraints) = 'array'),
  dependency_refs jsonb not null default '[]' check (jsonb_typeof(dependency_refs) = 'array' and jsonb_array_length(dependency_refs) <= 20),
  evidence_refs uuid[] not null default '{}' check (cardinality(evidence_refs) <= 20),
  committed_by uuid not null,
  committed_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'superseded', 'withdrawn')),
  supersedes_version_id uuid,
  withdrawal_reason text,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (item_id, version),
  foreign key (item_id, owner_id) references item (id, owner_id) on delete cascade,
  foreign key (supersedes_version_id, owner_id) references decision_version (id, owner_id) on delete set null (supersedes_version_id),
  check (committed_by = owner_id),
  check (status <> 'withdrawn' or withdrawal_reason is not null)
);
-- At most one active version per decision.
create unique index if not exists decision_version_one_active_idx on decision_version (item_id) where status = 'active';
create index if not exists decision_version_owner_idx on decision_version (owner_id, item_id);

alter table decision_version enable row level security;
revoke all on table decision_version from public;
revoke all on table decision_version from anon, authenticated;
grant select on table decision_version to authenticated;
grant all on table decision_version to service_role;
drop policy if exists decision_version_select on decision_version;
create policy decision_version_select on decision_version for select using (owner_id = auth.uid());

-- decision_dependency: an edge from a version to a real item. The item's
-- revision in this repo is its monotonic updated_at, carried here as the
-- instant the dependency was taken.
create table if not exists decision_dependency (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  from_version_id uuid not null,
  to_item_id uuid not null,
  expected_item_updated_at timestamptz not null,
  kind text not null check (kind in ('depends_on', 'blocked_by', 'informed_by')),
  status text not null default 'current' check (status in ('current', 'changed', 'missing')),
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (from_version_id, to_item_id, kind),
  foreign key (from_version_id, owner_id) references decision_version (id, owner_id) on delete cascade,
  foreign key (to_item_id, owner_id) references item (id, owner_id) on delete cascade
);
create index if not exists decision_dependency_to_item_idx on decision_dependency (to_item_id);

drop trigger if exists decision_dependency_touch on decision_dependency;
create trigger decision_dependency_touch before insert or update on decision_dependency
  for each row execute function jarvis_touch_updated_at();
drop trigger if exists decision_dependency_no_self_edge on decision_dependency;
create trigger decision_dependency_no_self_edge before insert or update on decision_dependency
  for each row execute function jarvis_dependency_no_self_edge();

alter table decision_dependency enable row level security;
revoke all on table decision_dependency from public;
revoke all on table decision_dependency from anon, authenticated;
grant select on table decision_dependency to authenticated;
grant all on table decision_dependency to service_role;
drop policy if exists decision_dependency_select on decision_dependency;
create policy decision_dependency_select on decision_dependency for select using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. Provisional Email storage. Outside item, on purpose.
-- ---------------------------------------------------------------------------

-- email_candidate: a card. Proposed, edited and dismissed by the person in
-- the browser; SAVED only by the server command that also writes the item.
create table if not exists email_candidate (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  account_id uuid not null,
  message_id uuid not null,
  source_hash text not null,
  extractor_version text not null check (length(extractor_version) between 1 and 32),
  kind text not null check (kind in ('bill', 'receipt', 'task', 'event', 'waiting')),
  origin text not null default 'rule' check (origin in ('rule', 'manual', 'agent')),
  agent_id uuid,
  payload_version integer not null default 1,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null,
  provenance_by_field jsonb not null default '{}' check (jsonb_typeof(provenance_by_field) = 'object'),
  missing_fields text[] not null default '{}',
  status text not null default 'proposed' check (status in ('proposed', 'needs_details', 'saved', 'dismissed', 'stale', 'conflict')),
  fingerprint text not null,
  dismissed_fingerprint text,
  destination_id uuid,
  proposal_id uuid,
  action_id uuid,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, account_id, message_id, kind, fingerprint),
  foreign key (account_id, owner_id) references email_account (id, owner_id) on delete cascade,
  foreign key (message_id, owner_id) references email_message (id, owner_id) on delete cascade,
  foreign key (agent_id, owner_id) references agent_connection (id, owner_id) on delete set null (agent_id),
  foreign key (destination_id, owner_id) references item (id, owner_id) on delete set null (destination_id),
  foreign key (proposal_id, owner_id) references proposal (id, owner_id) on delete set null (proposal_id),
  foreign key (action_id, owner_id) references action (id, owner_id) on delete set null (action_id),
  -- Only a saved candidate carries a destination. (A saved one may lose it
  -- later when the item is deleted: the card then says Item removed.)
  check (status = 'saved' or destination_id is null)
);
create index if not exists email_candidate_owner_account_status_idx on email_candidate (owner_id, account_id, status);
create index if not exists email_candidate_owner_status_idx on email_candidate (owner_id, status);
create index if not exists email_candidate_message_idx on email_candidate (message_id);

drop trigger if exists email_candidate_touch on email_candidate;
create trigger email_candidate_touch before insert or update on email_candidate
  for each row execute function jarvis_touch_revision();
drop trigger if exists email_candidate_destination on email_candidate;
create trigger email_candidate_destination before insert or update on email_candidate
  for each row execute function jarvis_candidate_destination_kind();
drop trigger if exists email_candidate_protect on email_candidate;
create trigger email_candidate_protect before update on email_candidate
  for each row execute function jarvis_protect_columns(
    'owner_id', 'account_id', 'message_id', 'kind', 'origin', 'agent_id', 'destination_id', 'proposal_id', 'action_id', 'schema_version');

alter table email_candidate enable row level security;
revoke all on table email_candidate from public;
revoke all on table email_candidate from anon, authenticated;
grant select, insert, update, delete on table email_candidate to authenticated;
grant all on table email_candidate to service_role;
drop policy if exists email_candidate_select on email_candidate;
drop policy if exists email_candidate_insert on email_candidate;
drop policy if exists email_candidate_update on email_candidate;
drop policy if exists email_candidate_delete on email_candidate;
create policy email_candidate_select on email_candidate for select using (owner_id = auth.uid());
-- Manual capture only: a browser cannot plant a rule or agent candidate.
create policy email_candidate_insert on email_candidate for insert
  with check (owner_id = auth.uid() and origin = 'manual' and agent_id is null
    and status in ('proposed', 'needs_details') and destination_id is null and proposal_id is null and action_id is null);
-- Edit and dismiss while provisional. Saved, stale and conflict are the server's.
create policy email_candidate_update on email_candidate for update
  using (owner_id = auth.uid() and status in ('proposed', 'needs_details', 'dismissed'))
  with check (owner_id = auth.uid() and status in ('proposed', 'needs_details', 'dismissed') and destination_id is null);
create policy email_candidate_delete on email_candidate for delete
  using (owner_id = auth.uid() and status <> 'saved');

-- email_draft: inert until the exact send command of a later slice turns it
-- into a sent record.
create table if not exists email_draft (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  account_id uuid not null,
  thread_id text,
  to_addresses jsonb not null default '[]' check (jsonb_typeof(to_addresses) = 'array'),
  cc_addresses jsonb not null default '[]' check (jsonb_typeof(cc_addresses) = 'array'),
  bcc_addresses jsonb not null default '[]' check (jsonb_typeof(bcc_addresses) = 'array'),
  subject text not null default '',
  body_text text not null default '',
  attachment_refs jsonb not null default '[]' check (jsonb_typeof(attachment_refs) = 'array'),
  reply_headers jsonb not null default '{}' check (jsonb_typeof(reply_headers) = 'object'),
  send_state text not null default 'draft' check (send_state in ('draft', 'sending', 'sent', 'unknown', 'failed')),
  saved_at timestamptz not null default now(),
  sent_action_id uuid,
  provider_message_id text,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (account_id, owner_id) references email_account (id, owner_id) on delete cascade,
  foreign key (sent_action_id, owner_id) references action (id, owner_id) on delete set null (sent_action_id)
);
create index if not exists email_draft_owner_state_idx on email_draft (owner_id, send_state, saved_at desc);

drop trigger if exists email_draft_touch on email_draft;
create trigger email_draft_touch before insert or update on email_draft
  for each row execute function jarvis_touch_revision();
drop trigger if exists email_draft_protect on email_draft;
create trigger email_draft_protect before update on email_draft
  for each row execute function jarvis_protect_columns('owner_id', 'send_state', 'sent_action_id', 'provider_message_id', 'schema_version');

alter table email_draft enable row level security;
revoke all on table email_draft from public;
revoke all on table email_draft from anon, authenticated;
grant select, insert, update, delete on table email_draft to authenticated;
grant all on table email_draft to service_role;
drop policy if exists email_draft_select on email_draft;
drop policy if exists email_draft_insert on email_draft;
drop policy if exists email_draft_update on email_draft;
drop policy if exists email_draft_delete on email_draft;
create policy email_draft_select on email_draft for select using (owner_id = auth.uid());
create policy email_draft_insert on email_draft for insert
  with check (owner_id = auth.uid() and send_state = 'draft' and sent_action_id is null and provider_message_id is null);
create policy email_draft_update on email_draft for update
  using (owner_id = auth.uid() and send_state = 'draft') with check (owner_id = auth.uid() and send_state = 'draft');
create policy email_draft_delete on email_draft for delete
  using (owner_id = auth.uid() and send_state in ('draft', 'failed'));

-- ---------------------------------------------------------------------------
-- 6. Readiness. The app asks this before it offers a Save. A missing
--    function (this migration not run) is answered by PostgREST with
--    PGRST202, which the client reads as "unavailable", never as success.
-- ---------------------------------------------------------------------------
create or replace function substrate_readiness()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'migration', '0044',
    'registered', (
      select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
      from entity_type
      where key in ('money_bill', 'money_receipt', 'task', 'event', 'waiting', 'exploration_note', 'decision_record')
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. Account deletion reaches the new tables (extends 0036; same contract:
--    SECURITY DEFINER, pinned search_path, service_role only). Cascades carry
--    everything that hangs off action, email_account and agent_connection,
--    including the private rows.
-- ---------------------------------------------------------------------------
create or replace function delete_owned(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.receipt_event where owner_id = p_uid;
  delete from public.approval where owner_id = p_uid;
  delete from public.email_candidate where owner_id = p_uid;
  delete from public.email_draft where owner_id = p_uid;
  delete from public.action where owner_id = p_uid;
  delete from public.proposal where owner_id = p_uid;
  delete from public.context_package where owner_id = p_uid;
  delete from public.job where owner_id = p_uid;
  delete from public.scope_grant where owner_id = p_uid;
  delete from public.policy_suggestion where owner_id = p_uid;
  delete from public.decision_dependency where owner_id = p_uid;
  delete from public.decision_version where owner_id = p_uid;
  delete from public.source_evidence where owner_id = p_uid;
  delete from public.email_message_body where owner_id = p_uid;
  delete from public.email_message where owner_id = p_uid;
  delete from public.email_account where owner_id = p_uid;
  delete from public.agent_connection where owner_id = p_uid;
  delete from public.item where owner_id = p_uid;
  delete from public.scalar_setting where owner_id = p_uid;
  delete from public.event_log where owner_id = p_uid;
  delete from public.ai_usage where user_id = p_uid;
  delete from public.ai_tokens where user_id = p_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Function grants. Nothing in public is callable by a browser role unless
--    granted back here.
-- ---------------------------------------------------------------------------
-- Called inside triggers and a check constraint, which run as the session's
-- role, so the browser roles need execute on these two. Neither reveals
-- anything: one answers "is this server code", the other validates a shape.
revoke all on function jarvis_is_server() from public;
grant execute on function jarvis_is_server() to anon, authenticated, service_role;
revoke all on function jarvis_touch_updated_at() from public, anon, authenticated;
revoke all on function jarvis_touch_revision() from public, anon, authenticated;
revoke all on function jarvis_protect_columns() from public, anon, authenticated;
revoke all on function jarvis_receipt_append_only() from public, anon, authenticated;
revoke all on function jarvis_candidate_destination_kind() from public, anon, authenticated;
revoke all on function jarvis_policy_rule_ok(jsonb) from public;
grant execute on function jarvis_policy_rule_ok(jsonb) to anon, authenticated, service_role;
revoke all on function jarvis_dependency_no_self_edge() from public, anon, authenticated;
revoke all on function substrate_readiness() from public, anon, authenticated;
grant execute on function substrate_readiness() to authenticated, service_role;
revoke all on function delete_owned(uuid) from public, anon, authenticated;
grant execute on function delete_owned(uuid) to service_role;
