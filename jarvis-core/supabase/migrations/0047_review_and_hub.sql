-- Migration 0047: durable decision review and the Hub's reads, slice 04 of
-- the unified substrate (2026-10-03). IMPLEMENTATION-SPEC.md sections 06
-- (review and durable decisions), 09 (H1 to H7), 14 (saveDecision,
-- replaceDecision, withdrawDecision, keepExploration, setMode, getHub).
--
-- A decision is an item of kind decision_record (the Decisions module reads
-- it as it always did) with its durable, versioned statement in
-- decision_version and its explicit dependencies in decision_dependency.
-- Exploration -> proposal -> commitment is one way and explicit: nothing an
-- assistant says, and nothing parsed from mail, becomes a decision until the
-- person saves it, and a saved decision is only ever superseded or withdrawn
-- by a versioned event, never erased. Every write here is one transaction
-- with its receipt.
--
-- Additive. Rollback: supabase/rollback/0047_review_and_hub_down.sql.

-- A system-made suggestion (a dependency that changed) has its own author.
alter table proposal drop constraint if exists proposal_created_by_check;
alter table proposal add constraint proposal_created_by_check check (created_by in ('agent', 'import', 'user', 'system'));

-- ---------------------------------------------------------------------------
-- 1. Helpers.
-- ---------------------------------------------------------------------------

-- The constraints a decision carries: [{key, value}] pairs. Two active
-- decisions in one project that give the same key different values conflict.
create or replace function jarvis_decision_conflicts(p_owner uuid, p_project uuid, p_constraints jsonb, p_except_item uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object('item_id', v.item_id, 'version_id', v.id, 'title', v.title, 'statement', v.statement, 'key', mine.key, 'theirs', theirs.value, 'mine', mine.value)), '[]'::jsonb)
    from decision_version v
    join item i on i.id = v.item_id and i.owner_id = p_owner
    cross join lateral jsonb_to_recordset(case when jsonb_typeof(p_constraints) = 'array' then p_constraints else '[]'::jsonb end) as mine(key text, value text)
    cross join lateral jsonb_to_recordset(v.constraints) as theirs(key text, value text)
   where v.owner_id = p_owner and v.status = 'active'
     and (p_except_item is null or v.item_id <> p_except_item)
     and (i.data -> 'links') @> jsonb_build_array(jsonb_build_object('type', 'project', 'id', p_project::text))
     and theirs.key = mine.key and theirs.value is distinct from mine.value;
$$;

-- A dependency edge: {item_id, kind}. Every id must be the owner's; a
-- decision may not depend on itself; a cycle through depends_on is refused.
create or replace function jarvis_dependency_cycle(p_owner uuid, p_from_item uuid, p_refs jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found_cycle boolean := false;
begin
  -- Walk depends_on edges from each new target; reaching p_from_item is a cycle.
  with recursive reach(item_id, depth) as (
    select (r ->> 'item_id')::uuid, 1 from jsonb_array_elements(p_refs) r where coalesce(r ->> 'kind', 'depends_on') = 'depends_on'
    union
    select d.to_item_id, reach.depth + 1
      from reach
      join decision_version v on v.item_id = reach.item_id and v.status = 'active' and v.owner_id = p_owner
      join decision_dependency d on d.from_version_id = v.id and d.kind = 'depends_on' and d.status <> 'missing'
     where reach.depth < 50
  )
  select exists (select 1 from reach where item_id = p_from_item) into found_cycle;
  return found_cycle;
end;
$$;

-- Validate the refs and write the edges for a version.
create or replace function jarvis_dependencies_write(p_owner uuid, p_version uuid, p_refs jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  tid uuid;
  k text;
  n integer := 0;
  upd timestamptz;
begin
  if p_refs is null then return null; end if;
  if jsonb_typeof(p_refs) <> 'array' then return 'dependencies'; end if;
  if jsonb_array_length(p_refs) > 20 then return 'dependencies'; end if;
  for r in select * from jsonb_array_elements(p_refs) loop
    if jsonb_typeof(r) <> 'object' or (r ->> 'item_id') !~ '^[0-9a-f-]{36}$' then return 'dependencies'; end if;
    k := coalesce(r ->> 'kind', 'depends_on');
    if k not in ('depends_on', 'blocked_by', 'informed_by') then return 'dependencies'; end if;
    tid := (r ->> 'item_id')::uuid;
    select updated_at into upd from item where id = tid and owner_id = p_owner;
    if not found then return 'dependencies'; end if;
    insert into decision_dependency (owner_id, from_version_id, to_item_id, expected_item_updated_at, kind, status)
    values (p_owner, p_version, tid, upd, k, 'current')
    on conflict (from_version_id, to_item_id, kind) do nothing;
    n := n + 1;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. saveDecision (06): a durable decision from a proposal or from the
--    person's own words. Statement and rationale required; source may be
--    "Entered by you"; dependencies are real ids; conflict with an active
--    decision in the project is named and blocks unless p_replace_item is
--    given (then it is a Replace in the same transaction).
-- ---------------------------------------------------------------------------
create or replace function decision_save(
  p_project uuid, p_title text, p_statement text, p_rationale text,
  p_alternatives text[] default '{}', p_constraints jsonb default '[]', p_dependencies jsonb default '[]',
  p_evidence uuid[] default '{}', p_source jsonb default null, p_proposal uuid default null, p_expected_proposal_revision integer default null,
  p_replace_item uuid default null, p_client_request_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  proj item%rowtype;
  pr proposal%rowtype;
  conflicts jsonb;
  dec_item uuid;
  ver uuid;
  old_ver decision_version%rowtype;
  bad text;
  act uuid;
  rid uuid;
  verb text;
  now_iso text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  src jsonb;
  actor_kind text := 'user';
  actor_id uuid;
  existing action%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if coalesce(length(trim(p_statement)), 0) not between 1 and 500 then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', jsonb_build_array('statement')); end if;
  if coalesce(length(trim(p_rationale)), 0) not between 1 and 4000 then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', jsonb_build_array('rationale')); end if;
  if coalesce(length(trim(p_title)), 0) not between 1 and 200 then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', jsonb_build_array('title')); end if;
  if jsonb_typeof(coalesce(p_constraints, '[]'::jsonb)) <> 'array' or cardinality(coalesce(p_evidence, '{}')) > 20 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  select * into proj from item where id = p_project and owner_id = owner and entity_type = 'project';
  if not found then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'project'); end if;
  if exists (select 1 from unnest(coalesce(p_evidence, '{}')) e where not exists (select 1 from source_evidence s where s.id = e and s.owner_id = owner)) then
    return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'evidence');
  end if;

  if p_proposal is not null then
    select * into pr from proposal where id = p_proposal and owner_id = owner for update;
    if not found then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'proposal'); end if;
    -- One proposal becomes one decision: a second Save answers with the first.
    select * into existing from action where owner_id = owner and idempotency_key = 'decision:proposal:' || pr.id::text;
    if found then return jarvis_action_replay(existing); end if;
    if pr.status <> 'proposed' then return jsonb_build_object('error', 'SOURCE_CHANGED', 'detail', pr.status); end if;
    if p_expected_proposal_revision is not null and pr.revision <> p_expected_proposal_revision then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', pr.revision); end if;
    if pr.surface <> 'project' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'surface'); end if;
    if pr.agent_id is not null then actor_kind := 'agent'; actor_id := pr.agent_id; end if;
  end if;

  if p_replace_item is not null then
    select * into old_ver from decision_version where item_id = p_replace_item and owner_id = owner and status = 'active' for update;
    if not found then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'replace'); end if;
  end if;

  conflicts := jarvis_decision_conflicts(owner, p_project, coalesce(p_constraints, '[]'::jsonb), p_replace_item);
  if jsonb_array_length(conflicts) > 0 then
    return jsonb_build_object('error', 'DESTINATION_CHANGED', 'detail', 'conflict', 'conflicts', conflicts);
  end if;

  src := coalesce(p_source, jsonb_build_object('kind', 'manual', 'at', now_iso));
  if (src ->> 'kind') not in ('chat', 'note', 'email', 'manual') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'source'); end if;

  if p_replace_item is null then
    insert into item (owner_id, entity_type, data) values (owner, 'decision_record', jsonb_build_object(
      'decision', trim(p_statement), 'why', trim(p_rationale), 'ruledOut', to_jsonb(coalesce(p_alternatives, '{}')),
      'links', jsonb_build_array(jsonb_build_object('type', 'project', 'id', p_project::text, 'label', coalesce(proj.data ->> 'title', ''))),
      'linkedType', 'project', 'linkedId', p_project::text, 'linkedLabel', coalesce(proj.data ->> 'title', ''),
      'source', src, 'revisitState', 'none', 'title', trim(p_title), 'createdAt', now_iso, 'updatedAt', now_iso))
    returning id into dec_item;
  else
    dec_item := p_replace_item;
  end if;

  if jarvis_dependency_cycle(owner, dec_item, coalesce(p_dependencies, '[]'::jsonb)) then
    return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'cycle');
  end if;

  if p_replace_item is not null then
    update decision_version set status = 'superseded' where id = old_ver.id;
    update item set data = data || jsonb_build_object('decision', trim(p_statement), 'why', trim(p_rationale), 'ruledOut', to_jsonb(coalesce(p_alternatives, '{}')), 'title', trim(p_title), 'updatedAt', now_iso)
     where id = dec_item and owner_id = owner;
  end if;

  insert into decision_version (owner_id, item_id, version, title, statement, rationale, alternatives, constraints, dependency_refs, evidence_refs, committed_by, status, supersedes_version_id)
  values (owner, dec_item, coalesce((select max(dv.version) from decision_version dv where dv.item_id = dec_item and dv.owner_id = owner), 0) + 1,
          trim(p_title), trim(p_statement), trim(p_rationale), coalesce(p_alternatives, '{}'), coalesce(p_constraints, '[]'::jsonb), coalesce(p_dependencies, '[]'::jsonb),
          coalesce(p_evidence, '{}'), owner, 'active', old_ver.id)
  returning id into ver;

  bad := jarvis_dependencies_write(owner, ver, coalesce(p_dependencies, '[]'::jsonb));
  if bad is not null then raise exception 'dependencies' using errcode = '22023', detail = bad; end if;

  if p_proposal is not null then update proposal set status = 'accepted' where id = pr.id; end if;

  verb := left(case when p_replace_item is null then 'Saved Decision · ' else 'Replaced Decision · ' end || trim(p_title), 200);
  insert into action (owner_id, kind, actor_kind, actor_id, initiated_by_user_id, proposal_id, verb, surface, state, payload_hash, idempotency_key, expected_revision, destination_id, authorization_snapshot)
  values (owner, case when p_replace_item is null then 'decision_save' else 'decision_replace' end, actor_kind, actor_id, owner, p_proposal, verb, 'project', 'approved',
          encode(sha256(convert_to(trim(p_statement) || '|' || trim(p_rationale), 'UTF8')), 'hex'),
          case when p_proposal is not null then 'decision:proposal:' || pr.id::text else 'decision:' || ver::text end,
          p_expected_proposal_revision, dec_item,
          jsonb_build_object('project', p_project, 'version', ver, 'client_request_id', p_client_request_id, 'approved_by', owner, 'at', now()))
  returning id into act;
  rid := jarvis_receipt_append(owner, act, 'confirmed', verb, actor_kind, actor_id, coalesce(proj.data ->> 'title', ''), 'verified_jarvis', coalesce(p_evidence, '{}'),
                               old_ver.id, ver,
                               case when old_ver.id is null then jsonb_build_array(jsonb_build_object('field', 'statement', 'before', null, 'after', trim(p_statement)))
                                    else jsonb_build_array(jsonb_build_object('field', 'statement', 'before', old_ver.statement, 'after', trim(p_statement)),
                                                           jsonb_build_object('field', 'rationale', 'before', old_ver.rationale, 'after', trim(p_rationale))) end);
  return jsonb_build_object('action_id', act, 'state', 'confirmed', 'destination_id', dec_item, 'receipt_id', rid, 'safe_message', verb,
                            'version_id', ver, 'version', (select version from decision_version where id = ver), 'superseded_version_id', old_ver.id);
end;
$$;

-- Withdraw: the active version becomes withdrawn with a reason; history and
-- downstream records stay. Reinstating is a new version by decision_save
-- with p_replace_item (which then supersedes nothing active and records the
-- new version).
create or replace function decision_withdraw(p_version uuid, p_expected_revision timestamptz, p_reason text, p_client_request_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  v decision_version%rowtype;
  it item%rowtype;
  act uuid;
  rid uuid;
  verb text;
  existing action%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if coalesce(length(trim(p_reason)), 0) not between 1 and 1000 then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', jsonb_build_array('reason')); end if;
  select * into existing from action where owner_id = owner and idempotency_key = 'withdraw:' || p_version::text;
  if found then return jarvis_action_replay(existing); end if;
  select * into v from decision_version where id = p_version and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if v.status <> 'active' then return jsonb_build_object('error', 'DESTINATION_CHANGED', 'detail', v.status); end if;
  select * into it from item where id = v.item_id and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'Item removed'); end if;
  if it.updated_at <> p_expected_revision then return jsonb_build_object('error', 'DESTINATION_CHANGED', 'detail', 'item'); end if;
  update decision_version set status = 'withdrawn', withdrawal_reason = trim(p_reason) where id = v.id;
  update item set data = data || jsonb_build_object('withdrawnAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'withdrawnReason', trim(p_reason), 'updatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   where id = it.id;
  verb := left('Withdrew Decision · ' || v.title, 200);
  insert into action (owner_id, kind, actor_kind, initiated_by_user_id, verb, surface, state, payload_hash, idempotency_key, destination_id, authorization_snapshot)
  values (owner, 'decision_withdraw', 'user', owner, verb, 'project', 'approved', encode(sha256(convert_to(trim(p_reason), 'UTF8')), 'hex'), 'withdraw:' || v.id::text, it.id,
          jsonb_build_object('version', v.id, 'client_request_id', p_client_request_id, 'approved_by', owner, 'at', now()))
  returning id into act;
  rid := jarvis_receipt_append(owner, act, 'confirmed', verb, 'user', null, trim(p_reason), 'verified_jarvis', '{}', v.id, null,
                               jsonb_build_array(jsonb_build_object('field', 'status', 'before', 'active', 'after', 'withdrawn')));
  return jsonb_build_object('action_id', act, 'state', 'confirmed', 'destination_id', it.id, 'receipt_id', rid, 'safe_message', verb);
end;
$$;

-- Keep as note: an exploration_note item. Never an active decision; never in
-- a constraint query. From a proposal (which closes as accepted-as-note) or
-- from pasted words.
create or replace function exploration_keep(p_project uuid, p_text text, p_evidence uuid[] default '{}', p_proposal uuid default null, p_client_request_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  proj item%rowtype;
  pr proposal%rowtype;
  note uuid;
  act uuid;
  rid uuid;
  verb text;
  existing action%rowtype;
  now_iso text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if coalesce(length(trim(p_text)), 0) not between 1 and 4000 then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', jsonb_build_array('text')); end if;
  select * into proj from item where id = p_project and owner_id = owner and entity_type = 'project';
  if not found then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'project'); end if;
  if p_proposal is not null then
    select * into pr from proposal where id = p_proposal and owner_id = owner for update;
    if not found then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'proposal'); end if;
    select * into existing from action where owner_id = owner and idempotency_key = 'note:proposal:' || pr.id::text;
    if found then return jarvis_action_replay(existing); end if;
    if pr.status <> 'proposed' then return jsonb_build_object('error', 'SOURCE_CHANGED', 'detail', pr.status); end if;
  end if;
  insert into item (owner_id, entity_type, data) values (owner, 'exploration_note', jsonb_build_object(
    'text', trim(p_text), 'projectId', p_project::text, 'projectLabel', coalesce(proj.data ->> 'title', ''), 'evidenceIds', to_jsonb(coalesce(p_evidence, '{}')),
    'proposalId', p_proposal, 'promotedDecisionId', null, 'createdAt', now_iso, 'updatedAt', now_iso))
  returning id into note;
  if p_proposal is not null then update proposal set status = 'accepted' where id = pr.id; end if;
  verb := left('Kept as Note · ' || trim(p_text), 200);
  insert into action (owner_id, kind, actor_kind, initiated_by_user_id, proposal_id, verb, surface, state, payload_hash, idempotency_key, destination_id, authorization_snapshot)
  values (owner, 'exploration_keep', 'user', owner, p_proposal, verb, 'project', 'approved', encode(sha256(convert_to(trim(p_text), 'UTF8')), 'hex'),
          case when p_proposal is not null then 'note:proposal:' || pr.id::text else 'note:' || note::text end, note,
          jsonb_build_object('project', p_project, 'client_request_id', p_client_request_id, 'approved_by', owner, 'at', now()))
  returning id into act;
  rid := jarvis_receipt_append(owner, act, 'confirmed', verb, 'user', null, coalesce(proj.data ->> 'title', ''), 'verified_jarvis', coalesce(p_evidence, '{}'), null, note);
  return jsonb_build_object('action_id', act, 'state', 'confirmed', 'destination_id', note, 'receipt_id', rid, 'safe_message', verb);
end;
$$;

-- The person moves a proposal between Decided and Mentioned, or dismisses it.
-- Classification is advisory and theirs to change; it writes no decision.
create or replace function proposal_classify(p_proposal uuid, p_expected_revision integer, p_segment text)
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
  if p_segment not in ('decided', 'mentioned') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'segment'); end if;
  select * into pr from proposal where id = p_proposal and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if pr.status <> 'proposed' then return jsonb_build_object('error', 'SOURCE_CHANGED', 'detail', pr.status); end if;
  if pr.revision <> p_expected_revision then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', pr.revision); end if;
  if pr.surface <> 'project' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'surface'); end if;
  update proposal set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('segment', p_segment) where id = pr.id returning revision into new_rev;
  return jsonb_build_object('proposal_id', pr.id, 'revision', new_rev, 'segment', p_segment);
end;
$$;

create or replace function proposal_dismiss(p_proposal uuid, p_expected_revision integer)
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
  select * into pr from proposal where id = p_proposal and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if pr.status = 'dismissed' then return jsonb_build_object('proposal_id', pr.id, 'revision', pr.revision, 'status', 'dismissed', 'replay', true); end if;
  if pr.status <> 'proposed' then return jsonb_build_object('error', 'SOURCE_CHANGED', 'detail', pr.status); end if;
  if pr.revision <> p_expected_revision then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', pr.revision); end if;
  update proposal set status = 'dismissed' where id = pr.id returning revision into new_rev;
  -- A constraint-change suggestion that was reviewed records the revision it reviewed.
  if pr.type = 'constraint_change' and pr.payload ? 'dependency_id' then
    update decision_dependency d set status = 'current', expected_item_updated_at = coalesce((select updated_at from item where id = d.to_item_id), d.expected_item_updated_at)
     where d.id = (pr.payload ->> 'dependency_id')::uuid and d.owner_id = owner;
  end if;
  return jsonb_build_object('proposal_id', pr.id, 'revision', new_rev, 'status', 'dismissed');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Dependencies that changed: a suggestion, never a rewrite. Run by the
--    person opening the Hub (the session), so nothing scans in the background.
-- ---------------------------------------------------------------------------
create or replace function decision_dependencies_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  r record;
  n integer := 0;
  touched_items uuid[] := '{}';
  act uuid;
  what text;
  by_item record;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  for r in
    select d.id, d.to_item_id, d.from_version_id, d.expected_item_updated_at, i.updated_at as now_at, i.entity_type, i.data, v.item_id as decision_item, v.title
      from decision_dependency d
      join decision_version v on v.id = d.from_version_id and v.status = 'active'
      left join item i on i.id = d.to_item_id and i.owner_id = owner
     where d.owner_id = owner and d.status = 'current'
       and (i.id is null or i.updated_at <> d.expected_item_updated_at)
     for update of d
  loop
    update decision_dependency set status = case when r.now_at is null then 'missing' else 'changed' end where id = r.id;
    if not exists (select 1 from proposal p where p.owner_id = owner and p.type = 'constraint_change' and p.status = 'proposed' and p.payload ->> 'dependency_id' = r.id::text) then
      insert into proposal (owner_id, job_id, surface, type, payload, payload_hash, created_by, origin_taint, idempotency_key)
      select owner, j.id, 'project', 'constraint_change',
             jsonb_build_object('dependency_id', r.id, 'decision_item_id', r.decision_item, 'decision_title', r.title, 'item_id', r.to_item_id, 'item_kind', r.entity_type,
                                'item_title', coalesce(r.data ->> 'title', r.data ->> 'text', r.data ->> 'vendor', ''), 'change', case when r.now_at is null then 'missing' else 'changed' end,
                                'segment', 'decided'),
             encode(sha256(convert_to(r.id::text || ':' || coalesce(r.now_at::text, 'missing'), 'UTF8')), 'hex'), 'system', 'user_entered',
             'dep:' || r.id::text || ':' || coalesce(r.now_at::text, 'missing')
        from (select id from job where owner_id = owner order by created_at limit 1) j
        on conflict (owner_id, idempotency_key) where idempotency_key is not null do nothing;
      n := n + 1;
      touched_items := array_append(touched_items, r.to_item_id);
    end if;
  end loop;
  -- One receipt per changed item: "Budget Changed · Review 2 Dependent Decisions".
  for by_item in select to_item_id, count(distinct from_version_id) as decisions from decision_dependency where owner_id = owner and to_item_id = any (touched_items) and status in ('changed', 'missing') group by to_item_id loop
    select coalesce(data ->> 'title', data ->> 'text', data ->> 'vendor', 'An Item') into what from item where id = by_item.to_item_id and owner_id = owner;
    what := coalesce(what, 'An Item');
    insert into action (owner_id, kind, actor_kind, initiated_by_user_id, verb, surface, state, payload_hash, idempotency_key, destination_id, authorization_snapshot)
    values (owner, 'dependency_changed', 'rule', owner, left(what || ' Changed · Review ' || by_item.decisions || ' Dependent Decision' || case when by_item.decisions = 1 then '' else 's' end, 200), 'project', 'confirmed',
            encode(sha256(convert_to(by_item.to_item_id::text || now()::text, 'UTF8')), 'hex'), 'depchange:' || by_item.to_item_id::text || ':' || extract(epoch from clock_timestamp())::text,
            (select id from item where id = by_item.to_item_id and owner_id = owner), jsonb_build_object('reviewed', false))
    returning id into act;
    perform jarvis_receipt_append(owner, act, 'confirmed', left(what || ' Changed · Review ' || by_item.decisions || ' Dependent Decision' || case when by_item.decisions = 1 then '' else 's' end, 200), 'rule', null, what, 'verified_jarvis');
  end loop;
  return jsonb_build_object('suggested', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The Hub's reads and the mode switch.
-- ---------------------------------------------------------------------------

-- setMode (14): the person changes an assistant's mode; the answer is the
-- effective capability summary, never a new grant.
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
  if c.revision <> p_expected_revision then return jsonb_build_object('error', 'SOURCE_CHANGED', 'revision', c.revision); end if;
  update agent_connection set mode = p_mode where id = c.id returning revision into new_rev;
  perform jarvis_record(owner, 'mode_set', 'user', null, left('Set ' || c.display_name || ' to ' || case p_mode when 'read_only' then 'Read Only' when 'help_me' then 'Help Me' else 'Just Handle It' end, 200),
                        'system', 'confirmed', encode(sha256(convert_to(p_mode, 'UTF8')), 'hex'), 'mode:' || c.id::text || ':' || new_rev::text, c.display_name, 'verified_jarvis');
  return jsonb_build_object('connection_id', c.id, 'revision', new_rev, 'mode', p_mode, 'capabilities', agent_capabilities(owner, c.id) -> 'capabilities', 'unavailable', agent_capabilities(owner, c.id) -> 'unavailable');
end;
$$;

-- The person adds a manual assistant (no token, no transport): a named row
-- that can only ever exchange context by export and import.
create or replace function connection_add_manual(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  cid uuid;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if coalesce(length(trim(p_display_name)), 0) not between 1 and 120 then return jsonb_build_object('error', 'MISSING_DETAILS', 'missing', jsonb_build_array('name')); end if;
  insert into agent_connection (owner_id, provider_key, display_name, status, transport, mode) values (owner, 'manual', trim(p_display_name), 'manual', 'manual', 'read_only') returning id into cid;
  perform jarvis_record(owner, 'connection_add', 'user', null, left('Added Assistant · ' || trim(p_display_name), 200), 'system', 'confirmed', encode(sha256(convert_to(cid::text, 'UTF8')), 'hex'), 'conn:' || cid::text, trim(p_display_name), 'verified_jarvis');
  return jsonb_build_object('connection_id', cid, 'status', 'manual');
end;
$$;

-- A job is an assistant's (or the person's own) work on one project: the
-- boundary every context preview, grant and import is scoped to. The Hub
-- opens one when the person picks a project for an assistant; an open one
-- for the same pair is reused, so a project has one job per assistant.
create or replace function job_open(p_agent uuid, p_project uuid, p_purpose text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  jid uuid;
  purpose text := left(coalesce(nullif(trim(p_purpose), ''), 'Help with this project'), 200);
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if not exists (select 1 from item where id = p_project and owner_id = owner and entity_type = 'project') then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'project'); end if;
  if p_agent is not null and not exists (select 1 from agent_connection where id = p_agent and owner_id = owner and status in ('manual', 'connected')) then return jsonb_build_object('error', 'NOT_FOUND', 'detail', 'connection'); end if;
  select id into jid from job where owner_id = owner and project_id = p_project and agent_id is not distinct from p_agent and status = 'open' order by created_at desc limit 1;
  if jid is null then
    insert into job (owner_id, agent_id, project_id, purpose, created_by) values (owner, p_agent, p_project, purpose, owner) returning id into jid;
    return jsonb_build_object('job_id', jid, 'created', true);
  end if;
  return jsonb_build_object('job_id', jid, 'created', false);
end;
$$;

-- getHub (14): one read for the three tabs. Every read below is scoped to
-- auth.uid(); definer only so the switch helper is reachable.
create or replace function hub_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  return jsonb_build_object(
    'ai', jarvis_ai_switch(owner),
    'connections', (select coalesce(jsonb_agg(row_to_json(c)::jsonb order by c.created_at), '[]'::jsonb) from (
        select a.id, a.display_name, a.provider_key, a.status, a.transport, a.mode, a.verified_capabilities, a.revision, a.last_used_at, a.revoked_at, a.created_at,
               (select count(*) from scope_grant g where g.agent_id = a.id and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())) as open_grants,
               (select coalesce(jsonb_agg(jsonb_build_object('grant_id', g.id, 'project_id', g.project_id, 'project_title', (select i.data ->> 'title' from item i where i.id = g.project_id), 'fields', g.fields, 'expires_at', g.expires_at, 'record_count', cardinality(g.resource_ids)) order by g.approved_at desc), '[]'::jsonb)
                  from scope_grant g where g.agent_id = a.id and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())) as grants,
               (select j.project_id from job j where j.agent_id = a.id and j.status = 'open' order by j.created_at desc limit 1) as project_id,
               (select i.data ->> 'title' from job j join item i on i.id = j.project_id where j.agent_id = a.id and j.status = 'open' order by j.created_at desc limit 1) as project_title
          from agent_connection a where a.owner_id = owner and a.status <> 'expired') c),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.data ->> 'title', 'status', i.data ->> 'status') order by i.data ->> 'title'), '[]'::jsonb)
                   from item i where i.owner_id = owner and i.entity_type = 'project' and coalesce(i.data ->> 'status', 'active') <> 'done'),
    'proposals', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'job_id', p.job_id, 'project_id', j.project_id, 'agent_id', p.agent_id,
                                     'agent_name', (select display_name from agent_connection where id = p.agent_id), 'type', p.type, 'payload', p.payload, 'evidence_refs', p.evidence_refs,
                                     'created_by', p.created_by, 'origin_taint', p.origin_taint, 'revision', p.revision, 'created_at', p.created_at) order by p.created_at desc), '[]'::jsonb)
                    from proposal p join job j on j.id = p.job_id where p.owner_id = owner and p.surface = 'project' and p.status = 'proposed'),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('item_id', v.item_id, 'version_id', v.id, 'version', v.version, 'title', v.title, 'statement', v.statement, 'rationale', v.rationale,
                                     'status', v.status, 'committed_at', v.committed_at, 'project_id', (select l ->> 'id' from jsonb_array_elements(coalesce(i.data -> 'links', '[]'::jsonb)) l where l ->> 'type' = 'project' limit 1),
                                     'item_updated_at', i.updated_at,
                                     'needs_review', exists (select 1 from decision_dependency d where d.from_version_id = v.id and d.status in ('changed', 'missing'))) order by v.committed_at desc), '[]'::jsonb)
                    from decision_version v join item i on i.id = v.item_id where v.owner_id = owner and v.status = 'active'),
    'email_review_count', (select count(*) from email_candidate where owner_id = owner and status in ('proposed', 'needs_details', 'conflict')),
    'exploration_notes', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'text', i.data ->> 'text', 'project_id', i.data ->> 'projectId', 'created_at', i.data ->> 'createdAt') order by i.created_at desc), '[]'::jsonb)
                            from item i where i.owner_id = owner and i.entity_type = 'exploration_note'));
end;
$$;

-- One decision's whole history: every version, its dependencies and their state.
create or replace function decision_history(p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  it item%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into it from item where id = p_item and owner_id = owner and entity_type = 'decision_record';
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  return jsonb_build_object(
    'item_id', it.id, 'item_updated_at', it.updated_at, 'data', it.data,
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('version_id', v.id, 'version', v.version, 'title', v.title, 'statement', v.statement, 'rationale', v.rationale, 'alternatives', v.alternatives,
                                    'constraints', v.constraints, 'evidence_refs', v.evidence_refs, 'status', v.status, 'committed_at', v.committed_at, 'withdrawal_reason', v.withdrawal_reason, 'supersedes_version_id', v.supersedes_version_id,
                                    'dependencies', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'item_id', d.to_item_id, 'kind', d.kind, 'status', d.status,
                                                                                                   'title', (select coalesce(x.data ->> 'title', x.data ->> 'text', x.data ->> 'vendor', '') from item x where x.id = d.to_item_id),
                                                                                                   'entity_type', (select x.entity_type from item x where x.id = d.to_item_id))), '[]'::jsonb) from decision_dependency d where d.from_version_id = v.id))
                                 order by v.version desc), '[]'::jsonb) from decision_version v where v.item_id = it.id and v.owner_id = owner),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'type', s.type, 'excerpt', s.excerpt, 'captured_at', s.captured_at, 'availability', s.availability)), '[]'::jsonb)
                   from source_evidence s where s.owner_id = owner and s.id = any (select unnest(evidence_refs) from decision_version where item_id = it.id and owner_id = owner)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants.
-- ---------------------------------------------------------------------------
revoke all on function jarvis_decision_conflicts(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function jarvis_dependency_cycle(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function jarvis_dependencies_write(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function decision_save(uuid, text, text, text, text[], jsonb, jsonb, uuid[], jsonb, uuid, integer, uuid, text) from public, anon;
revoke all on function decision_withdraw(uuid, timestamptz, text, text) from public, anon;
revoke all on function exploration_keep(uuid, text, uuid[], uuid, text) from public, anon;
revoke all on function proposal_classify(uuid, integer, text) from public, anon;
revoke all on function proposal_dismiss(uuid, integer) from public, anon;
revoke all on function decision_dependencies_check() from public, anon;
revoke all on function connection_set_mode(uuid, integer, text) from public, anon;
revoke all on function connection_add_manual(text) from public, anon;
revoke all on function job_open(uuid, uuid, text) from public, anon;
revoke all on function hub_overview() from public, anon;
revoke all on function decision_history(uuid) from public, anon;
grant execute on function decision_save(uuid, text, text, text, text[], jsonb, jsonb, uuid[], jsonb, uuid, integer, uuid, text) to authenticated;
grant execute on function decision_withdraw(uuid, timestamptz, text, text) to authenticated;
grant execute on function exploration_keep(uuid, text, uuid[], uuid, text) to authenticated;
grant execute on function proposal_classify(uuid, integer, text) to authenticated;
grant execute on function proposal_dismiss(uuid, integer) to authenticated;
grant execute on function decision_dependencies_check() to authenticated;
grant execute on function connection_set_mode(uuid, integer, text) to authenticated;
grant execute on function connection_add_manual(text) to authenticated;
grant execute on function job_open(uuid, uuid, text) to authenticated;
grant execute on function hub_overview() to authenticated;
grant execute on function decision_history(uuid) to authenticated;
