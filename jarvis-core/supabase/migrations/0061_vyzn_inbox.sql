-- Migration 0061: the VYZN feed (Phase 0 design D5 and D6; PHASE0-DESIGN.md section 3, 2026-10-10).
--
-- An outside app (the backend inbox today; bridge and tucci reserved) hands JARVIS records. Every
-- record lands as a PROPOSAL on a new surface, `app`, with no job: an app proposes and never commits,
-- the person's tap is what makes an item, and nothing an app sends can ever overwrite a row the
-- person owns. The inbox is invisible to every existing screen at the database level (hub_overview
-- joins proposal to job on `surface = 'project'`), so a user on main sees nothing until Dave mints
-- the connection row.
--
-- What this file does:
--   proposal         surface gains 'app'; job_id becomes nullable with `(surface = 'app') = (job_id is null)`;
--                    the payload check admits an app payload
--   source_evidence  type gains 'app'; three columns (source_app, source_record_id, source_url) and an index
--   eight new functions
--     jarvis_vyzn_apps        the closed allowlist of app keys (a TS mirror lives in protocol.ts: VYZN_APPS)
--     vyzn_app_connect        server only: Dave mints an app's connection in the SQL editor; a second call
--                             rotates the token hash and writes a second receipt under the next epoch
--     jarvis_records_ingest   the one body behind the two doors below: whole batch refusals, per record
--                             outcomes (proposed, replay, already_saved, newer_revision_proposed), supersede
--                             of older open revisions, one arrival receipt per call that wrote anything
--     record_push             service request only: the gateway method record.push, through a connected,
--                             propose verified, not read only connection whose provider_key is an app
--     records_import          authenticated: the person's own pull (the backend inbox leg), owner from
--                             auth.uid(), the app's connection when one exists else null
--     vyzn_inbox              the one read of the inbox, for the proof and the Phase 0.5 row
--     record_approve          the person's tap: capture_approve's shape and order minus the mail; the
--                             clientId and the app stamp are the server's, never the adapter's
--     record_dismiss          proposal_dismiss restricted to the app surface
--   six replaced, each its production body plus the stated diff
--     jarvis_capture_valid    gains note and person branches (existing branches verbatim)
--     action_undo             admits record_% kinds, knows Notes and People, puts the proposal back to proposed
--     activity_feed           undoable admits record_%
--     receipt_detail          undoable admits record_%
--     connection_set_mode     Just Handle It is refused for an app (an app only proposes)
--     item_why                reads the real source_evidence.source_app and source_record_id
--
-- Hard rules this file carries:
--   1. record_push and records_import NEVER call jarvis_ai_switch. A deterministic transfer is not
--      inference; the feed works with AI off, and the proof asserts the contrast with proposal_submit.
--   2. Nothing partial. A batch with one bad record (shape, an authority key, an unknown kind, a reserved
--      key at the top level of data, an idempotency key reused with a different hash) is refused whole and writes nothing.
--   3. A newer revision of a saved record never touches the item. It becomes a proposal carrying
--      previous_item, and record_approve refuses that proposal with DESTINATION_CHANGED and a per field
--      difference. There is no code path in Phase 0 that can overwrite Dave's row.
--   4. An app never writes items. Only record_approve, on the person's tap, inserts into item.
--   5. Every function here, new or replaced, carries `set search_path = public`.
--
-- Deviations from PHASE0-DESIGN.md section 3 "0061_vyzn_inbox.sql", each stated:
--   a. The approve action's idempotency key is 'record:' || proposal id || ':' || the RECORD's revision
--      (payload ->> 'revision'), not the proposal row's revision: jarvis_touch_revision bumps the row's
--      revision when status moves to accepted, so a key built on it could never be found again on a replay.
--      p_expected_revision is still the row's revision (what the inbox row showed), as in proposal_dismiss.
--   b. vyzn_inbox answers both `revision` (the row's, to hand back as p_expected_revision) and
--      `record_revision` (the record's); the design listed one word for two facts.
--   c. The arrival verb's noun is taken from the app key (Backend Inbox, Bridge, Tucci) when no connection
--      row names it, instead of the literal 'Backend Inbox' for every app.
--   d. A batch that names the same source_record_id twice is refused whole (INVALID_PAYLOAD, detail
--      duplicate): otherwise the second copy would raise 23505 on the idempotency index mid batch.
--   e. action_undo's verb also reads data ->> 'name', so an undone record person reads its name rather
--      than nothing.
--   f. jarvis_capture_valid stays immutable and gains `set search_path = public` (it now calls
--      jarvis_address_ok); the rollback resets it.
--   g. The `difference` of a DESTINATION_CHANGED answer reads `yours` as the item's value (the person's)
--      and `theirs` as the record's (the app's); the design named the two words without saying which was which.
--   h. jarvis_records_ingest is SECURITY DEFINER with no grant: as an invoker body it would run under the
--      pulling person's role, which may only select proposal.
--
-- Review fixes (2026-10-10), from the adversarial SQL review of the working tree; each is a change to
-- a body above the design's wording and is proved by the inbox.sh check named:
--   1. record_approve's action key is 'record:' || proposal id || ':' || record revision || ':' || the
--      count of record_% actions the proposal already has, so Undo then Approve of the same row is a
--      second approval with a new key instead of a 23505 on action(owner_id, idempotency_key); the
--      status = accepted replay branch finds the latest record_% action of the proposal (created_at
--      desc), so the hash replay and IDEMPOTENCY_CONFLICT logic are unchanged. action_undo looks the
--      action up by id and is untouched. (check 26a)
--   2. jarvis_records_ingest refuses a client_at that is not finite (infinity, -infinity) or later than
--      now() + interval '1 day' with INVALID_PAYLOAD, detail client_at and the source_record_id, so a
--      record can never reach record_approve's epoch arithmetic with a value it cannot convert;
--      record_approve itself falls back to now() for an unreadable or infinite stamp. (check 10a)
--   3. jarvis_records_ingest survives a concurrent push of the same new batch: the per record insert
--      catches unique_violation (proposal_idempotency_idx) and re-reads the row the other push
--      committed, answering replay for the same bytes and IDEMPOTENCY_CONFLICT for other bytes; the
--      second pass is one subtransaction, so a refusal rolls back every write of the pass (nothing
--      partial still holds); the arrival receipt catches the same conflict on action(owner_id,
--      idempotency_key) and re-uses the receipt that stands. Proved (check 7a) by two real sessions:
--      one holds its push open while the other pushes the same batch (replay, replay) and, with other
--      bytes under one key, is refused whole with the untouched record not written; and by two pushes
--      inside one transaction answering replay. Not proved: the receipt conflict branch, which no
--      ordering of two sessions reaches (an identical batch that loses the race writes nothing and so
--      writes no receipt; a different batch has a different key); it is defensive only.
--   4. record_approve, on a payload carrying previous_item whose item is gone: if a row holds the
--      record's clientId that row is the destination and the answer is DESTINATION_CHANGED with the
--      difference against it; if none does and no accepted later revision exists, the tap falls
--      through to the create path instead of a permanent "Item removed", so a pending newer revision
--      after Undo is not a dead end. (check 26b)
--   5. record_approve and record_dismiss answer INVALID_PAYLOAD, detail expected_revision, for a null
--      p_expected_revision; before, a null skipped the optimistic revision check (SQL null never
--      compares unequal). capture_approve and connection_set_mode carry the same pre-existing pattern
--      and are out of this file's scope. (check 19a)
--   9. Header notes, no body change: vyzn_app_connect's gate is its EXECUTE grant (see the function);
--      jarvis_records_ingest's reserved key refusal is top level of data only (see the function).
--
-- Forward twice is a no-op. Rollback: rollback/0061_vyzn_inbox_down.sql. Rehearsed by tests/inbox.sh.

-- ---------------------------------------------------------------------------
-- 1. proposal: the app surface, with no job.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  -- The surface check: the one check that names surface and neither payload nor job_id.
  for c in select conname, pg_get_constraintdef(oid) as def from pg_constraint
            where conrelid = 'public.proposal'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%surface%' and pg_get_constraintdef(oid) not like '%payload%'
              and pg_get_constraintdef(oid) not like '%job_id%' loop
    if c.def not like '%''app''%' then execute format('alter table proposal drop constraint %I', c.conname); end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.proposal'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) like '%surface%' and pg_get_constraintdef(oid) not like '%payload%'
                   and pg_get_constraintdef(oid) not like '%job_id%') then
    alter table proposal add constraint proposal_surface_check check (surface in ('project', 'email', 'app'));
  end if;
  -- The payload check: an email proposal keeps its payload on the candidate; project and app carry their own.
  for c in select conname, pg_get_constraintdef(oid) as def from pg_constraint
            where conrelid = 'public.proposal'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%payload IS NULL%' loop
    if c.def not like '%''app''%' then execute format('alter table proposal drop constraint %I', c.conname); end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.proposal'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%payload IS NULL%') then
    alter table proposal add constraint proposal_payload_check
      check ((surface = 'email' and payload is null) or (surface in ('project', 'app') and payload is not null));
  end if;
  alter table proposal alter column job_id drop not null;
  if not exists (select 1 from pg_constraint where conrelid = 'public.proposal'::regclass and conname = 'proposal_app_job_check') then
    alter table proposal add constraint proposal_app_job_check check ((surface = 'app') = (job_id is null));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. source_evidence: an app as a kind of source. The browser insert policy
--    stays `type = 'manual'` only (0044); only record_approve writes type app.
-- ---------------------------------------------------------------------------
alter table source_evidence add column if not exists source_app text check (source_app is null or length(source_app) between 1 and 64);
alter table source_evidence add column if not exists source_record_id text check (source_record_id is null or length(source_record_id) between 1 and 128);
alter table source_evidence add column if not exists source_url text check (source_url is null or length(source_url) <= 2048);
do $$
declare
  c record;
begin
  for c in select conname, pg_get_constraintdef(oid) as def from pg_constraint
            where conrelid = 'public.source_evidence'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%type%' and pg_get_constraintdef(oid) like '%''email''%' loop
    if c.def not like '%''app''%' then execute format('alter table source_evidence drop constraint %I', c.conname); end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.source_evidence'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) like '%type%' and pg_get_constraintdef(oid) like '%''email''%') then
    alter table source_evidence add constraint source_evidence_type_check check (type in ('email', 'manual', 'import', 'app'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.source_evidence'::regclass and conname = 'source_evidence_app_fields_check') then
    alter table source_evidence add constraint source_evidence_app_fields_check
      check (type <> 'app' or (source_app is not null and source_record_id is not null));
  end if;
end $$;
create index if not exists source_evidence_app_record_idx on source_evidence (owner_id, source_app, source_record_id) where source_app is not null;

-- ---------------------------------------------------------------------------
-- 3. The allowlist and the minting function.
-- ---------------------------------------------------------------------------

-- The apps that may push or be pulled. A CHECK on provider_key would refuse
-- the rows that already exist (claude, manual); this is the one list, and
-- protocol.ts mirrors it as VYZN_APPS.
create or replace function jarvis_vyzn_apps()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['backend-inbox', 'bridge', 'tucci']::text[];
$$;
revoke all on function jarvis_vyzn_apps() from public;
grant execute on function jarvis_vyzn_apps() to anon, authenticated, service_role;

-- Dave mints an app's connection in the SQL editor (or the service role does).
-- Finds or inserts the row, verifies it with the token's hash through the
-- existing agent_connection_verify, and writes one connect receipt keyed per
-- rotation. A second call rotates the hash and the epoch and writes a second
-- receipt; it never writes a second row. Never granted to a browser role.
-- The gate is the EXECUTE grant alone: jarvis_is_server() is always true
-- inside a SECURITY DEFINER body (0044 says so), so the first line below
-- refuses nothing by itself. The only roles that may execute this function
-- are the SQL editor (postgres, the owner) and service_role; anon and
-- authenticated are revoked and a call from either is 42501 before the body
-- runs (inbox.sh checks 2 and 3).
create or replace function vyzn_app_connect(p_owner uuid, p_app text, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c agent_connection%rowtype;
  display text;
  epoch integer;
  v jsonb;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  if p_owner is null then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'owner'); end if;
  if p_app is null or not (p_app = any(jarvis_vyzn_apps())) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'app'); end if;
  if p_token_hash is null or length(p_token_hash) not between 1 and 128 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'token_hash'); end if;
  display := case p_app when 'backend-inbox' then 'Backend Inbox' when 'bridge' then 'Bridge' else 'Tucci' end;
  select * into c from agent_connection where owner_id = p_owner and provider_key = p_app and status <> 'revoked' order by created_at limit 1 for update;
  if not found then
    insert into agent_connection (owner_id, provider_key, display_name, status, transport, verified_capabilities, capability_verified_at, mode)
    values (p_owner, p_app, display, 'connected', 'https', '{propose}', now(), 'help_me')
    returning * into c;
    epoch := c.auth_epoch;
  else
    -- A rotation: the next epoch, so the receipt's key is new and an old token is gone.
    update agent_connection set auth_epoch = auth_epoch + 1 where id = c.id returning auth_epoch into epoch;
  end if;
  v := agent_connection_verify(p_owner, c.id, p_token_hash, '{propose}', p_app);
  if v ? 'error' then return v; end if;
  perform jarvis_record(p_owner, 'connect_app', 'user', null, 'Connected · ' || c.display_name, 'system', 'confirmed',
                        encode(sha256(convert_to(p_app, 'UTF8')), 'hex'), 'connect:' || c.id::text || ':' || epoch::text, c.display_name, 'verified_jarvis');
  return jsonb_build_object('connection_id', c.id, 'status', 'connected', 'auth_epoch', epoch);
end;
$$;
revoke all on function vyzn_app_connect(uuid, text, text) from public, anon, authenticated;
grant execute on function vyzn_app_connect(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. jarvis_capture_valid: the 0046 body with two new branches, note and
--    person, in the module writers' own shapes (NotesService.insertNote,
--    people/importMatch.draftFrom). A bill is never a note or a person either.
-- ---------------------------------------------------------------------------
create or replace function jarvis_capture_valid(p_kind text, p_entity_type text, p_data jsonb)
returns text
language plpgsql
immutable
set search_path = public
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
  elsif p_kind = 'note' then
    -- NotesService.insertNote: { title, category, blocks, connections }. A note says something: a title
    -- of 1 to 200 characters, or at least one block.
    if p_entity_type <> 'note' then return 'destination'; end if;
    if not (coalesce(length(trim(p_data ->> 'title')), 0) between 1 and 200
            or (jsonb_typeof(p_data -> 'blocks') = 'array' and jsonb_array_length(p_data -> 'blocks') > 0)) then return 'title'; end if;
    if p_data ? 'bill' or p_data ? 'amount' or p_data ? 'amountCents' or p_data ? 'vendor' then return 'bill_is_not_a_note'; end if;
    return null;
  elsif p_kind = 'person' then
    -- people/importMatch.draftFrom: { name, group, triageState, source, email?, phone?, ... }.
    if p_entity_type <> 'person' then return 'destination'; end if;
    if coalesce(length(trim(p_data ->> 'name')), 0) not between 1 and 120 then return 'name'; end if;
    if p_data ? 'email' and jsonb_typeof(p_data -> 'email') <> 'null' and not jarvis_address_ok(btrim(p_data ->> 'email')) then return 'email'; end if;
    if p_data ? 'phone' and jsonb_typeof(p_data -> 'phone') <> 'null' and coalesce(length(p_data ->> 'phone'), 0) > 40 then return 'phone'; end if;
    if p_data ? 'bill' or p_data ? 'amount' or p_data ? 'amountCents' or p_data ? 'vendor' then return 'bill_is_not_a_person'; end if;
    return null;
  end if;
  return 'kind';
end;
$$;
revoke all on function jarvis_capture_valid(text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Ingest: the one body behind record_push and records_import.
-- ---------------------------------------------------------------------------
--
-- Two passes. The first validates every record and checks every idempotency
-- key, writing nothing, so a batch is refused whole or not at all. The second
-- writes per record and answers per record. One arrival receipt per call that
-- wrote anything; a whole batch replay finds that receipt and writes no second.
create or replace function jarvis_records_ingest(p_owner uuid, p_connection uuid, p_source_app text, p_records jsonb, p_created_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c agent_connection%rowtype;
  display text;
  n integer;
  rec jsonb;
  sid text;
  rev integer;
  rkind text;
  rdata jsonb;
  src jsonb;
  cat timestamptz;
  ckey text;
  idem text;
  h text;
  existing proposal%rowtype;
  seen text[] := '{}';
  results jsonb := '[]'::jsonb;
  wrote integer := 0;
  item_id uuid;
  item_rev timestamptz;
  top_rev integer;
  sup integer;
  pid uuid;
  pl jsonb;
  h_batch text;
  act action%rowtype;
  aid uuid;
  actor_kind text;
  raced boolean;
begin
  if p_owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_source_app is null or not (p_source_app = any(jarvis_vyzn_apps())) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'source_app'); end if;
  if p_connection is not null then
    select * into c from agent_connection where id = p_connection and owner_id = p_owner;
    if not found or c.provider_key <> p_source_app then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'source_app'); end if;
    display := c.display_name;
  end if;
  display := coalesce(display, case p_source_app when 'backend-inbox' then 'Backend Inbox' when 'bridge' then 'Bridge' else 'Tucci' end);
  actor_kind := case when p_connection is not null then 'agent' else 'user' end;

  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) not between 1 and 50 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'records'); end if;
  if octet_length(p_records::text) > 262144 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'records'); end if;
  n := jsonb_array_length(p_records);

  -- First pass: the shape of every record, and every idempotency key. No writes.
  for rec in select * from jsonb_array_elements(p_records) loop
    if jsonb_typeof(rec) <> 'object' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'record'); end if;
    sid := rec ->> 'source_record_id';
    if not jarvis_payload_clean(rec) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'authority', 'source_record_id', sid); end if;
    if exists (select 1 from jsonb_object_keys(rec) k where k not in ('source_record_id', 'revision', 'kind', 'data', 'source', 'client_at')) then
      return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'record', 'source_record_id', sid);
    end if;
    if sid is null or sid !~ '^[A-Za-z0-9._:-]{1,128}$' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'source_record_id', 'source_record_id', sid); end if;
    if sid = any(seen) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'duplicate', 'source_record_id', sid); end if;
    seen := seen || sid;
    if jsonb_typeof(rec -> 'revision') <> 'number' or (rec ->> 'revision') !~ '^[0-9]{1,10}$' or (rec ->> 'revision')::bigint not between 1 and 2147483647 then
      return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'revision', 'source_record_id', sid);
    end if;
    rkind := rec ->> 'kind';
    if rkind is null or rkind not in ('task', 'event', 'note', 'person') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'kind', 'source_record_id', sid); end if;
    rdata := rec -> 'data';
    if jsonb_typeof(rdata) <> 'object' or octet_length(rdata::text) > 8192 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'data', 'source_record_id', sid); end if;
    if not jarvis_payload_clean(rdata) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'authority', 'source_record_id', sid); end if;
    -- Words the server would believe: the destination, the identity and the stamp are the server's alone.
    -- Top level of data only, and that is enough: record_approve reads nothing authoritative from
    -- payload.data (only the per field diff and the excerpt text); the item's data comes from p_prepared,
    -- which the person's own adapter built, with clientId and source overwritten by the server. A nested
    -- previous_item or destination_id is inert text.
    if rdata ?| array['previous_item', 'destination_id', 'clientId', 'source'] then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'data', 'source_record_id', sid); end if;
    if rec ? 'source' and jsonb_typeof(rec -> 'source') <> 'null' then
      src := rec -> 'source';
      if jsonb_typeof(src) <> 'object'
         or exists (select 1 from jsonb_object_keys(src) k where k not in ('url', 'label'))
         or (src ? 'url' and (jsonb_typeof(src -> 'url') <> 'string' or length(src ->> 'url') > 512))
         or (src ? 'label' and (jsonb_typeof(src -> 'label') <> 'string' or length(src ->> 'label') > 120)) then
        return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'source', 'source_record_id', sid);
      end if;
    end if;
    if rec ? 'client_at' and jsonb_typeof(rec -> 'client_at') <> 'null' then
      if jsonb_typeof(rec -> 'client_at') <> 'string' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'client_at', 'source_record_id', sid); end if;
      begin
        cat := (rec ->> 'client_at')::timestamptz;
      exception when others then
        return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'client_at', 'source_record_id', sid);
      end;
      -- A moment, not a word: finite, and no later than a day past this clock (record_approve turns it into epoch milliseconds).
      if cat is null or not isfinite(cat) or cat > now() + interval '1 day' then
        return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'client_at', 'source_record_id', sid);
      end if;
    end if;
    ckey := p_source_app || ':' || sid;
    idem := ckey || ':' || (rec ->> 'revision');
    h := encode(sha256(convert_to(rec::text, 'UTF8')), 'hex');
    select * into existing from proposal where owner_id = p_owner and idempotency_key = idem;
    if found and existing.payload_hash <> h then return jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT', 'source_record_id', sid); end if;
  end loop;

  -- Second pass: per record. The whole pass is one subtransaction: a concurrent push that landed the
  -- same key with other bytes between the two passes refuses this batch whole, and every write of this
  -- pass is rolled back with it (review fix 3).
  begin
  for rec in select * from jsonb_array_elements(p_records) loop
    sid := rec ->> 'source_record_id';
    rev := (rec ->> 'revision')::integer;
    rkind := rec ->> 'kind';
    rdata := rec -> 'data';
    src := case when rec ? 'source' and jsonb_typeof(rec -> 'source') = 'object' then rec -> 'source' end;
    ckey := p_source_app || ':' || sid;
    idem := ckey || ':' || rev::text;
    h := encode(sha256(convert_to(rec::text, 'UTF8')), 'hex');
    pl := jsonb_build_object('kind', rkind, 'data', rdata, 'source_app', p_source_app, 'source_record_id', sid, 'client_id', ckey, 'revision', rev,
                                  'source', src, 'client_at', case when rec ? 'client_at' and jsonb_typeof(rec -> 'client_at') = 'string' then rec -> 'client_at' end);

    select * into existing from proposal where owner_id = p_owner and idempotency_key = idem;
    if found then
      results := results || jsonb_build_object('source_record_id', sid, 'revision', rev, 'outcome', 'replay', 'proposal_id', existing.id, 'status', existing.status);
      continue;
    end if;

    item_id := null;
    select i.id, i.updated_at into item_id, item_rev from item i where i.owner_id = p_owner and i.data ->> 'clientId' = ckey limit 1;
    raced := false;
    if item_id is not null then
      -- The record is saved. At or below the highest accepted revision: nothing to do. Above it: a proposal
      -- that names the item it would change, which record_approve refuses; the item is never touched here.
      select coalesce(max((p.payload ->> 'revision')::integer), 0) into top_rev
        from proposal p where p.owner_id = p_owner and p.surface = 'app' and p.status = 'accepted' and p.payload ->> 'client_id' = ckey;
      if rev <= top_rev then
        results := results || jsonb_build_object('source_record_id', sid, 'revision', rev, 'outcome', 'already_saved', 'item_id', item_id);
        continue;
      end if;
      begin
        insert into proposal (owner_id, job_id, agent_id, surface, type, payload, payload_hash, created_by, origin_taint, idempotency_key)
        values (p_owner, null, p_connection, 'app', 'capture', pl || jsonb_build_object('previous_item', item_id, 'previous_updated_at', item_rev), h, p_created_by, 'untrusted_suggestion', idem)
        returning id into pid;
      exception when unique_violation then
        raced := true;
      end;
      if not raced then
        wrote := wrote + 1;
        results := results || jsonb_build_object('source_record_id', sid, 'revision', rev, 'outcome', 'newer_revision_proposed', 'proposal_id', pid, 'item_id', item_id);
        continue;
      end if;
    else
      begin
        -- No item. Older open revisions of the same record step aside so a stale one can never be approved first.
        update proposal set status = 'superseded'
         where owner_id = p_owner and surface = 'app' and status = 'proposed' and payload ->> 'client_id' = ckey and (payload ->> 'revision')::integer < rev;
        get diagnostics sup = row_count;
        insert into proposal (owner_id, job_id, agent_id, surface, type, payload, payload_hash, created_by, origin_taint, idempotency_key)
        values (p_owner, null, p_connection, 'app', 'capture', pl, h, p_created_by, 'untrusted_suggestion', idem)
        returning id into pid;
      exception when unique_violation then
        raced := true;
      end;
      if not raced then
        wrote := wrote + 1;
        results := results || jsonb_build_object('source_record_id', sid, 'revision', rev, 'outcome', 'proposed', 'proposal_id', pid, 'superseded', sup);
        continue;
      end if;
    end if;

    -- A concurrent push committed this key (proposal_idempotency_idx) after the first pass looked. The same
    -- bytes are a replay of that row; other bytes refuse the batch whole, through the handler below.
    select * into existing from proposal where owner_id = p_owner and idempotency_key = idem;
    if not found or existing.payload_hash <> h then
      raise exception using errcode = 'JV001', message = sid;
    end if;
    results := results || jsonb_build_object('source_record_id', sid, 'revision', rev, 'outcome', 'replay', 'proposal_id', existing.id, 'status', existing.status);
  end loop;
  exception when sqlstate 'JV001' then
    return jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT', 'source_record_id', sqlerrm);
  end;

  -- One arrival receipt per batch that wrote anything; a whole replay finds the first. A concurrent
  -- identical batch that committed first holds the receipt's key: its receipt is the answer.
  h_batch := encode(sha256(convert_to(p_records::text, 'UTF8')), 'hex');
  select * into act from action where owner_id = p_owner and idempotency_key = 'records:' || h_batch;
  if found then
    aid := act.id;
  elsif wrote > 0 then
    begin
      aid := jarvis_record(p_owner, 'record_push', actor_kind, p_connection,
                           left(format('Received %s %s From %s', wrote, case wrote when 1 then 'Record' else 'Records' end, display), 200),
                           'system', 'confirmed', h_batch, 'records:' || h_batch, display, 'verified_jarvis');
    exception when unique_violation then
      select id into aid from action where owner_id = p_owner and idempotency_key = 'records:' || h_batch;
    end;
  end if;
  return jsonb_build_object('received', n, 'written', wrote, 'results', results,
                            'receipt_id', (select id from receipt_event where action_id = aid order by sequence limit 1),
                            'replay', wrote = 0);
end;
$$;
revoke all on function jarvis_records_ingest(uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- The gateway method record.push. Service request only (the request's own
-- role, never current_user: a signed in caller cannot take the server's path
-- by naming an owner). The connection must be the owner's, connected,
-- verified to propose, not read only, and an app. No jarvis_ai_switch call.
create or replace function record_push(p_owner uuid, p_connection uuid, p_source_app text, p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c agent_connection%rowtype;
begin
  if not jarvis_is_service_request() then raise exception 'server only' using errcode = '42501'; end if;
  select * into c from agent_connection where id = p_connection and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if c.status = 'revoked' then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
  if c.status <> 'connected' then return jsonb_build_object('error', 'SCOPE_DENIED', 'detail', 'not connected'); end if;
  if not ('propose' = any(c.verified_capabilities)) then return jsonb_build_object('error', 'CAPABILITY_UNVERIFIED'); end if;
  if c.mode = 'read_only' then return jsonb_build_object('error', 'SCOPE_DENIED', 'detail', 'read only'); end if;
  if not (c.provider_key = any(jarvis_vyzn_apps())) then return jsonb_build_object('error', 'SCOPE_DENIED', 'detail', 'not an app'); end if;
  return jarvis_records_ingest(p_owner, c.id, p_source_app, p_records, 'agent');
end;
$$;
revoke all on function record_push(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function record_push(uuid, uuid, text, jsonb) to service_role;

-- The person's own pull (the backend inbox leg): owner from auth.uid(), the
-- app's connected connection when one exists (so the writer is credited),
-- else null (nothing identifies the writer; the receipt reads You). No
-- jarvis_ai_switch call.
create or replace function records_import(p_source_app text, p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  conn uuid;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_source_app is null or not (p_source_app = any(jarvis_vyzn_apps())) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'source_app'); end if;
  select id into conn from agent_connection where owner_id = owner and provider_key = p_source_app and status = 'connected' order by created_at limit 1;
  return jarvis_records_ingest(owner, conn, p_source_app, p_records, 'import');
end;
$$;
revoke all on function records_import(text, jsonb) from public, anon;
grant execute on function records_import(text, jsonb) to authenticated;

-- The one read of the inbox: the owner's open app proposals, newest first.
-- Security invoker, so the proposal policy scopes every row.
create or replace function vyzn_inbox(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  return jsonb_build_object('rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'revision', p.revision, 'record_revision', (p.payload ->> 'revision')::integer,
             'source_app', p.payload ->> 'source_app', 'source_record_id', p.payload ->> 'source_record_id', 'client_id', p.payload ->> 'client_id',
             'kind', p.payload ->> 'kind', 'data', p.payload -> 'data', 'source', p.payload -> 'source', 'client_at', p.payload -> 'client_at',
             'previous_item', p.payload -> 'previous_item', 'agent_id', p.agent_id, 'created_by', p.created_by, 'created_at', p.created_at,
             'payload_hash', p.payload_hash) order by p.created_at desc, p.id desc), '[]'::jsonb)
      from (select * from proposal where owner_id = owner and surface = 'app' and status = 'proposed' order by created_at desc, id desc limit lim) p),
    'count', (select count(*) from proposal where owner_id = owner and surface = 'app' and status = 'proposed'));
end;
$$;
revoke all on function vyzn_inbox(integer) from public, anon;
grant execute on function vyzn_inbox(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The person's tap: approve and dismiss.
-- ---------------------------------------------------------------------------
--
-- capture_approve's order (0046) minus the mail. p_prepared is what the
-- destination adapter prepared: { destination_kind, data, exact_effect,
-- display_summary, module_version }. Two keys of its data are overwritten
-- whatever the adapter sent: clientId is the record's key and source is the
-- app stamp, so the row's identity and provenance are the server's. A payload
-- carrying previous_item is DESTINATION_CHANGED and nothing is written.
create or replace function record_approve(p_proposal uuid, p_expected_revision integer, p_shown_payload_hash text, p_idempotency_key text, p_prepared jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  p proposal%rowtype;
  existing action%rowtype;
  prev item%rowtype;
  kind text;
  client_id text;
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
  cat timestamptz;
  idem text;
  place text;
  diff jsonb;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'idempotency_key'); end if;
  if jsonb_typeof(p_prepared) <> 'object' or length(p_prepared::text) > 32768 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'prepared'); end if;
  if p_shown_payload_hash is null or length(p_shown_payload_hash) not between 1 and 128 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'payload_hash'); end if;
  if p_expected_revision is null then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'expected_revision'); end if;

  select * into p from proposal where id = p_proposal and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if p.surface <> 'app' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'surface'); end if;
  kind := p.payload ->> 'kind';
  client_id := p.payload ->> 'client_id';
  -- One key per approval attempt: an undone approval keeps its key, so the count of record_% actions this
  -- proposal already has makes the next tap's key new (review fix 1). Replays are found by proposal, below.
  idem := 'record:' || p.id::text || ':' || coalesce(p.payload ->> 'revision', '0') || ':'
          || (select count(*) from action a where a.owner_id = owner and a.proposal_id = p.id and a.kind like 'record\_%')::text;

  if p.status = 'accepted' then
    -- Already landed, by this device or another. The same hash is the first tap's answer; a different
    -- hash means this device was looking at an older row than the one that was approved. The latest
    -- record_% action of this proposal is the approval that stands (an undone one is older).
    select a.* into existing from action a where a.owner_id = owner and a.proposal_id = p.id and a.kind like 'record\_%' order by a.created_at desc, a.id desc limit 1;
    if not found then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'accepted'); end if;
    if existing.payload_hash <> p_shown_payload_hash then
      return jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT', 'action_id', existing.id, 'destination_id', existing.destination_id);
    end if;
    return jarvis_action_replay(existing);
  end if;
  if p.status in ('dismissed', 'superseded', 'stale') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', p.status); end if;
  if p.revision <> p_expected_revision or p.payload_hash <> p_shown_payload_hash then
    return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', p.revision, 'payload_hash', p.payload_hash);
  end if;

  -- The structural never overwrite: a newer revision of a saved record names the item it would change,
  -- and the answer is the difference, field by field. Nothing is written. When the named item is gone
  -- (the earlier approval was undone) the row that holds the record's key, if any, is the one it would
  -- change; when none does and no later revision was accepted, nothing stands in the way and the tap
  -- creates the item below (review fix 4).
  if p.payload ? 'previous_item' then
    select * into prev from item where id = (p.payload ->> 'previous_item')::uuid and owner_id = owner;
    if prev.id is null then
      select * into prev from item i where i.owner_id = owner and i.data ->> 'clientId' = client_id limit 1;
    end if;
    if prev.id is not null
       or exists (select 1 from proposal q where q.owner_id = owner and q.surface = 'app' and q.status = 'accepted'
                    and q.payload ->> 'client_id' = client_id and (q.payload ->> 'revision')::integer > (p.payload ->> 'revision')::integer) then
      select coalesce(jsonb_agg(jsonb_build_object('field', kv.k, 'yours', prev.data -> kv.k, 'theirs', kv.v) order by kv.k), '[]'::jsonb) into diff
        from jsonb_each(p.payload -> 'data') as kv(k, v)
       where prev.id is null or (prev.data -> kv.k) is distinct from kv.v;
      return jsonb_build_object('error', 'DESTINATION_CHANGED', 'item_id', coalesce(to_jsonb(prev.id), p.payload -> 'previous_item'), 'item_updated_at', prev.updated_at, 'difference', diff,
                                'detail', case when prev.id is null then 'Item removed' else 'newer revision' end);
    end if;
  end if;

  dest_kind := p_prepared ->> 'destination_kind';
  if dest_kind is null or not exists (select 1 from entity_type where key = dest_kind) then return jsonb_build_object('error', 'MODULE_UNAVAILABLE', 'destination', dest_kind); end if;
  if dest_kind <> kind then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'destination'); end if;
  if jsonb_typeof(p_prepared -> 'data') <> 'object' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'data'); end if;
  -- The stamp's moment: the record's client_at (ingest admits only a finite one, at most a day ahead),
  -- else the approval moment; an unreadable or infinite value can never reach the epoch arithmetic.
  begin
    cat := nullif(p.payload ->> 'client_at', '')::timestamptz;
  exception when others then
    cat := null;
  end;
  if cat is null or not isfinite(cat) then cat := now(); end if;
  cap_data := (p_prepared -> 'data') - 'source'
              || jsonb_build_object('clientId', client_id,
                                    'source', jsonb_build_object('type', 'app', 'ref', client_id, 'ts', (extract(epoch from cat) * 1000)::bigint));
  bad := jarvis_capture_valid(kind, dest_kind, cap_data);
  if bad is not null then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', jsonb_build_array(bad)); end if;

  verb := left(coalesce(p_prepared ->> 'exact_effect', ''), 200);
  summary := left(coalesce(p_prepared ->> 'display_summary', ''), 200);
  if verb = '' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'exact_effect'); end if;
  -- The writer is credited: the app's connection when one exists (push, or a pull with the row minted),
  -- the person otherwise, because nothing then identifies the writer.
  actor_kind := case when p.agent_id is not null then 'agent' else 'user' end;

  -- The record's durable key (migration 0039): the same record is one row.
  select i.id into dup from item i where i.owner_id = owner and i.data ->> 'clientId' = client_id limit 1;
  if dup is null then
    insert into item (owner_id, entity_type, data) values (owner, dest_kind, cap_data) returning id, updated_at into new_item, item_rev;
  else
    new_item := dup;
    select i.updated_at into item_rev from item i where i.id = dup;
    place := case dest_kind when 'task' then 'Tasks' when 'event' then 'Schedule' when 'note' then 'Notes' when 'person' then 'People' else 'Place' end;
    verb := left('Already in ' || place || ' · ' || summary, 200);
  end if;

  -- The evidence the record points at: the app, the record id, the text as excerpt.
  insert into source_evidence (owner_id, type, source_app, source_record_id, source_url, source_hash, excerpt)
  values (owner, 'app', p.payload ->> 'source_app', p.payload ->> 'source_record_id', p.payload -> 'source' ->> 'url', p.payload_hash,
          left(coalesce(p.payload -> 'data' ->> 'text', p.payload -> 'data' ->> 'title', p.payload -> 'data' ->> 'name', p.payload -> 'source' ->> 'label', ''), 2000))
  returning id into ev;

  insert into action (owner_id, kind, actor_kind, actor_id, initiated_by_user_id, proposal_id, verb, surface, state, payload_hash, idempotency_key, expected_revision, destination_id,
                      authorization_snapshot)
  values (owner, 'record_' || kind, actor_kind, p.agent_id, owner, p.id, verb, 'system', 'approved', p_shown_payload_hash, idem, p_expected_revision, new_item,
          jsonb_build_object('proposal', p.id, 'revision', p.revision, 'record_revision', (p.payload ->> 'revision')::integer, 'module_version', p_prepared ->> 'module_version',
                             'client_request_id', p_idempotency_key, 'created', dup is null, 'approved_by', owner, 'at', now()))
  returning id into act;

  nonce := encode(sha256(convert_to(act::text || ':' || p_shown_payload_hash || ':' || clock_timestamp()::text, 'UTF8')), 'hex');
  insert into approval (owner_id, action_id, payload_hash, source_revision, granted_at, expires_at, consumed_at, nonce)
  values (owner, act, p_shown_payload_hash, p.revision, now(), now() + interval '5 minutes', now(), nonce);

  update proposal set status = 'accepted' where id = p.id and owner_id = owner;

  select coalesce(jsonb_agg(jsonb_build_object('field', kv.k, 'before', null, 'after', kv.v)), '[]'::jsonb) into diff from jsonb_each(p.payload -> 'data') as kv(k, v);
  rid := jarvis_receipt_append(owner, act, 'confirmed', verb, actor_kind, p.agent_id, summary, 'verified_jarvis', array[ev], null, new_item, diff);

  return jsonb_build_object('action_id', act, 'state', 'confirmed', 'destination_id', new_item, 'receipt_id', rid, 'safe_message', verb,
                            'item_updated_at', item_rev, 'evidence_id', ev, 'already', dup is not null);
end;
$$;
revoke all on function record_approve(uuid, integer, text, text, jsonb) from public, anon;
grant execute on function record_approve(uuid, integer, text, text, jsonb) to authenticated;

-- proposal_dismiss's shape (0047), restricted to the app surface.
create or replace function record_dismiss(p_proposal uuid, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  pr proposal%rowtype;
  new_rev integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_expected_revision is null then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'expected_revision'); end if;
  select * into pr from proposal where id = p_proposal and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if pr.surface <> 'app' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'surface'); end if;
  if pr.status = 'dismissed' then return jsonb_build_object('proposal_id', pr.id, 'revision', pr.revision, 'status', 'dismissed', 'replay', true); end if;
  if pr.status <> 'proposed' then return jsonb_build_object('error', 'SOURCE_CHANGED', 'detail', pr.status); end if;
  if pr.revision <> p_expected_revision then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', pr.revision); end if;
  update proposal set status = 'dismissed' where id = pr.id returning revision into new_rev;
  return jsonb_build_object('proposal_id', pr.id, 'revision', new_rev, 'status', 'dismissed');
end;
$$;
revoke all on function record_dismiss(uuid, integer) from public, anon;
grant execute on function record_dismiss(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. action_undo: the 0046 body plus three stated changes. The kind filter
--    admits record_%; the place word knows Notes and People; after the
--    candidate reset the app proposal returns to proposed, so the inbox row
--    comes back exactly as it was.
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
  if not (a.kind like 'capture_%' or a.kind like 'record_%') or a.state <> 'confirmed' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'not undoable'); end if;
  if a.destination_id is null then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'Item removed'); end if;
  if coalesce(a.authorization_snapshot ->> 'created', 'true') <> 'true' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'nothing created'); end if;
  blocked := jarvis_undo_block(owner, a.destination_id, p_expected_item_updated_at);
  if blocked = 'ITEM_REMOVED' then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'Item removed'); end if;
  if blocked is not null then return jsonb_build_object('error', 'DESTINATION_CHANGED', 'detail', blocked); end if;
  select * into it from item where id = a.destination_id and owner_id = owner for update;
  place := case when it.entity_type like 'money_%' then 'Money' when it.entity_type = 'task' then 'Tasks' when it.entity_type = 'event' then 'Schedule'
                when it.entity_type = 'note' then 'Notes' when it.entity_type = 'person' then 'People' else 'Waiting' end;
  verb := left('Removed From ' || place || ' · ' || coalesce(it.data ->> 'vendor', it.data ->> 'text', it.data ->> 'title', it.data ->> 'name', ''), 200);

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
  -- And so does the inbox row.
  update proposal set status = 'proposed' where owner_id = owner and id = a.proposal_id and surface = 'app' and status = 'accepted';

  rid := jarvis_receipt_append(owner, undo, 'confirmed', verb, 'user', null, place, 'verified_jarvis', '{}', it.id, null,
                               jsonb_build_array(jsonb_build_object('field', 'item', 'before', it.entity_type, 'after', null)));
  -- The original's chain records the reversal; its own state stays what it was.
  perform jarvis_receipt_append(owner, a.id, 'confirmed', left('Undone · ' || a.verb, 200), 'user', null, place, 'verified_jarvis', '{}', it.id, null, '[]', null, null, undo);
  return jsonb_build_object('action_id', undo, 'state', 'confirmed', 'destination_id', null, 'receipt_id', rid, 'safe_message', verb, 'undone_action_id', a.id);
end;
$$;
revoke all on function action_undo(uuid, timestamptz, text) from public, anon;
grant execute on function action_undo(uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The two receipt readers: 0046 bodies plus record_% in undoable.
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
           ((a.kind like 'capture_%' or a.kind like 'record_%') and a.state = 'confirmed' and a.destination_id is not null
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
revoke all on function activity_feed(integer, timestamptz, text) from public, anon;
grant execute on function activity_feed(integer, timestamptz, text) to authenticated;

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
    'undoable', ((a.kind like 'capture_%' or a.kind like 'record_%') and a.state = 'confirmed' and a.destination_id is not null
                   and coalesce(a.authorization_snapshot ->> 'created', 'true') = 'true'
                   and not exists (select 1 from receipt_event z where z.action_id = a.id and z.reversal_action_id is not null)),
    'item_updated_at', (select updated_at from item where id = a.destination_id and owner_id = owner),
    'outbox', (select jsonb_build_object('state', o.state, 'attempt', o.attempt, 'error_code', o.error_code, 'dispatched_at', o.dispatched_at, 'provider_ack', o.provider_ack)
                 from outbox_command o where o.action_id = a.id),
    'receipts', chain, 'evidence', ev);
end;
$$;
revoke all on function receipt_detail(uuid) from public, anon;
grant execute on function receipt_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. connection_set_mode: the 0047 body plus one line. For an app the words
--    have one defined meaning: Read Only pauses pushes, Help Me accepts them,
--    Just Handle It is refused, because an app only proposes.
-- ---------------------------------------------------------------------------
create or replace function connection_set_mode(p_connection uuid, p_expected_revision integer, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  c agent_connection%rowtype;
  new_rev integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_mode not in ('read_only', 'help_me', 'just_handle_it') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'mode'); end if;
  select * into c from agent_connection where id = p_connection and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if c.status = 'revoked' then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
  if c.provider_key = any(jarvis_vyzn_apps()) and p_mode = 'just_handle_it' then return jsonb_build_object('error', 'SCOPE_DENIED', 'detail', 'an app only proposes'); end if;
  if c.revision <> p_expected_revision then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', c.revision); end if;
  update agent_connection set mode = p_mode where id = c.id returning revision into new_rev;
  perform jarvis_record(owner, 'mode_set', 'user', null, left('Set ' || c.display_name || ' to ' || case p_mode when 'read_only' then 'Read Only' when 'help_me' then 'Help Me' else 'Just Handle It' end, 200),
                        'system', 'confirmed', encode(sha256(convert_to(p_mode, 'UTF8')), 'hex'), 'mode:' || c.id::text || ':' || new_rev::text, c.display_name, 'verified_jarvis');
  return jsonb_build_object('connection_id', c.id, 'revision', new_rev, 'mode', p_mode, 'capabilities', agent_capabilities(owner, c.id) -> 'capabilities', 'unavailable', agent_capabilities(owner, c.id) -> 'unavailable');
end;
$$;
revoke all on function connection_set_mode(uuid, integer, text) from public, anon;
grant execute on function connection_set_mode(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. item_why: the 0060 body, reading the real evidence and proposal columns.
-- ---------------------------------------------------------------------------
create or replace function item_why(p_item uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  it item%rowtype;
  src jsonb;
  first_row jsonb;
  first_origin text;
  answer text;
begin
  select * into it from item where id = p_item;
  if not found then return null; end if;
  src := case when jsonb_typeof(it.data) = 'object' then it.data -> 'source' end;

  select jsonb_build_object('at', c.at, 'client_at', c.client_at, 'origin', c.origin, 'via', c.via, 'op', c.op, 'changed_keys', to_jsonb(c.changed_keys)), c.origin
    into first_row, first_origin
    from item_change c where c.owner_id = it.owner_id and c.item_id = it.id
   order by c.at, c.id limit 1;

  answer := case
    when first_row is null then 'unknown'
    when jsonb_typeof(src -> 'inferred') = 'array' and jsonb_array_length(src -> 'inferred') > 0 then 'rule'
    when src ->> 'type' in ('app', 'import', 'google_calendar', 'contacts', 'gmail', 'apple_calendar', 'apple_reminders', 'apple_health')
      or (it.entity_type = 'person' and it.data ->> 'source' = 'import')
      or (it.entity_type like 'money\_%' and it.data ->> 'source' = 'import') then 'import'
    when first_origin = 'user' then 'typed'
    else first_origin end;

  return jsonb_build_object(
    'item', jsonb_build_object('id', it.id, 'entity_type', it.entity_type, 'created_at', it.created_at, 'updated_at', it.updated_at,
                               'client_id', it.data ->> 'clientId'),
    'source', src,
    'first', first_row,
    'changes', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'op', c.op, 'at', c.at, 'client_at', c.client_at, 'origin', c.origin, 'via', c.via,
                                                   'changed_keys', to_jsonb(c.changed_keys), 'before', c.before, 'after', c.after, 'revision', c.revision,
                                                   'erased', c.erased_at is not null, 'erased_at', c.erased_at) order by c.at desc, c.id desc), '[]'::jsonb)
        from (select * from item_change where owner_id = it.owner_id and item_id = it.id order by at desc, id desc limit 50) c),
    'links_out', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', l.kind, 'path', l.path, 'target', l.target, 'to_item', l.to_item, 'to_type', l.to_type,
                                                   'gone', l.to_item is null, 'created_by', l.created_by, 'via', l.via, 'created_at', l.created_at)
                                order by l.created_at, l.id), '[]'::jsonb)
        from item_link l where l.owner_id = it.owner_id and l.from_item = it.id),
    'links_in', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', l.kind, 'path', l.path, 'from_item', l.from_item, 'from_type', l.from_type,
                                                   'created_by', l.created_by, 'created_at', l.created_at) order by l.created_at, l.id), '[]'::jsonb)
        from item_link l where l.owner_id = it.owner_id and l.to_item = it.id),
    'actions', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'state', a.state, 'verb', a.verb, 'actor_kind', a.actor_kind,
                                                   'surface', a.surface, 'created_at', a.created_at,
        'receipts', (select coalesce(jsonb_agg(jsonb_build_object('sequence', r.sequence, 'state', r.state, 'exact_verb', r.exact_verb, 'actor_kind', r.actor_kind,
                                                                  'actor_display', r.actor_display, 'assurance', r.assurance, 'occurred_at', r.occurred_at,
                                                                  'diff', r.diff, 'evidence_refs', to_jsonb(r.evidence_refs), 'erased_at', r.erased_at)
                                               order by r.sequence), '[]'::jsonb)
                       from receipt_event r where r.owner_id = a.owner_id and r.action_id = a.id)) order by a.created_at, a.id), '[]'::jsonb)
        from action a where a.owner_id = it.owner_id and a.destination_id = it.id),
    'evidence', (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'source_app', e.source_app, 'source_record_id', e.source_record_id,
                                                   'availability', e.availability, 'captured_at', e.captured_at, 'excerpt', e.excerpt) order by e.captured_at, e.id), '[]'::jsonb)
        from source_evidence e
       where e.owner_id = it.owner_id
         and e.id in (select unnest(r.evidence_refs) from receipt_event r join action a on a.id = r.action_id and a.owner_id = r.owner_id
                       where a.owner_id = it.owner_id and a.destination_id = it.id)),
    'proposals', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'status', p.status, 'created_by', p.created_by, 'revision', p.revision,
                                                   'source_app', p.payload ->> 'source_app', 'created_at', p.created_at) order by p.created_at, p.id), '[]'::jsonb)
        from proposal p
       where p.owner_id = it.owner_id and it.data ->> 'clientId' is not null and p.payload ->> 'client_id' = it.data ->> 'clientId'),
    'answer', answer);
end;
$$;
revoke all on function item_why(uuid) from public, anon, authenticated;
grant execute on function item_why(uuid) to authenticated, service_role;

-- substrate_readiness (0060) probes `to_regprocedure('public.record_push(uuid, uuid, text, jsonb)')`
-- for phase0.inbox, so it reads true from here on with no change to its body. delete_owned: no change
-- (proposal, action, receipt_event and source_evidence are already in its list).
