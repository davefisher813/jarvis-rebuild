-- Rollback of 0062 (the VYZN feed: the app proposal surface, record_push, records_import, record_approve).
-- Not a migration: it lives outside supabase/migrations so nothing applies it by accident.
--
-- What it does: drops the eight functions 0062 added, puts the six replaced functions back to their
-- production bodies verbatim (jarvis_capture_valid, action_undo, activity_feed and receipt_detail to 0046,
-- connection_set_mode to 0047, item_why to 0060), and narrows the two tables back ONLY where no row
-- depends on the wider shape:
--   source_evidence  the three columns STAY (the 0059 precedent: a rollback drops no data), and with them
--                    their three inline column checks (source_evidence_source_app_check,
--                    source_evidence_source_record_id_check, source_evidence_source_url_check); the index
--                    source_evidence_app_record_idx is dropped (an index is derived, not data); the type check
--                    narrows back to (email, manual, import) only when no `type = 'app'` row exists
--   proposal         the surface and payload checks tighten back and job_id regains NOT NULL only when no
--                    `surface = 'app'` row exists; otherwise every check stays as 0062 left it. The payload
--                    check comes back under the name proposal_payload_check, not 0044's auto generated
--                    proposal_check (0062 dropped that one by its definition and named its replacement);
--                    the definition is 0044's verbatim, only the name differs
--
-- Operator note: the person's inbox rows (proposal.surface = 'app') are data the forward cannot recreate,
-- and this file never deletes them. Once they are not wanted, run by hand, in this order:
--   delete from proposal where surface = 'app';
--   alter table proposal drop constraint if exists proposal_app_job_check;
--   alter table proposal drop constraint if exists proposal_surface_check;
--   alter table proposal add constraint proposal_surface_check check (surface in ('project', 'email'));
--   alter table proposal drop constraint if exists proposal_payload_check;
--   alter table proposal add constraint proposal_payload_check
--     check ((surface = 'email' and payload is null) or (surface = 'project' and payload is not null));
--   alter table proposal alter column job_id set not null;
--   delete from source_evidence where type = 'app';
--   alter table source_evidence drop constraint if exists source_evidence_type_check;
--   alter table source_evidence add constraint source_evidence_type_check check (type in ('email', 'manual', 'import'));
-- An app's agent_connection row (provider_key backend-inbox, bridge or tucci) is an ordinary connection
-- and stays; revoke it from Hub > Agents if the app should stop.
--
-- Rehearsed forward -> back -> forward by supabase/tests/inbox.sh and supabase/tests/rehearsal.sh.

drop function if exists record_dismiss(uuid, integer);
drop function if exists record_approve(uuid, integer, text, text, jsonb);
drop function if exists vyzn_inbox(integer);
drop function if exists records_import(text, jsonb);
drop function if exists record_push(uuid, uuid, text, jsonb);
drop function if exists jarvis_records_ingest(uuid, uuid, text, jsonb, text);
drop function if exists vyzn_app_connect(uuid, text, text);
drop function if exists jarvis_vyzn_apps();

drop index if exists source_evidence_app_record_idx;

-- jarvis_capture_valid, exactly as 0046 left it (no note or person branch, no search_path).
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
alter function jarvis_capture_valid(text, text, jsonb) reset search_path;

-- action_undo, exactly as 0046 left it.
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

-- activity_feed, exactly as 0046 left it.
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

-- receipt_detail, exactly as 0046 left it.
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

-- connection_set_mode, exactly as 0047 left it.
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

-- item_why, exactly as 0060 left it (the evidence's app columns selected as null constants).
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
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'source_app', null::text, 'source_record_id', null::text,
                                                   'availability', e.availability, 'captured_at', e.captured_at, 'excerpt', e.excerpt) order by e.captured_at, e.id), '[]'::jsonb)
        from source_evidence e
       where e.owner_id = it.owner_id
         and e.id in (select unnest(r.evidence_refs) from receipt_event r join action a on a.id = r.action_id and a.owner_id = r.owner_id
                       where a.owner_id = it.owner_id and a.destination_id = it.id)),
    'proposals', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'status', p.status, 'created_by', p.created_by, 'revision', p.revision,
                                                   'source_app', null::text, 'created_at', p.created_at) order by p.created_at, p.id), '[]'::jsonb)
        from proposal p
       where p.owner_id = it.owner_id and it.data ->> 'clientId' is not null and p.payload ->> 'client_id' = it.data ->> 'clientId'),
    'answer', answer);
end;
$$;

-- create or replace keeps every function's ACL, so the 0046, 0047 and 0060 grants stand as they were.

-- The tables: narrow back only where nothing depends on the wider shape.
do $$
declare
  c record;
begin
  if not exists (select 1 from source_evidence where type = 'app') then
    for c in select conname from pg_constraint
              where conrelid = 'public.source_evidence'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) like '%type%' and pg_get_constraintdef(oid) like '%''email''%' loop
      execute format('alter table source_evidence drop constraint %I', c.conname);
    end loop;
    alter table source_evidence drop constraint if exists source_evidence_app_fields_check;
    alter table source_evidence add constraint source_evidence_type_check check (type in ('email', 'manual', 'import'));
  else
    raise notice 'source_evidence keeps type app: rows of that type exist (see the operator note)';
  end if;
  if not exists (select 1 from proposal where surface = 'app') then
    alter table proposal drop constraint if exists proposal_app_job_check;
    for c in select conname from pg_constraint
              where conrelid = 'public.proposal'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) like '%surface%' and pg_get_constraintdef(oid) not like '%payload%'
                and pg_get_constraintdef(oid) not like '%job_id%' loop
      execute format('alter table proposal drop constraint %I', c.conname);
    end loop;
    alter table proposal add constraint proposal_surface_check check (surface in ('project', 'email'));
    for c in select conname from pg_constraint
              where conrelid = 'public.proposal'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%payload IS NULL%' loop
      execute format('alter table proposal drop constraint %I', c.conname);
    end loop;
    alter table proposal add constraint proposal_payload_check
      check ((surface = 'email' and payload is null) or (surface = 'project' and payload is not null));
    alter table proposal alter column job_id set not null;
  else
    raise notice 'proposal keeps the app surface: inbox rows exist (see the operator note)';
  end if;
end $$;
