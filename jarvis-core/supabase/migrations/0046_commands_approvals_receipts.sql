-- Migration 0046: shared commands, exact approvals and receipts, slice 03 of
-- the unified substrate (2026-10-03). IMPLEMENTATION-SPEC.md section 07;
-- API-AND-VALIDATION.md "Endpoint envelope", "Canonical hashes", "Race
-- handling"; REPO-MAP.md section 4.
--
-- The one path a provisional thing takes to become a life record, and the one
-- path a send takes to leave: a person's own tap, bound to exactly what they
-- saw (a hash), to the revision they saw it at, consumed once, under a logical
-- idempotency key the SERVER derives (owner, kind, candidate and revision, or
-- the review nonce), so two taps or two devices resolve to one action, and a
-- receipt appended in the same transaction. Nothing here calls a provider.
-- External dispatch leaves through the outbox below, claimed once under a
-- fencing token, with "outcome unknown" kept apart from "failed", because a
-- send that may have left is never retried blind.
--
-- Additive. Rollback: supabase/rollback/0046_commands_approvals_receipts_down.sql.

-- ---------------------------------------------------------------------------
-- 0. The outbox: durable external commands. Server-written; the owner reads.
--    A row is born at review (the exact snapshot the person is looking at),
--    queued by the tap, claimed once by a worker, and settled by the outcome.
-- ---------------------------------------------------------------------------
create table if not exists outbox_command (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  action_id uuid not null,
  kind text not null check (kind in ('send_email', 'modify_labels')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null,
  provider_account_id uuid not null,
  state text not null default 'reviewed'
    check (state in ('reviewed', 'queued', 'claimed', 'dispatched', 'confirmed', 'failed', 'outcome_unknown', 'cancelled')),
  claim_token uuid,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  dispatched_at timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  provider_ack jsonb,
  error_code text,
  revision integer not null default 1,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (action_id),
  foreign key (action_id, owner_id) references action (id, owner_id) on delete cascade,
  foreign key (provider_account_id, owner_id) references email_account (id, owner_id) on delete cascade
);
create index if not exists outbox_command_queue_idx on outbox_command (state, created_at) where state in ('queued', 'claimed', 'dispatched');
create index if not exists outbox_command_owner_idx on outbox_command (owner_id, created_at desc);

drop trigger if exists outbox_command_touch on outbox_command;
create trigger outbox_command_touch before insert or update on outbox_command
  for each row execute function jarvis_touch_revision();

alter table outbox_command enable row level security;
revoke all on table outbox_command from public;
revoke all on table outbox_command from anon, authenticated;
grant select on table outbox_command to authenticated;
grant all on table outbox_command to service_role;
drop policy if exists outbox_command_select on outbox_command;
create policy outbox_command_select on outbox_command for select using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 1. Helpers.
-- ---------------------------------------------------------------------------

-- Receipts stay append-only (0044). The one more thing an erasure may change
-- is the verb itself, to the tombstone word, so a purged receipt carries no
-- vendor, no amount and no address in any column.
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
    if col = 'exact_verb' and new.erased_at is not null and new.exact_verb = 'Erased' then
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

-- The next receipt in an action's chain, and the action's state with it.
-- Append only; the trigger guards the rows, this guards the sequence.
create or replace function jarvis_receipt_append(
  p_owner uuid, p_action uuid, p_state text, p_verb text, p_actor_kind text, p_actor_id uuid, p_scope text, p_assurance text,
  p_evidence uuid[] default '{}', p_before uuid default null, p_after uuid default null, p_diff jsonb default '[]',
  p_provider_ack jsonb default null, p_error text default null, p_reversal uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  seq integer;
  rid uuid;
begin
  select coalesce(max(sequence), 0) + 1 into seq from receipt_event where action_id = p_action;
  insert into receipt_event (owner_id, action_id, sequence, state, exact_verb, actor_kind, actor_id, actor_display, initiated_by_user_id, scope_summary,
                             before_ref, after_ref, diff, evidence_refs, provider_ack, error_code, reversal_action_id, assurance)
  values (p_owner, p_action, seq, p_state, left(p_verb, 200), p_actor_kind, p_actor_id,
          case p_actor_kind when 'agent' then coalesce((select display_name from agent_connection where id = p_actor_id), 'Assistant') when 'user' then 'You' else 'Rule' end,
          p_owner, coalesce(p_scope, ''), p_before, p_after, coalesce(p_diff, '[]'::jsonb), coalesce(p_evidence, '{}'), p_provider_ack, p_error, p_reversal, p_assurance)
  returning id into rid;
  update action set state = p_state, error_code = p_error where id = p_action and owner_id = p_owner and (state <> p_state or error_code is distinct from p_error);
  return rid;
end;
$$;

-- The shape a capture must have before it becomes an item, by kind: the same
-- invariants the modules' own writers hold (ADAPTER-CONTRACT.md). The adapter
-- prepared the data; this is the database's own second look. Null means the
-- data is sound; otherwise the first field that is not.
create or replace function jarvis_capture_valid(p_kind text, p_entity_type text, p_data jsonb)
returns text
language plpgsql
immutable
as $$
begin
  if jsonb_typeof(p_data) <> 'object' then return 'data'; end if;
  if p_kind = 'bill' then
    if p_entity_type <> 'money_bill' then return 'destination'; end if;
    if coalesce(length(trim(p_data ->> 'vendor')), 0) = 0 then return 'issuer'; end if;
    if jsonb_typeof(p_data -> 'amountCents') <> 'number' or (p_data ->> 'amountCents')::numeric <> floor((p_data ->> 'amountCents')::numeric) or (p_data ->> 'amountCents')::numeric <= 0 then return 'amount'; end if;
    if (p_data ->> 'currency') !~ '^[A-Z]{3}$' then return 'currency'; end if;
    if p_data ? 'dueDate' and (p_data ->> 'dueDate') !~ '^\d{4}-\d{2}-\d{2}$' then return 'due_date'; end if;
    if coalesce(length(p_data ->> 'fingerprint'), 0) = 0 or jsonb_typeof(p_data -> 'history') <> 'array' then return 'ledger'; end if;
    if p_data ? 'paidAt' or p_data ? 'paidEvidence' then return 'paid'; end if;
    return null;
  elsif p_kind = 'receipt' then
    if p_entity_type <> 'money_receipt' then return 'destination'; end if;
    if coalesce(length(trim(p_data ->> 'vendor')), 0) = 0 then return 'merchant'; end if;
    if jsonb_typeof(p_data -> 'amountCents') <> 'number' or (p_data ->> 'amountCents')::numeric <> floor((p_data ->> 'amountCents')::numeric) or (p_data ->> 'amountCents')::numeric <= 0 then return 'amount'; end if;
    if (p_data ->> 'currency') !~ '^[A-Z]{3}$' then return 'currency'; end if;
    if (p_data ->> 'transactionDate') !~ '^\d{4}-\d{2}-\d{2}$' then return 'purchase_date'; end if;
    if coalesce(length(p_data ->> 'fingerprint'), 0) = 0 or jsonb_typeof(p_data -> 'history') <> 'array' then return 'ledger'; end if;
    return null;
  elsif p_kind = 'task' then
    if p_entity_type <> 'task' then return 'destination'; end if;
    if coalesce(length(trim(p_data ->> 'text')), 0) = 0 then return 'title'; end if;
    if p_data ? 'due' and (p_data ->> 'due') !~ '^\d{4}-\d{2}-\d{2}$' then return 'due_date'; end if;
    -- A bill is never a task: no amount, no vendor, no bill on a captured task.
    if p_data ? 'bill' or p_data ? 'amount' or p_data ? 'amountCents' or p_data ? 'vendor' then return 'bill_is_not_a_task'; end if;
    return null;
  elsif p_kind = 'event' then
    if p_entity_type <> 'event' then return 'destination'; end if;
    if coalesce(length(trim(p_data ->> 'title')), 0) = 0 then return 'title'; end if;
    if (p_data ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$' or (p_data ->> 'start') !~ '^\d{2}:\d{2}$' then return 'time'; end if;
    if p_data ? 'end' and (p_data ->> 'end') !~ '^\d{2}:\d{2}$' then return 'time'; end if;
    return null;
  elsif p_kind = 'waiting' then
    if p_entity_type <> 'waiting' then return 'destination'; end if;
    if coalesce(length(trim(p_data ->> 'title')), 0) = 0 then return 'title'; end if;
    if coalesce(length(trim(p_data ->> 'waitingFor')), 0) = 0 then return 'waiting_for'; end if;
    if coalesce(length(trim(p_data ->> 'counterpartyDisplay')), 0) = 0 then return 'counterparty_display'; end if;
    if (p_data ->> 'status') <> 'open' then return 'status'; end if;
    return null;
  end if;
  return 'kind';
end;
$$;

-- Whether an item may be removed by an Undo: unchanged since it was written
-- and referred to by nothing. Null means eligible; otherwise the reason.
create or replace function jarvis_undo_block(p_owner uuid, p_item uuid, p_expected timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  it item%rowtype;
begin
  select * into it from item where id = p_item and owner_id = p_owner;
  if not found then return 'ITEM_REMOVED'; end if;
  if it.updated_at <> p_expected then return 'DESTINATION_CHANGED'; end if;
  if it.entity_type = 'money_bill' and (it.data ? 'paidAt' or exists (select 1 from item t where t.owner_id = p_owner and t.entity_type = 'money_tx' and t.data ->> 'paysBillId' = p_item::text)) then return 'REFERENCED'; end if;
  if it.entity_type = 'money_receipt' and it.data ? 'linkedTransactionId' then return 'REFERENCED'; end if;
  if it.entity_type = 'task' and exists (
      select 1 from item e where e.owner_id = p_owner and e.entity_type = 'event'
         and (e.data ->> 'sourceTaskId' = p_item::text or e.data -> 'taskIds' ? p_item::text)) then return 'REFERENCED'; end if;
  if it.entity_type = 'event' and exists (select 1 from item t where t.owner_id = p_owner and t.entity_type = 'task' and t.data ->> 'eventId' = p_item::text) then return 'REFERENCED'; end if;
  if exists (select 1 from decision_dependency d where d.owner_id = p_owner and d.to_item_id = p_item) then return 'REFERENCED'; end if;
  return null;
end;
$$;

-- A receipt that belongs inside Email until its candidate is saved: a
-- suggestion, an inert draft, a capture that has not landed. The global
-- Activity feed shows none of these, only a count (spec 07.4, S16).
create or replace function jarvis_action_provisional_email(p_surface text, p_kind text, p_state text)
returns boolean
language sql
immutable
as $$
  select p_surface = 'email' and (p_kind in ('propose', 'draft', 'suggest_candidate') or (p_kind like 'capture_%' and p_state <> 'confirmed'));
$$;

-- The replay answer for an action that already exists: the same destination,
-- the same first receipt, so a second tap on any device sees what the first saw.
create or replace function jarvis_action_replay(p_action action)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('action_id', p_action.id, 'state', p_action.state, 'destination_id', p_action.destination_id,
                            'receipt_id', (select id from receipt_event where action_id = p_action.id order by sequence limit 1),
                            'safe_message', p_action.verb, 'replay', true,
                            'item_updated_at', (select updated_at from item where id = p_action.destination_id));
$$;

-- ---------------------------------------------------------------------------
-- 2. Candidates: edit, dismiss and restore while provisional, by revision.
-- ---------------------------------------------------------------------------

-- Edit the typed fields of a provisional candidate. The payload the person
-- edited replaces the payload whole (the client sends the full typed object);
-- every field they typed is tagged entered_by_user; the hash moves with it, so
-- an approval of the old card cannot land on the new one.
create or replace function candidate_edit(p_candidate uuid, p_expected_revision integer, p_payload jsonb, p_user_fields text[], p_missing text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  c email_candidate%rowtype;
  prov jsonb;
  f text;
  h text;
  next_status text;
  new_rev integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 16384 or not jarvis_payload_clean(p_payload) then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  select * into c from email_candidate where id = p_candidate and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if c.status not in ('proposed', 'needs_details', 'conflict') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'not provisional'); end if;
  if c.revision <> p_expected_revision then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', c.revision, 'payload', c.payload, 'payload_hash', c.payload_hash); end if;
  if coalesce(p_payload ->> 'kind', c.kind) <> c.kind then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'kind'); end if;
  prov := c.provenance_by_field;
  foreach f in array coalesce(p_user_fields, '{}') loop
    prov := prov || jsonb_build_object(f, jsonb_build_object('entered_by_user', true));
  end loop;
  h := encode(sha256(convert_to((p_payload || jsonb_build_object('kind', c.kind))::text, 'UTF8')), 'hex');
  next_status := case when cardinality(coalesce(p_missing, '{}')) > 0 then 'needs_details' else 'proposed' end;
  update email_candidate
     set payload = p_payload || jsonb_build_object('kind', c.kind), payload_hash = h, provenance_by_field = prov, missing_fields = coalesce(p_missing, '{}'), status = next_status
   where id = c.id
   returning revision into new_rev;
  return jsonb_build_object('candidate_id', c.id, 'revision', new_rev, 'payload_hash', h, 'status', next_status);
end;
$$;

create or replace function candidate_dismiss(p_candidate uuid, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  c email_candidate%rowtype;
  new_rev integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into c from email_candidate where id = p_candidate and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if c.status = 'dismissed' then return jsonb_build_object('candidate_id', c.id, 'revision', c.revision, 'status', 'dismissed', 'replay', true); end if;
  if c.status = 'saved' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'saved'); end if;
  if c.revision <> p_expected_revision then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', c.revision); end if;
  update email_candidate set status = 'dismissed', dismissed_fingerprint = fingerprint where id = c.id returning revision into new_rev;
  return jsonb_build_object('candidate_id', c.id, 'revision', new_rev, 'status', 'dismissed');
end;
$$;

create or replace function candidate_restore(p_candidate uuid, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  c email_candidate%rowtype;
  next_status text;
  new_rev integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into c from email_candidate where id = p_candidate and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if c.status <> 'dismissed' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'not dismissed'); end if;
  if c.revision <> p_expected_revision then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', c.revision); end if;
  next_status := case when cardinality(c.missing_fields) > 0 then 'needs_details' else 'proposed' end;
  update email_candidate set status = next_status, dismissed_fingerprint = null where id = c.id returning revision into new_rev;
  return jsonb_build_object('candidate_id', c.id, 'revision', new_rev, 'status', next_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. approveAndExecute (07.2): the atomic local save.
-- ---------------------------------------------------------------------------
--
-- p_prepared is what the destination adapter prepared from the card the
-- person saw: { destination_kind, data, exact_effect, display_summary,
-- module_version, evidence_excerpt }. The database checks the kind against
-- the destination, the data against the module's invariants, the candidate's
-- hash against what was shown and its revision against what was shown, then
-- writes the item, the evidence, the candidate's transition, the action, the
-- approval (created and consumed here, by this tap) and the confirmed receipt,
-- or none of them.
--
-- The logical idempotency key is the server's: capture:<candidate>:<revision>.
-- Two taps, two devices, a retry after a timeout: the candidate row is locked,
-- a saved candidate answers with its own action, and the client's request id
-- is recorded, not trusted. Agent origin is credited as the actor; the person
-- is always the initiator.
create or replace function capture_approve(
  p_candidate uuid, p_expected_revision integer, p_shown_payload_hash text, p_idempotency_key text, p_prepared jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  c email_candidate%rowtype;
  existing action%rowtype;
  dest_kind text;
  cap_data jsonb;
  bad text;
  dup uuid;
  new_item uuid;
  item_rev timestamptz;
  act uuid;
  ev uuid;
  rid uuid;
  verb text;
  summary text;
  actor_kind text;
  nonce text;
  msg email_message%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'idempotency_key'); end if;
  if jsonb_typeof(p_prepared) <> 'object' or length(p_prepared::text) > 32768 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'prepared'); end if;
  if p_shown_payload_hash is null or length(p_shown_payload_hash) not between 1 and 128 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'payload_hash'); end if;

  select * into c from email_candidate where id = p_candidate and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;

  if c.status = 'saved' then
    -- Already landed, by this device or another. The same hash means the same
    -- card: the first tap's answer. A different hash means this device was
    -- looking at an older card than the one that was saved.
    select * into existing from action where id = c.action_id and owner_id = owner;
    if not found then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'saved'); end if;
    if existing.payload_hash <> p_shown_payload_hash then
      return jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT', 'action_id', existing.id, 'destination_id', c.destination_id);
    end if;
    return jarvis_action_replay(existing);
  end if;
  if c.status = 'dismissed' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'dismissed'); end if;
  if c.status = 'needs_details' or cardinality(c.missing_fields) > 0 then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', to_jsonb(c.missing_fields)); end if;
  if c.status in ('stale', 'conflict') then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', c.revision, 'status', c.status); end if;
  if c.revision <> p_expected_revision or c.payload_hash <> p_shown_payload_hash then
    return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', c.revision, 'payload', c.payload, 'payload_hash', c.payload_hash);
  end if;
  -- The source must still be what the card was read from.
  select * into msg from email_message where id = c.message_id and owner_id = owner;
  if not found or msg.deleted_at is not null then return jsonb_build_object('error', 'SOURCE_CHANGED', 'detail', 'source unavailable'); end if;
  if msg.source_hash <> c.source_hash then
    update email_candidate set status = 'stale' where id = c.id;
    return jsonb_build_object('error', 'SOURCE_CHANGED', 'detail', 'email changed');
  end if;

  dest_kind := p_prepared ->> 'destination_kind';
  cap_data := p_prepared -> 'data';
  -- Readiness: the module's kind is registered, or nothing is written.
  if dest_kind is null or not exists (select 1 from entity_type where key = dest_kind) then return jsonb_build_object('error', 'MODULE_UNAVAILABLE', 'destination', dest_kind); end if;
  -- The destination is the candidate's kind's and no other: a bill is Money's.
  if dest_kind <> (case c.kind when 'bill' then 'money_bill' when 'receipt' then 'money_receipt' else c.kind end) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'destination'); end if;
  bad := jarvis_capture_valid(c.kind, dest_kind, cap_data);
  if bad is not null then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', jsonb_build_array(bad)); end if;

  verb := left(coalesce(p_prepared ->> 'exact_effect', ''), 200);
  summary := left(coalesce(p_prepared ->> 'display_summary', ''), 200);
  if verb = '' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'exact_effect'); end if;
  actor_kind := case c.origin when 'agent' then 'agent' when 'rule' then 'rule' else 'user' end;

  -- Money's own duplicate rule: the same fingerprint is the same record.
  if dest_kind in ('money_bill', 'money_receipt') and cap_data ->> 'fingerprint' is not null then
    select i.id into dup from item i where i.owner_id = owner and i.entity_type = dest_kind and i.data ->> 'fingerprint' = cap_data ->> 'fingerprint' limit 1;
  end if;
  -- An event's durable key (migration 0039): the same appointment is one row.
  if dest_kind = 'event' and cap_data ? 'clientId' then
    select i.id into dup from item i where i.owner_id = owner and i.data ->> 'clientId' = cap_data ->> 'clientId' limit 1;
  end if;

  if dup is null then
    insert into item (owner_id, entity_type, data) values (owner, dest_kind, cap_data) returning id, updated_at into new_item, item_rev;
  else
    new_item := dup;
    select i.updated_at into item_rev from item i where i.id = dup;
    verb := left('Already in ' || case when dest_kind like 'money_%' then 'Money' when dest_kind = 'event' then 'Schedule' else 'Place' end || ' · ' || summary, 200);
  end if;

  -- The evidence the record points at: stable, excerpt only.
  insert into source_evidence (owner_id, type, account_id, message_id, provider_message_id, thread_id, source_hash, excerpt)
  values (owner, 'email', c.account_id, c.message_id, msg.provider_id, msg.thread_id, c.source_hash, left(coalesce(p_prepared ->> 'evidence_excerpt', msg.snippet), 2000))
  returning id into ev;

  insert into action (owner_id, kind, actor_kind, actor_id, initiated_by_user_id, proposal_id, verb, surface, state, payload_hash, idempotency_key, expected_revision, destination_id,
                      authorization_snapshot)
  values (owner, 'capture_' || c.kind, actor_kind, case when actor_kind = 'agent' then c.agent_id end, owner, c.proposal_id, verb, 'email', 'approved', p_shown_payload_hash,
          'capture:' || c.id::text || ':' || c.revision::text, p_expected_revision, new_item,
          jsonb_build_object('candidate', c.id, 'revision', c.revision, 'module_version', p_prepared ->> 'module_version', 'client_request_id', p_idempotency_key,
                             'created', dup is null, 'approved_by', owner, 'at', now()))
  returning id into act;

  nonce := encode(sha256(convert_to(act::text || ':' || p_shown_payload_hash || ':' || clock_timestamp()::text, 'UTF8')), 'hex');
  insert into approval (owner_id, action_id, payload_hash, source_revision, account_id, granted_at, expires_at, consumed_at, nonce)
  values (owner, act, p_shown_payload_hash, c.revision, c.account_id, now(), now() + interval '5 minutes', now(), nonce);

  update email_candidate set status = 'saved', destination_id = new_item, action_id = act where id = c.id;
  if c.proposal_id is not null then update proposal set status = 'accepted' where id = c.proposal_id and owner_id = owner; end if;

  rid := jarvis_receipt_append(owner, act, 'confirmed', verb, actor_kind, case when actor_kind = 'agent' then c.agent_id end,
                               summary, 'verified_jarvis', array[ev], null, new_item,
                               (select coalesce(jsonb_agg(jsonb_build_object('field', kv.k, 'before', null, 'after', kv.v)), '[]'::jsonb) from jsonb_each(c.payload - 'kind') as kv(k, v)));

  return jsonb_build_object('action_id', act, 'state', 'confirmed', 'destination_id', new_item, 'receipt_id', rid, 'safe_message', verb,
                            'item_updated_at', item_rev, 'evidence_id', ev, 'already', dup is not null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Undo: a new compensating action, under the destination's revision.
-- ---------------------------------------------------------------------------
create or replace function action_undo(p_action uuid, p_expected_item_updated_at timestamptz, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  a action%rowtype;
  existing action%rowtype;
  blocked text;
  it item%rowtype;
  undo uuid;
  rid uuid;
  verb text;
  place text;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'idempotency_key'); end if;
  select * into a from action where id = p_action and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select * into existing from action where owner_id = owner and idempotency_key = 'undo:' || a.id::text;
  if found then return jarvis_action_replay(existing); end if;
  if a.kind not like 'capture_%' or a.state <> 'confirmed' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'not undoable'); end if;
  if a.destination_id is null then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'Item removed'); end if;
  if coalesce(a.authorization_snapshot ->> 'created', 'true') <> 'true' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'nothing created'); end if;
  blocked := jarvis_undo_block(owner, a.destination_id, p_expected_item_updated_at);
  if blocked = 'ITEM_REMOVED' then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'Item removed'); end if;
  if blocked is not null then return jsonb_build_object('error', 'DESTINATION_CHANGED', 'detail', blocked); end if;
  select * into it from item where id = a.destination_id and owner_id = owner for update;
  place := case when it.entity_type like 'money_%' then 'Money' when it.entity_type = 'task' then 'Tasks' when it.entity_type = 'event' then 'Schedule' else 'Waiting' end;
  verb := left('Removed From ' || place || ' · ' || coalesce(it.data ->> 'vendor', it.data ->> 'text', it.data ->> 'title', ''), 200);

  insert into action (owner_id, kind, actor_kind, initiated_by_user_id, verb, surface, state, payload_hash, idempotency_key, destination_id, authorization_snapshot)
  values (owner, 'undo', 'user', owner, verb, a.surface, 'approved', a.payload_hash, 'undo:' || a.id::text, null,
          jsonb_build_object('undoes', a.id, 'item_updated_at', p_expected_item_updated_at, 'client_request_id', p_idempotency_key, 'approved_by', owner, 'at', now()))
  returning id into undo;
  insert into approval (owner_id, action_id, payload_hash, source_revision, destination_revision, granted_at, expires_at, consumed_at, nonce)
  values (owner, undo, a.payload_hash, coalesce(a.expected_revision, 0), (extract(epoch from p_expected_item_updated_at)::bigint % 2147483647)::integer, now(), now() + interval '5 minutes', now(),
          encode(sha256(convert_to(undo::text || ':' || clock_timestamp()::text, 'UTF8')), 'hex'));

  delete from item where id = it.id and owner_id = owner;
  -- The card comes back exactly as it was, so the person can decide again.
  update email_candidate set status = case when cardinality(missing_fields) > 0 then 'needs_details' else 'proposed' end, destination_id = null, action_id = null
   where owner_id = owner and action_id = a.id;

  rid := jarvis_receipt_append(owner, undo, 'confirmed', verb, 'user', null, place, 'verified_jarvis', '{}', it.id, null,
                               jsonb_build_array(jsonb_build_object('field', 'item', 'before', it.entity_type, 'after', null)));
  -- The original's chain records the reversal; its own state stays what it was.
  perform jarvis_receipt_append(owner, a.id, 'confirmed', left('Undone · ' || a.verb, 200), 'user', null, place, 'verified_jarvis', '{}', it.id, null, '[]', null, null, undo);
  return jsonb_build_object('action_id', undo, 'state', 'confirmed', 'destination_id', null, 'receipt_id', rid, 'safe_message', verb, 'undone_action_id', a.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Receipt erasure: payload gone, tombstone kept. Not an undo.
-- ---------------------------------------------------------------------------
create or replace function receipt_erase(p_action uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  a action%rowtype;
  n integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into a from action where id = p_action and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if a.state in ('running', 'approved', 'proposed', 'cancellation_requested') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'still in flight'); end if;
  update receipt_event
     set exact_verb = 'Erased', diff = '[]'::jsonb, scope_summary = '', evidence_refs = '{}',
         provider_ack = case when provider_ack is null then null else jsonb_build_object('erased', true) end,
         before_ref = null, after_ref = null, erased_at = now()
   where action_id = a.id and owner_id = owner and erased_at is null;
  get diagnostics n = row_count;
  -- The tombstone: owner, an opaque key, the state and the destination id. No words.
  update action
     set verb = 'Erased', idempotency_key = 'erased:' || encode(sha256(convert_to(idempotency_key, 'UTF8')), 'hex'),
         authorization_snapshot = jsonb_build_object('erased_at', now()), payload_hash = encode(sha256(convert_to(payload_hash, 'UTF8')), 'hex'),
         error_code = null
   where id = a.id and verb <> 'Erased';
  -- Erasure reaches the private payload the receipt pointed at, when it was
  -- provisional (a suggestion never saved) or already left (a settled send).
  update email_candidate set payload = '{}'::jsonb, provenance_by_field = '{}'::jsonb where owner_id = owner and action_id = a.id and status <> 'saved';
  update outbox_command set payload = '{}'::jsonb, provider_ack = case when provider_ack is null then null else jsonb_build_object('erased', true) end
   where action_id = a.id and state in ('confirmed', 'failed', 'outcome_unknown', 'cancelled');
  return jsonb_build_object('action_id', a.id, 'erased_receipts', n, 'note', 'Deleting this receipt does not undo the action.');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. External commands: the exact review, the approval, the outbox, the
--    fenced claim, the settle. The provider call itself is slice 07's; the
--    machine that makes it safe is here.
-- ---------------------------------------------------------------------------

-- Review: an immutable snapshot of exactly what would leave, held in the
-- outbox as `reviewed`, with a nonce that can bind one logical action for
-- five minutes. The hash is the server's, over the snapshot plus the account
-- and the draft revision, and it is what the client shows back on the tap.
create or replace function command_review(p_kind text, p_payload jsonb, p_provider_account uuid, p_verb text, p_expected_revision integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  act uuid;
  ob uuid;
  nonce text;
  h text;
  exp timestamptz := now() + interval '5 minutes';
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_kind not in ('send_email', 'modify_labels') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'kind'); end if;
  if jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 65536 or not jarvis_payload_clean(p_payload) then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if p_verb is null or length(p_verb) not between 1 and 200 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'verb'); end if;
  if p_provider_account is null or not exists (select 1 from email_account where id = p_provider_account and owner_id = owner and state = 'connected') then
    return jsonb_build_object('error', 'PROVIDER_AUTH');
  end if;
  h := encode(sha256(convert_to((p_payload || jsonb_build_object('_account', p_provider_account, '_revision', coalesce(p_expected_revision, 0), '_kind', p_kind))::text, 'UTF8')), 'hex');
  nonce := encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
  insert into action (owner_id, kind, actor_kind, initiated_by_user_id, verb, surface, state, payload_hash, idempotency_key, expected_revision, provider_account_id, authorization_snapshot)
  values (owner, p_kind, 'user', owner, p_verb, 'email', 'proposed', h, 'review:' || nonce, p_expected_revision, p_provider_account, jsonb_build_object('reviewed_at', now()))
  returning id into act;
  insert into approval (owner_id, action_id, payload_hash, source_revision, account_id, granted_at, expires_at, nonce)
  values (owner, act, h, coalesce(p_expected_revision, 0), p_provider_account, now(), exp, nonce);
  insert into outbox_command (owner_id, action_id, kind, payload, payload_hash, provider_account_id, state)
  values (owner, act, p_kind, p_payload, h, p_provider_account, 'reviewed')
  returning id into ob;
  return jsonb_build_object('action_id', act, 'review_nonce', nonce, 'payload_hash', h, 'expires_at', exp, 'outbox_id', ob);
end;
$$;

-- The tap. Consumes the review's approval, binds the exact snapshot, queues
-- the command. A different hash is REVIEW_CHANGED; an expired nonce is
-- APPROVAL_EXPIRED; a second tap on the same nonce replays. The nonce is the
-- logical key: it can bind one action and no other.
create or replace function command_approve(p_review_nonce text, p_shown_payload_hash text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  ap approval%rowtype;
  a action%rowtype;
  ob outbox_command%rowtype;
  rid uuid;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'idempotency_key'); end if;
  select * into ap from approval where nonce = p_review_nonce and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select * into a from action where id = ap.action_id and owner_id = owner for update;
  if ap.consumed_at is not null then
    if a.payload_hash <> p_shown_payload_hash then return jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT', 'action_id', a.id); end if;
    return jarvis_action_replay(a);
  end if;
  if a.state <> 'proposed' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', a.state); end if;
  if ap.expires_at <= now() then
    perform jarvis_receipt_append(owner, a.id, 'cancelled', left('Approval Expired · ' || a.verb, 200), 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'APPROVAL_EXPIRED');
    update outbox_command set state = 'cancelled', error_code = 'APPROVAL_EXPIRED' where action_id = a.id and state = 'reviewed';
    return jsonb_build_object('error', 'APPROVAL_EXPIRED');
  end if;
  if ap.payload_hash <> p_shown_payload_hash or a.payload_hash <> p_shown_payload_hash then return jsonb_build_object('error', 'REVIEW_CHANGED'); end if;
  select * into ob from outbox_command where action_id = a.id for update;
  if not found or ob.state <> 'reviewed' or ob.payload_hash <> p_shown_payload_hash then return jsonb_build_object('error', 'REVIEW_CHANGED', 'detail', 'snapshot'); end if;
  if not exists (select 1 from email_account where id = a.provider_account_id and owner_id = owner and state = 'connected') then
    return jsonb_build_object('error', 'PROVIDER_AUTH');
  end if;
  update approval set consumed_at = now() where id = ap.id;
  update action set authorization_snapshot = authorization_snapshot || jsonb_build_object('client_request_id', p_idempotency_key, 'approved_by', owner, 'approved_at', now()) where id = a.id;
  update outbox_command set state = 'queued' where id = ob.id;
  rid := jarvis_receipt_append(owner, a.id, 'approved', a.verb, 'user', null, coalesce((select address from email_account where id = a.provider_account_id), ''), 'verified_jarvis');
  return jsonb_build_object('action_id', a.id, 'state', 'approved', 'outbox_id', ob.id, 'receipt_id', rid, 'safe_message', a.verb);
end;
$$;

-- Cancel before it leaves. Claimed or dispatched means the worker holds it:
-- the request is recorded and the outcome decides.
create or replace function command_cancel(p_action uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  a action%rowtype;
  ob outbox_command%rowtype;
  held boolean := false;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into a from action where id = p_action and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if a.state = 'cancelled' then return jsonb_build_object('action_id', a.id, 'state', 'cancelled', 'replay', true); end if;
  select * into ob from outbox_command where action_id = a.id for update;
  held := found;
  if a.state in ('proposed', 'approved') and (not held or ob.state in ('reviewed', 'queued')) then
    if held then update outbox_command set state = 'cancelled', error_code = 'CANCELLED' where id = ob.id; end if;
    update approval set expires_at = least(expires_at, now()) where action_id = a.id and consumed_at is null;
    perform jarvis_receipt_append(owner, a.id, 'cancelled', left('Cancelled · ' || a.verb, 200), 'user', null, '', 'verified_jarvis');
    return jsonb_build_object('action_id', a.id, 'state', 'cancelled');
  end if;
  if a.state in ('running', 'cancellation_requested') or (held and ob.state in ('claimed', 'dispatched')) then
    if a.state <> 'cancellation_requested' then
      perform jarvis_receipt_append(owner, a.id, 'cancellation_requested', 'Already Handed to Gmail · Checking the Result', 'user', null, '', 'verified_jarvis');
    end if;
    return jsonb_build_object('action_id', a.id, 'state', 'cancellation_requested');
  end if;
  return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', a.state);
end;
$$;

-- The worker's claim: one queued command, under a fencing token, after a
-- fresh look at authorization. Nothing claimed twice (SKIP LOCKED plus the
-- token); a claim that was never dispatched expires and is claimed again; a
-- queued command whose approval is older than five minutes lapses instead of
-- leaving late (07.1: undispatched TTL).
create or replace function outbox_claim(p_worker text, p_lease interval default interval '2 minutes')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ob outbox_command%rowtype;
  a action%rowtype;
  tok uuid := gen_random_uuid();
  approved_at timestamptz;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into ob from outbox_command
   where state = 'queued' or (state = 'claimed' and claim_expires_at <= now())
   order by created_at
   for update skip locked
   limit 1;
  if not found then return null; end if;
  select * into a from action where id = ob.action_id for update;
  select consumed_at into approved_at from approval where action_id = a.id order by consumed_at desc nulls last limit 1;
  -- Recheck just before dispatch: the person approved it (a user action, the
  -- approval consumed), within the last five minutes, nothing cancelled, the
  -- account still connected.
  if a.state not in ('approved', 'running') or a.actor_kind <> 'user' or approved_at is null then
    update outbox_command set state = 'cancelled', error_code = 'NOT_APPROVED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', left('Cancelled · ' || a.verb, 200), 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'NOT_APPROVED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'NOT_APPROVED');
  end if;
  if ob.state = 'queued' and approved_at + interval '5 minutes' <= now() then
    update outbox_command set state = 'cancelled', error_code = 'APPROVAL_EXPIRED' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'cancelled', 'Not Sent · Approval Expired · Review It Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'APPROVAL_EXPIRED');
    return jsonb_build_object('skipped', ob.id, 'reason', 'APPROVAL_EXPIRED');
  end if;
  if not exists (select 1 from email_account where id = ob.provider_account_id and owner_id = ob.owner_id and state = 'connected') then
    update outbox_command set state = 'failed', error_code = 'PROVIDER_AUTH' where id = ob.id;
    perform jarvis_receipt_append(ob.owner_id, a.id, 'failed', 'Not Sent · Reconnect Gmail', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'PROVIDER_AUTH');
    return jsonb_build_object('skipped', ob.id, 'reason', 'PROVIDER_AUTH');
  end if;
  update outbox_command
     set state = 'claimed', claim_token = tok, claimed_by = left(coalesce(p_worker, ''), 100), claimed_at = now(), claim_expires_at = now() + p_lease, attempt = attempt + 1
   where id = ob.id;
  update action set state = 'running', attempt = ob.attempt + 1 where id = a.id;
  return jsonb_build_object('outbox_id', ob.id, 'action_id', a.id, 'owner_id', ob.owner_id, 'kind', ob.kind, 'payload', ob.payload,
                            'payload_hash', ob.payload_hash, 'provider_account_id', ob.provider_account_id, 'claim_token', tok, 'attempt', ob.attempt + 1,
                            'lease_until', now() + p_lease);
end;
$$;

-- The one-way step right before the provider request. After this a cancel
-- cannot recall it and a timeout is unknown, never failed.
create or replace function outbox_dispatched(p_outbox uuid, p_claim_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update outbox_command set state = 'dispatched', dispatched_at = now() where id = p_outbox and claim_token = p_claim_token and state = 'claimed' and claim_expires_at > now();
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- The outcome, under the same token: confirmed (the provider acknowledged),
-- failed (proven not to have left), or outcome_unknown (it may have left).
-- A command never dispatched cannot be unknown; a dispatched one cannot be
-- called failed without a definitive refusal code.
create or replace function outbox_settle(p_outbox uuid, p_claim_token uuid, p_state text, p_verb text, p_provider_ack jsonb default null, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ob outbox_command%rowtype;
  rid uuid;
  st text := p_state;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if st not in ('confirmed', 'failed', 'outcome_unknown') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  select * into ob from outbox_command where id = p_outbox and claim_token = p_claim_token for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if ob.state not in ('claimed', 'dispatched') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', ob.state); end if;
  if ob.state = 'claimed' and st = 'outcome_unknown' then st := 'failed'; end if;
  if ob.state = 'claimed' and st = 'confirmed' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'not dispatched'); end if;
  if ob.state = 'dispatched' and st = 'failed' and p_error is null then st := 'outcome_unknown'; end if;
  if st = 'confirmed' and (p_provider_ack is null or jsonb_typeof(p_provider_ack) <> 'object' or p_provider_ack = '{}'::jsonb) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'ack'); end if;
  update outbox_command set state = st, provider_ack = p_provider_ack, error_code = case when st = 'outcome_unknown' then 'OUTCOME_UNKNOWN' else p_error end, claim_token = null, claim_expires_at = null where id = ob.id;
  rid := jarvis_receipt_append(ob.owner_id, ob.action_id, st, p_verb, 'user', null,
                               coalesce((select address from email_account where id = ob.provider_account_id), ''),
                               case when st = 'confirmed' then 'provider_ack' else 'verified_jarvis' end,
                               '{}', null, null, '[]', p_provider_ack, case when st = 'outcome_unknown' then 'OUTCOME_UNKNOWN' else p_error end);
  return jsonb_build_object('outbox_id', ob.id, 'action_id', ob.action_id, 'state', st, 'receipt_id', rid);
end;
$$;

-- Reconciliation: an unknown outcome becomes confirmed or failed only with
-- evidence (a provider message id found, or a definitive refusal), never by
-- the absence of a search hit.
create or replace function outbox_reconcile(p_outbox uuid, p_state text, p_verb text, p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ob outbox_command%rowtype;
  rid uuid;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_state not in ('confirmed', 'failed') or jsonb_typeof(p_evidence) <> 'object' or p_evidence = '{}'::jsonb then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if p_state = 'confirmed' and coalesce(p_evidence ->> 'provider_message_id', '') = '' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'evidence'); end if;
  if p_state = 'failed' and coalesce(p_evidence ->> 'error', '') = '' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'evidence'); end if;
  select * into ob from outbox_command where id = p_outbox for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if ob.state <> 'outcome_unknown' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', ob.state); end if;
  update outbox_command set state = p_state, provider_ack = case when p_state = 'confirmed' then p_evidence else provider_ack end, error_code = case when p_state = 'failed' then p_evidence ->> 'error' else null end where id = ob.id;
  rid := jarvis_receipt_append(ob.owner_id, ob.action_id, p_state, p_verb, 'user', null, '', case when p_state = 'confirmed' then 'provider_ack' else 'verified_jarvis' end,
                               '{}', null, null, '[]', case when p_state = 'confirmed' then p_evidence end, case when p_state = 'failed' then p_evidence ->> 'error' end);
  return jsonb_build_object('outbox_id', ob.id, 'state', p_state, 'receipt_id', rid);
end;
$$;

-- Sweeps, server only. Approvals that were never tapped lapse with their
-- actions; a dispatched command whose worker vanished past its lease is an
-- unknown outcome, never a retry.
create or replace function approvals_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  r record;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  for r in select a.id, a.owner_id, a.verb from approval ap join action a on a.id = ap.action_id
            where ap.consumed_at is null and ap.expires_at <= now() and a.state = 'proposed' loop
    perform jarvis_receipt_append(r.owner_id, r.id, 'cancelled', left('Approval Expired · ' || r.verb, 200), 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'APPROVAL_EXPIRED');
    update outbox_command set state = 'cancelled', error_code = 'APPROVAL_EXPIRED' where action_id = r.id and state = 'reviewed';
    n := n + 1;
  end loop;
  return jsonb_build_object('expired', n);
end;
$$;

create or replace function outbox_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  r record;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  for r in select ob.id, ob.owner_id, ob.action_id from outbox_command ob where ob.state = 'dispatched' and ob.claim_expires_at <= now() for update skip locked loop
    update outbox_command set state = 'outcome_unknown', error_code = 'OUTCOME_UNKNOWN', claim_token = null, claim_expires_at = null where id = r.id;
    perform jarvis_receipt_append(r.owner_id, r.action_id, 'outcome_unknown', 'Send Status Unknown · Check Gmail Before Trying Again', 'user', null, '', 'verified_jarvis', '{}', null, null, '[]', null, 'OUTCOME_UNKNOWN');
    n := n + 1;
  end loop;
  return jsonb_build_object('unknown', n);
end;
$$;

-- A reported outside action: recorded as reported, never verified, never a
-- JARVIS command's confirmation. An agent says it did something elsewhere;
-- the receipt says exactly that.
create or replace function reported_external_record(p_owner uuid, p_connection uuid, p_verb text, p_idempotency text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c agent_connection%rowtype;
  existing action%rowtype;
  act uuid;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into c from agent_connection where id = p_connection and owner_id = p_owner;
  if not found or c.status <> 'connected' then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
  if p_verb is null or length(p_verb) not between 1 and 200 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if p_idempotency is null or length(p_idempotency) not between 1 and 128 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  select * into existing from action where owner_id = p_owner and idempotency_key = 'reported:' || p_connection::text || ':' || p_idempotency;
  if found then return jsonb_build_object('action_id', existing.id, 'assurance', 'reported_external', 'replay', true); end if;
  insert into action (owner_id, kind, actor_kind, actor_id, initiated_by_user_id, verb, surface, state, payload_hash, idempotency_key, authorization_snapshot)
  values (p_owner, 'reported_external', 'agent', p_connection, p_owner, p_verb, 'project', 'confirmed',
          encode(sha256(convert_to(p_verb, 'UTF8')), 'hex'), 'reported:' || p_connection::text || ':' || p_idempotency, jsonb_build_object('reported', true))
  returning id into act;
  perform jarvis_receipt_append(p_owner, act, 'confirmed', p_verb, 'agent', p_connection, 'Reported by assistant · Not verified by JARVIS', 'reported_external');
  return jsonb_build_object('action_id', act, 'assurance', 'reported_external');
end;
$$;

-- A denied agent call, as safe metadata only (07.4 "Denied accesses log only
-- safe metadata"; S02 "safe denied receipt"): who asked, which method, which
-- code. Never the params. One row per connection, method, code and hour; a
-- repeat bumps the attempt count instead of adding a receipt, so a noisy
-- assistant cannot fill Activity. Called by the gateway after the ceiling
-- refuses, with the owner the token resolved to.
create or replace function access_denied_record(p_owner uuid, p_connection uuid, p_method text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  existing action%rowtype;
  act uuid;
  label text;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_method is null or length(p_method) not between 1 and 64 or p_code is null or p_code !~ '^[A-Z_]{3,40}$' then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if not exists (select 1 from agent_connection where id = p_connection and owner_id = p_owner) then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  key := 'denied:' || p_connection::text || ':' || p_method || ':' || p_code || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24');
  select * into existing from action where owner_id = p_owner and idempotency_key = key for update;
  if found then
    update action set attempt = attempt + 1 where id = existing.id;
    return jsonb_build_object('action_id', existing.id, 'repeated', existing.attempt + 1);
  end if;
  label := case p_method
    when 'context.preview' then 'Read Context' when 'context.issue' then 'Read Context' when 'proposal.submit' then 'Suggest'
    when 'draft.submit' then 'Write a Draft' when 'review.link' then 'Open a Review' when 'capabilities' then 'List Capabilities'
    when 'connection.revoke' then 'Revoke' else p_method end;
  insert into action (owner_id, kind, actor_kind, actor_id, initiated_by_user_id, verb, surface, state, payload_hash, idempotency_key, error_code, authorization_snapshot)
  values (p_owner, 'denied', 'agent', p_connection, p_owner, 'Denied · ' || label, 'system', 'failed', encode(sha256(convert_to(key, 'UTF8')), 'hex'), key, p_code,
          jsonb_build_object('method', p_method, 'code', p_code))
  returning id into act;
  perform jarvis_receipt_append(p_owner, act, 'failed', 'Denied · ' || label, 'agent', p_connection, p_code, 'verified_jarvis', '{}', null, null, '[]', null, p_code);
  return jsonb_build_object('action_id', act, 'repeated', 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reading receipts. Security invoker: the row policies decide what the
--    caller sees. The global feed omits provisional Email rows and carries
--    only their count; the detail of one action carries the whole chain and
--    says whether it belongs inside Email.
-- ---------------------------------------------------------------------------
create or replace function activity_feed(p_limit integer default 50, p_before timestamptz default null, p_scope text default 'global')
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  rows jsonb;
  pending integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_scope not in ('global', 'email') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'scope'); end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.occurred_at desc), '[]'::jsonb) into rows from (
    select r.id as receipt_id, r.action_id, r.sequence, r.state, r.exact_verb, r.occurred_at, r.actor_kind, r.actor_display, r.assurance,
           r.error_code, r.erased_at is not null as erased, r.reversal_action_id,
           a.kind, a.surface, a.destination_id,
           (a.kind like 'capture_%' and a.state = 'confirmed' and a.destination_id is not null
              and coalesce(a.authorization_snapshot ->> 'created', 'true') = 'true'
              and not exists (select 1 from receipt_event z where z.action_id = a.id and z.reversal_action_id is not null)) as undoable
      from receipt_event r
      join action a on a.id = r.action_id
     where r.owner_id = owner
       and (p_before is null or r.occurred_at < p_before)
       and case p_scope when 'global' then not jarvis_action_provisional_email(a.surface, a.kind, a.state)
                        else a.surface = 'email' end
     order by r.occurred_at desc
     limit lim) x;
  select count(*) into pending from email_candidate where owner_id = owner and status in ('proposed', 'needs_details', 'conflict');
  return jsonb_build_object('rows', rows, 'email_review_count', pending, 'scope', p_scope);
end;
$$;

create or replace function receipt_detail(p_action uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  a action%rowtype;
  chain jsonb;
  ev jsonb;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into a from action where id = p_action and owner_id = owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.sequence), '[]'::jsonb) into chain
    from (select id as receipt_id, sequence, state, exact_verb, occurred_at, actor_kind, actor_id, actor_display, scope_summary, before_ref, after_ref, diff, evidence_refs,
                 provider_ack, error_code, reversal_action_id, assurance, erased_at
            from receipt_event where action_id = a.id and owner_id = owner) r;
  select coalesce(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb) into ev
    from (select s.id, s.type, s.message_id, s.provider_message_id, s.thread_id, s.excerpt, s.captured_at, s.availability
            from source_evidence s where s.owner_id = owner and s.id = any (select unnest(evidence_refs) from receipt_event where action_id = a.id and owner_id = owner)) e;
  return jsonb_build_object(
    'action_id', a.id, 'kind', a.kind, 'surface', a.surface, 'state', a.state, 'verb', a.verb, 'actor_kind', a.actor_kind, 'actor_id', a.actor_id,
    'actor_display', case a.actor_kind when 'agent' then coalesce((select display_name from agent_connection where id = a.actor_id), 'Assistant') when 'user' then 'You' else 'Rule' end,
    'approved_by_user', a.authorization_snapshot ? 'approved_by', 'destination_id', a.destination_id, 'provider_account_id', a.provider_account_id,
    'created_at', a.created_at, 'updated_at', a.updated_at, 'error_code', a.error_code,
    'inside_email', jarvis_action_provisional_email(a.surface, a.kind, a.state),
    'undoable', (a.kind like 'capture_%' and a.state = 'confirmed' and a.destination_id is not null
                   and coalesce(a.authorization_snapshot ->> 'created', 'true') = 'true'
                   and not exists (select 1 from receipt_event z where z.action_id = a.id and z.reversal_action_id is not null)),
    'item_updated_at', (select updated_at from item where id = a.destination_id and owner_id = owner),
    'outbox', (select jsonb_build_object('state', o.state, 'attempt', o.attempt, 'error_code', o.error_code, 'dispatched_at', o.dispatched_at, 'provider_ack', o.provider_ack)
                 from outbox_command o where o.action_id = a.id),
    'receipts', chain, 'evidence', ev);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants.
-- ---------------------------------------------------------------------------
revoke all on function jarvis_receipt_append(uuid, uuid, text, text, text, uuid, text, text, uuid[], uuid, uuid, jsonb, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function jarvis_capture_valid(text, text, jsonb) from public, anon, authenticated;
revoke all on function jarvis_undo_block(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function jarvis_action_replay(action) from public, anon, authenticated;
revoke all on function jarvis_action_provisional_email(text, text, text) from public, anon;
grant execute on function jarvis_action_provisional_email(text, text, text) to authenticated;

revoke all on function candidate_edit(uuid, integer, jsonb, text[], text[]) from public, anon;
revoke all on function candidate_dismiss(uuid, integer) from public, anon;
revoke all on function candidate_restore(uuid, integer) from public, anon;
revoke all on function capture_approve(uuid, integer, text, text, jsonb) from public, anon;
revoke all on function action_undo(uuid, timestamptz, text) from public, anon;
revoke all on function receipt_erase(uuid) from public, anon;
revoke all on function command_review(text, jsonb, uuid, text, integer) from public, anon;
revoke all on function command_approve(text, text, text) from public, anon;
revoke all on function command_cancel(uuid) from public, anon;
revoke all on function activity_feed(integer, timestamptz, text) from public, anon;
revoke all on function receipt_detail(uuid) from public, anon;
grant execute on function candidate_edit(uuid, integer, jsonb, text[], text[]) to authenticated;
grant execute on function candidate_dismiss(uuid, integer) to authenticated;
grant execute on function candidate_restore(uuid, integer) to authenticated;
grant execute on function capture_approve(uuid, integer, text, text, jsonb) to authenticated;
grant execute on function action_undo(uuid, timestamptz, text) to authenticated;
grant execute on function receipt_erase(uuid) to authenticated;
grant execute on function command_review(text, jsonb, uuid, text, integer) to authenticated;
grant execute on function command_approve(text, text, text) to authenticated;
grant execute on function command_cancel(uuid) to authenticated;
grant execute on function activity_feed(integer, timestamptz, text) to authenticated;
grant execute on function receipt_detail(uuid) to authenticated;

revoke all on function outbox_claim(text, interval) from public, anon, authenticated;
revoke all on function outbox_dispatched(uuid, uuid) from public, anon, authenticated;
revoke all on function outbox_settle(uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function outbox_reconcile(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function approvals_sweep() from public, anon, authenticated;
revoke all on function outbox_sweep() from public, anon, authenticated;
revoke all on function reported_external_record(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function access_denied_record(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function outbox_claim(text, interval) to service_role;
grant execute on function outbox_dispatched(uuid, uuid) to service_role;
grant execute on function outbox_settle(uuid, uuid, text, text, jsonb, text) to service_role;
grant execute on function outbox_reconcile(uuid, text, text, jsonb) to service_role;
grant execute on function approvals_sweep() to service_role;
grant execute on function outbox_sweep() to service_role;
grant execute on function reported_external_record(uuid, uuid, text, text) to service_role;
grant execute on function access_denied_record(uuid, uuid, text, text) to service_role;
