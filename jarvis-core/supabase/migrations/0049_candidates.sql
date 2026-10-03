-- Migration 0049: candidates proposed and read, slice 06 of the unified
-- substrate (2026-10-03). IMPLEMENTATION-SPEC.md sections 08 (E07 to E11,
-- E24, E25), 10 (the card catalog and the deterministic pipeline), 13.
--
-- A card is a row in email_candidate (0044). Slice 03 gave the row its
-- transitions (edit, dismiss, restore, the atomic save); this migration gives
-- it its birth from the app's deterministic rules and from a manual capture,
-- and the one read the Email tab makes for a page of messages. Nothing here
-- extracts: the rules run in the browser over the messages the person has
-- loaded or opened, and hand the result here, where the row is deduplicated
-- by its semantic fingerprint, a dismissed fingerprint stays dismissed, a
-- saved one stays saved, and a message whose content changed since a card
-- was read marks that card stale (E25) rather than letting it be approved.
--
-- Additive. Rollback: supabase/rollback/0049_candidates_down.sql.

-- ---------------------------------------------------------------------------
-- 1. Propose: the rules' or the person's candidate, deduplicated.
-- ---------------------------------------------------------------------------
create or replace function candidate_propose(
  p_message uuid, p_kind text, p_payload jsonb, p_provenance jsonb, p_missing text[], p_fingerprint text, p_extractor_version text, p_source_hash text, p_origin text default 'rule'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  msg email_message%rowtype;
  existing email_candidate%rowtype;
  h text;
  st text;
  cid uuid;
  new_rev integer;
  stale_n integer := 0;
  pay jsonb;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_kind not in ('bill', 'receipt', 'task', 'event', 'waiting') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'kind'); end if;
  if p_origin not in ('rule', 'manual') then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'origin'); end if;
  if jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 16384 or not jarvis_payload_clean(p_payload) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'payload'); end if;
  if coalesce(p_payload ->> 'kind', p_kind) <> p_kind then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'kind'); end if;
  if jsonb_typeof(coalesce(p_provenance, '{}'::jsonb)) <> 'object' then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'provenance'); end if;
  if coalesce(length(p_fingerprint), 0) not between 1 and 200 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'fingerprint'); end if;
  if coalesce(length(p_extractor_version), 0) not between 1 and 32 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'extractor_version'); end if;

  select * into msg from email_message where id = p_message and owner_id = owner;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if msg.deleted_at is not null then return jsonb_build_object('error', 'SOURCE_CHANGED', 'detail', 'source unavailable'); end if;
  -- The rules read a copy of the message; the copy must be the current one.
  if p_source_hash is distinct from msg.source_hash then return jsonb_build_object('error', 'SOURCE_CHANGED', 'detail', 'email changed', 'source_hash', msg.source_hash); end if;

  -- E25: any provisional card read from an older copy of this message is
  -- stale now, whatever happens to this proposal.
  update email_candidate set status = 'stale'
   where owner_id = owner and message_id = msg.id and status in ('proposed', 'needs_details', 'conflict') and source_hash <> msg.source_hash;
  get diagnostics stale_n = row_count;

  pay := p_payload || jsonb_build_object('kind', p_kind);
  h := encode(sha256(convert_to(pay::text, 'UTF8')), 'hex');
  st := case when cardinality(coalesce(p_missing, '{}')) > 0 then 'needs_details' else 'proposed' end;

  select * into existing from email_candidate
   where owner_id = owner and account_id = msg.account_id and message_id = msg.id and kind = p_kind and fingerprint = p_fingerprint
   for update;
  if found then
    -- The same card again. Saved stays saved; dismissed stays dismissed (E10:
    -- the same fingerprint does not come back); a provisional card read from
    -- an older copy takes the current facts and a new revision.
    if existing.status = 'saved' then
      return jsonb_build_object('candidate_id', existing.id, 'revision', existing.revision, 'status', 'saved', 'payload_hash', existing.payload_hash, 'replay', true, 'stale_marked', stale_n);
    end if;
    if existing.status = 'dismissed' then
      return jsonb_build_object('candidate_id', existing.id, 'revision', existing.revision, 'status', 'dismissed', 'payload_hash', existing.payload_hash, 'replay', true, 'stale_marked', stale_n);
    end if;
    if existing.source_hash <> msg.source_hash or existing.payload_hash <> h or existing.status = 'stale' then
      update email_candidate
         set source_hash = msg.source_hash, payload = pay, payload_hash = h, provenance_by_field = coalesce(p_provenance, '{}'::jsonb),
             missing_fields = coalesce(p_missing, '{}'), status = st, extractor_version = p_extractor_version
       where id = existing.id
       returning revision into new_rev;
      return jsonb_build_object('candidate_id', existing.id, 'revision', new_rev, 'status', st, 'payload_hash', h, 'replay', false, 'refreshed', true, 'stale_marked', stale_n);
    end if;
    return jsonb_build_object('candidate_id', existing.id, 'revision', existing.revision, 'status', existing.status, 'payload_hash', existing.payload_hash, 'replay', true, 'stale_marked', stale_n);
  end if;

  insert into email_candidate (owner_id, account_id, message_id, source_hash, extractor_version, kind, origin, payload, payload_hash, provenance_by_field, missing_fields, status, fingerprint)
  values (owner, msg.account_id, msg.id, msg.source_hash, p_extractor_version, p_kind, p_origin, pay, h, coalesce(p_provenance, '{}'::jsonb), coalesce(p_missing, '{}'), st, p_fingerprint)
  returning id, revision into cid, new_rev;
  return jsonb_build_object('candidate_id', cid, 'revision', new_rev, 'status', st, 'payload_hash', h, 'replay', false, 'stale_marked', stale_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Read: the cards for a page of messages, with what the screen needs to
--    draw them honestly: the message's current source hash (a different one
--    on the card means Email Changed), the assistant's name on an agent's
--    suggestion, the saved sibling of the same kind when the message changed
--    after a save (an update to review, never a write), and the action behind
--    a saved card so its receipt is one tap away.
-- ---------------------------------------------------------------------------
create or replace function candidates_for(p_messages uuid[], p_include_dismissed boolean default false)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'message_id', c.message_id, 'account_id', c.account_id, 'kind', c.kind, 'origin', c.origin,
    'agent_name', (select a.display_name from agent_connection a where a.id = c.agent_id),
    'status', c.status, 'revision', c.revision, 'payload', c.payload, 'payload_hash', c.payload_hash,
    'provenance_by_field', c.provenance_by_field, 'missing_fields', to_jsonb(c.missing_fields),
    'fingerprint', c.fingerprint, 'source_hash', c.source_hash, 'message_source_hash', m.source_hash,
    'destination_id', c.destination_id, 'action_id', c.action_id, 'proposal_id', c.proposal_id,
    'extractor_version', c.extractor_version, 'created_at', c.created_at, 'updated_at', c.updated_at,
    'saved_sibling', (select jsonb_build_object('id', s.id, 'payload', s.payload, 'destination_id', s.destination_id, 'action_id', s.action_id)
                        from email_candidate s where s.owner_id = c.owner_id and s.message_id = c.message_id and s.kind = c.kind and s.status = 'saved' and s.id <> c.id
                       order by s.updated_at desc limit 1)
  ) order by c.created_at, c.id), '[]'::jsonb)
  from email_candidate c
  join email_message m on m.id = c.message_id
  where c.owner_id = auth.uid() and c.message_id = any (coalesce(p_messages, '{}'::uuid[]))
    and (p_include_dismissed or c.status <> 'dismissed');
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants.
-- ---------------------------------------------------------------------------
revoke all on function candidate_propose(uuid, text, jsonb, jsonb, text[], text, text, text, text) from public, anon;
revoke all on function candidates_for(uuid[], boolean) from public, anon;
grant execute on function candidate_propose(uuid, text, jsonb, jsonb, text[], text, text, text, text) to authenticated;
grant execute on function candidates_for(uuid[], boolean) to authenticated;
