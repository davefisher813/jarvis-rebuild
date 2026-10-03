-- Migration 0045: authorization, scoped context and the agent gateway, slice
-- 02 of the unified substrate (2026-10-03). docs/jarvis-unified/
-- IMPLEMENTATION-SPEC.md sections 04 and 05; REPO-MAP.md section 4.
--
-- Everything an outside assistant can do goes through the functions below,
-- called by the gateway (api/agent.ts) with the service role after it has
-- resolved the agent's token. Everything a person does to the same rows
-- (approve a preview, revoke, import) goes through functions callable by the
-- signed-in session, which take the actor from auth.uid() and nothing else.
--
-- Default deny, in this order, at every entry: the actor is who the token or
-- session says; the master AI switch and the admin switch are on; the
-- connection is connected and its epoch is current; the capability was
-- verified by the server; an explicit grant names the project or the
-- resources; the job's purpose is open; the mode's ceiling allows the
-- operation. Any layer can refuse and the refusal names only a code.
--
-- Receipts are written in the same transaction as the thing they describe:
-- a disclosure receipt exists before a byte of context is returned.
--
-- Additive. Rollback: supabase/rollback/0045_authorization_and_gateway_down.sql.

-- ---------------------------------------------------------------------------
-- 0. Private: the agent token bucket and the token index.
-- ---------------------------------------------------------------------------
create table if not exists jarvis_private.agent_rate (
  connection_id uuid primary key references agent_connection (id) on delete cascade,
  tokens numeric not null default 60,
  capacity integer not null default 60 check (capacity > 0),
  refill_per_min numeric not null default 60 check (refill_per_min > 0),
  updated_at timestamptz not null default now()
);
alter table jarvis_private.agent_rate enable row level security;
revoke all on table jarvis_private.agent_rate from public;
revoke all on table jarvis_private.agent_rate from anon, authenticated;
grant all on table jarvis_private.agent_rate to service_role;

create unique index if not exists agent_credential_token_hash_idx on jarvis_private.agent_credential (token_hash);

-- ---------------------------------------------------------------------------
-- 1. Helpers (internal: no browser grant, no service grant; called by the
--    SECURITY DEFINER commands below).
-- ---------------------------------------------------------------------------

-- 'ok', 'AI_DISABLED' (the person turned AI off) or 'ADMIN_AI_DISABLED'
-- (the admin did). Read from current state on every call: the profile row
-- and auth.users, never a cached claim.
create or replace function jarvis_ai_switch(p_owner uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lvl text;
  admin_off boolean;
begin
  select (u.raw_app_meta_data ->> 'ai_allowed') = 'false' into admin_off from auth.users u where u.id = p_owner;
  if coalesce(admin_off, false) then return 'ADMIN_AI_DISABLED'; end if;
  select coalesce(data -> 'ai' ->> 'level', 'draft') into lvl
    from item where owner_id = p_owner and entity_type = 'profile'
    order by updated_at desc limit 1;
  if lvl = 'off' then return 'AI_DISABLED'; end if;
  return 'ok';
end;
$$;

-- One action plus its first receipt, in the calling transaction.
create or replace function jarvis_record(
  p_owner uuid, p_kind text, p_actor_kind text, p_actor_id uuid, p_verb text, p_surface text,
  p_state text, p_payload_hash text, p_idempotency text, p_scope text, p_assurance text,
  p_evidence uuid[] default '{}', p_destination uuid default null, p_proposal uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid;
begin
  insert into action (owner_id, kind, actor_kind, actor_id, initiated_by_user_id, proposal_id, verb, surface, state, payload_hash, idempotency_key, destination_id, authorization_snapshot)
  values (p_owner, p_kind, p_actor_kind, p_actor_id, p_owner, p_proposal, p_verb, p_surface, p_state, p_payload_hash, p_idempotency, p_destination,
          jsonb_build_object('actor_kind', p_actor_kind, 'actor_id', p_actor_id, 'at', now()))
  returning id into a;
  insert into receipt_event (owner_id, action_id, sequence, state, exact_verb, actor_kind, actor_id, actor_display, initiated_by_user_id, scope_summary, after_ref, evidence_refs, assurance)
  values (p_owner, a, 1, p_state, p_verb, p_actor_kind, p_actor_id,
          case p_actor_kind when 'agent' then coalesce((select display_name from agent_connection where id = p_actor_id), 'Assistant') when 'user' then 'You' else 'Rule' end,
          p_owner, p_scope, p_destination, p_evidence, p_assurance);
  return a;
end;
$$;

-- The fields each kind may disclose, and nothing else. Health, Money, raw
-- mail attachments and anything not listed here are never in a package.
create or replace function jarvis_context_fields(p_entity_type text)
returns text[]
language sql
immutable
as $$
  select case p_entity_type
    when 'project' then array['title', 'status', 'due']
    when 'task' then array['text', 'due', 'done', 'projectId']
    when 'goal' then array['title', 'status']
    when 'decision_record' then array['decision', 'why', 'statement', 'rationale']
    when 'email_message' then array['subject', 'from_address', 'from_name', 'internal_date', 'snippet', 'body']
    else array[]::text[]
  end;
$$;

-- The preview, as a set-returning helper: one row per permitted resource
-- with its permitted fields, its revision and its values. Shared by preview
-- and issue so the hash the person approved is the hash the agent gets.
-- A project job yields the project brief: the project, its tasks, and the
-- decisions attached to it. An email job (no project, explicit resources)
-- yields the named messages. Nothing outside the job's boundary is ever
-- returned, so an id from elsewhere is simply absent (counted, never named).
create or replace function jarvis_context_rows(p_owner uuid, p_job uuid, p_resources uuid[], p_fields text[])
returns table (resource_id uuid, entity_type text, revision bigint, fields text[], redactions text[], data jsonb, bytes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j job%rowtype;
  want_all boolean := p_resources is null or cardinality(p_resources) = 0;
begin
  select * into j from job where id = p_job and owner_id = p_owner;
  if not found then return; end if;
  if j.project_id is not null then
    return query
      with scope as (
        select i.id, i.entity_type, i.updated_at, i.data
          from item i
         where i.owner_id = p_owner
           and (i.id = j.project_id
                or (i.entity_type = 'task' and i.data ->> 'projectId' = j.project_id::text and coalesce((i.data ->> 'done')::boolean, false) = false)
                or (i.entity_type = 'decision_record' and (
                      i.data ->> 'linkedId' = j.project_id::text
                      or exists (select 1 from jsonb_array_elements(coalesce(i.data -> 'links', '[]'::jsonb)) l where l ->> 'id' = j.project_id::text))
                    and i.data ->> 'supersededById' is null))
           and (want_all or i.id = any(p_resources))
      ),
      shaped as (
        select s.id, s.entity_type, s.updated_at,
               (select coalesce(array_agg(f order by f), '{}') from unnest(jarvis_context_fields(s.entity_type)) f
                 where (p_fields is null or cardinality(p_fields) = 0 or f = any(p_fields))) as fields,
               (select coalesce(array_agg(f order by f), '{}') from unnest(coalesce(p_fields, '{}')) f
                 where not (f = any(jarvis_context_fields(s.entity_type)))) as redactions,
               s.data,
               (select v.statement from decision_version v where v.item_id = s.id and v.owner_id = p_owner and v.status = 'active' limit 1) as statement,
               (select v.rationale from decision_version v where v.item_id = s.id and v.owner_id = p_owner and v.status = 'active' limit 1) as rationale
          from scope s
      )
      select sh.id, sh.entity_type,
             (extract(epoch from sh.updated_at) * 1000000)::bigint,
             sh.fields, sh.redactions,
             (select coalesce(jsonb_object_agg(f, case f when 'statement' then to_jsonb(sh.statement) when 'rationale' then to_jsonb(sh.rationale) else sh.data -> f end), '{}'::jsonb)
                from unnest(sh.fields) f
               where case f when 'statement' then sh.statement is not null when 'rationale' then sh.rationale is not null else sh.data ? f end) as data,
             0
        from shaped sh
       order by case sh.entity_type when 'project' then 0 when 'decision_record' then 1 else 2 end, sh.updated_at desc;
  else
    return query
      select m.id, 'email_message'::text,
             (extract(epoch from m.updated_at) * 1000000)::bigint,
             (select coalesce(array_agg(f order by f), '{}') from unnest(jarvis_context_fields('email_message')) f
               where (p_fields is null or cardinality(p_fields) = 0 or f = any(p_fields))),
             (select coalesce(array_agg(f order by f), '{}') from unnest(coalesce(p_fields, '{}')) f
               where not (f = any(jarvis_context_fields('email_message')))),
             (select coalesce(jsonb_object_agg(f, case f
                  when 'subject' then to_jsonb(m.subject)
                  when 'from_address' then to_jsonb(m.from_address)
                  when 'from_name' then to_jsonb(m.from_name)
                  when 'internal_date' then to_jsonb(m.internal_date)
                  when 'snippet' then to_jsonb(m.snippet)
                  when 'body' then to_jsonb((select b.sanitized_text from email_message_body b where b.message_id = m.id and b.owner_id = p_owner))
                end), '{}'::jsonb)
                from unnest((select coalesce(array_agg(f order by f), '{}') from unnest(jarvis_context_fields('email_message')) f
                              where (p_fields is null or cardinality(p_fields) = 0 or f = any(p_fields)))) f),
             0
        from email_message m
       where m.owner_id = p_owner
         and m.deleted_at is null
         and m.id = any(j.resource_ids)
         and (want_all or m.id = any(p_resources))
       order by m.internal_date desc;
  end if;
end;
$$;

-- The manifest, its hash, and the caps, from the rows above. The hash is
-- computed HERE and only here (sha256 over the manifest's jsonb text), so the
-- hash a person approves in the app is the hash an agent presents to issue.
create or replace function jarvis_context_shape(p_owner uuid, p_job uuid, p_resources uuid[], p_fields text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rows_all jsonb;
  manifest jsonb;
  data jsonb;
  total integer;
  kept integer;
  bytes integer;
  requested integer := coalesce(cardinality(p_resources), 0);
  unauthorized integer;
  redactions jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'resource_id', r.resource_id, 'entity_type', r.entity_type, 'revision', r.revision,
           'fields', to_jsonb(r.fields), 'redactions', to_jsonb(r.redactions), 'data', r.data,
           'bytes', length(r.data::text)) ), '[]'::jsonb), count(*)
    into rows_all, total
    from jarvis_context_rows(p_owner, p_job, p_resources, p_fields) r;

  -- Cap: at most 50 records and 32KB of content. Over the cap, the LAST
  -- records (least important by the ordering above) are left out and counted,
  -- never silently dropped.
  select coalesce(jsonb_agg(e - 'data' - 'bytes' - 'entity_type' || jsonb_build_object('evidence_refs', '[]'::jsonb)), '[]'::jsonb),
         coalesce(jsonb_object_agg(e ->> 'resource_id', e -> 'data'), '{}'::jsonb),
         count(*), coalesce(sum((e ->> 'bytes')::int), 0)
    into manifest, data, kept, bytes
    from (
      select e, ord, sum((e ->> 'bytes')::int) over (order by ord rows between unbounded preceding and current row) as running
        from jsonb_array_elements(rows_all) with ordinality as t(e, ord)
    ) s
   where ord <= 50 and running <= 32768;

  -- Redactions are the requested fields no returned row may disclose; a field
  -- one kind allows and another does not is not a redaction of the package.
  select coalesce(jsonb_agg(f order by f), '[]'::jsonb) into redactions
    from unnest(coalesce(p_fields, '{}')) f
   where not exists (
     select 1 from jsonb_array_elements(rows_all) e
      where f = any(jarvis_context_fields(e ->> 'entity_type')));

  -- Requested ids that are not in the job's boundary: counted for the owner,
  -- never named, never returned to an agent (the gateway strips the count).
  unauthorized := greatest(requested - total, 0);

  return jsonb_build_object(
    'manifest', manifest,
    'data', data,
    'redactions', redactions,
    'record_count', kept,
    'content_bytes', bytes,
    'omitted_counts', jsonb_build_object('unauthorized', unauthorized, 'over_limit', total - kept),
    'manifest_hash', encode(sha256(convert_to(manifest::text, 'UTF8')), 'hex')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Agent identity (service role only; called by api/agent.ts).
-- ---------------------------------------------------------------------------

-- Connect a verified adapter: the server has checked the adapter and holds
-- the token; only its hash is stored. Capabilities are what the SERVER
-- verified, never what the agent asked for.
create or replace function agent_connection_verify(
  p_owner uuid, p_connection uuid, p_token_hash text, p_capabilities text[], p_remote_subject text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c agent_connection%rowtype;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into c from agent_connection where id = p_connection and owner_id = p_owner for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if c.status = 'revoked' then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
  update agent_connection
     set status = 'connected', transport = 'https', verified_capabilities = p_capabilities,
         capability_verified_at = now(), remote_subject = coalesce(p_remote_subject, remote_subject)
   where id = p_connection;
  insert into jarvis_private.agent_credential (connection_id, owner_id, token_hash)
  values (p_connection, p_owner, p_token_hash)
  on conflict (connection_id) do update set token_hash = excluded.token_hash, rotated_at = now();
  return jsonb_build_object('connection_id', p_connection, 'status', 'connected', 'auth_epoch', c.auth_epoch);
end;
$$;

-- Who is calling. Null for an unknown token; the caller answers 401.
create or replace function agent_resolve_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c agent_connection%rowtype;
  cred jarvis_private.agent_credential%rowtype;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into cred from jarvis_private.agent_credential where token_hash = p_token_hash;
  if not found then return null; end if;
  select * into c from agent_connection where id = cred.connection_id and owner_id = cred.owner_id;
  if not found then return null; end if;
  update agent_connection set last_used_at = now() where id = c.id;
  return jsonb_build_object(
    'connection_id', c.id, 'owner_id', c.owner_id, 'status', c.status, 'mode', c.mode,
    'verified_capabilities', to_jsonb(c.verified_capabilities), 'auth_epoch', c.auth_epoch, 'display_name', c.display_name);
end;
$$;

-- A token bucket per connection: 60 calls a minute. False means wait.
create or replace function agent_rate_take(p_connection uuid, p_cost integer default 1)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r jarvis_private.agent_rate%rowtype;
  t timestamptz := clock_timestamp();
  avail numeric;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  insert into jarvis_private.agent_rate (connection_id) values (p_connection) on conflict (connection_id) do nothing;
  select * into r from jarvis_private.agent_rate where connection_id = p_connection for update;
  avail := least(r.capacity, r.tokens + extract(epoch from t - r.updated_at) / 60 * r.refill_per_min);
  if avail < p_cost then
    update jarvis_private.agent_rate set tokens = avail, updated_at = t where connection_id = p_connection;
    return false;
  end if;
  update jarvis_private.agent_rate set tokens = avail - p_cost, updated_at = t where connection_id = p_connection;
  return true;
end;
$$;

-- What this connection may do right now, with the reason for anything it
-- may not. Modes are ceilings, read here as the server holds them.
create or replace function agent_capabilities(p_owner uuid, p_connection uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c agent_connection%rowtype;
  sw text;
  caps jsonb := '[]'::jsonb;
  unavailable jsonb := '[]'::jsonb;
  cap text;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into c from agent_connection where id = p_connection and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if c.status <> 'connected' then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
  sw := jarvis_ai_switch(p_owner);
  foreach cap in array array['read_context', 'propose', 'write_inert_draft', 'open_review_link'] loop
    if sw <> 'ok' then
      unavailable := unavailable || jsonb_build_object('capability', cap, 'reason', sw);
    elsif not (cap = any(c.verified_capabilities)) then
      unavailable := unavailable || jsonb_build_object('capability', cap, 'reason', 'CAPABILITY_UNVERIFIED');
    elsif cap in ('propose', 'write_inert_draft') and c.mode = 'read_only' then
      unavailable := unavailable || jsonb_build_object('capability', cap, 'reason', 'MODE_CEILING');
    else
      caps := caps || to_jsonb(cap);
    end if;
  end loop;
  return jsonb_build_object('protocol_version', 1, 'mode', c.mode, 'capabilities', caps, 'unavailable', unavailable, 'auth_epoch', c.auth_epoch);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Context: preview, grant, issue, snapshot.
-- ---------------------------------------------------------------------------

-- The preview. As the person (session): everything, including how many of
-- the requested ids were outside the boundary. As an agent (service, with a
-- connection): the permitted manifest and whether a grant is still needed;
-- never the unauthorized count, never a name from outside the boundary.
create or replace function context_preview(
  p_job uuid, p_resources uuid[] default '{}', p_fields text[] default '{}', p_purpose text default null,
  p_owner uuid default null, p_connection uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  j job%rowtype;
  c agent_connection%rowtype;
  shape jsonb;
  sw text;
  granted boolean := false;
begin
  if p_connection is not null then
    if not jarvis_is_server() or p_owner is null then raise exception 'server only' using errcode = '42501'; end if;
    owner := p_owner;
    select * into c from agent_connection where id = p_connection and owner_id = owner;
    if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
    if c.status <> 'connected' then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
    sw := jarvis_ai_switch(owner);
    if sw <> 'ok' then return jsonb_build_object('error', sw); end if;
    if not ('read_context' = any(c.verified_capabilities)) then return jsonb_build_object('error', 'CAPABILITY_UNVERIFIED'); end if;
  else
    owner := auth.uid();
    if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  end if;
  select * into j from job where id = p_job and owner_id = owner;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if j.status <> 'open' then return jsonb_build_object('error', 'STALE_SCOPE'); end if;
  if p_connection is not null and j.agent_id is distinct from p_connection then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;

  shape := jarvis_context_shape(owner, p_job, p_resources, p_fields);

  if p_connection is not null then
    select exists (
      select 1 from scope_grant g
       where g.owner_id = owner and g.agent_id = p_connection and g.revoked_at is null
         and (g.expires_at is null or g.expires_at > now())
         and g.manifest_hash = shape ->> 'manifest_hash'
         and (g.project_id is not distinct from j.project_id)
    ) into granted;
    return (shape - 'data') || jsonb_build_object(
      'requires_user_grant', not granted,
      'omitted_counts', jsonb_build_object('over_limit', (shape -> 'omitted_counts' ->> 'over_limit')::int),
      'protocol_version', 1);
  end if;
  return (shape - 'data') || jsonb_build_object('requires_user_grant', false, 'job_id', p_job, 'project_id', j.project_id, 'purpose', coalesce(p_purpose, j.purpose));
end;
$$;

-- The person approves EXACTLY the preview they saw: the request is replayed
-- and its hash must match. Once = 15 minutes; This project = until revoked.
create or replace function scope_grant_create(
  p_job uuid, p_manifest_hash text, p_duration text, p_resources uuid[] default '{}', p_fields text[] default '{}', p_purpose text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  j job%rowtype;
  shape jsonb;
  g uuid;
  exp timestamptz;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if p_duration not in ('once', 'project') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  select * into j from job where id = p_job and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if j.agent_id is null then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'a grant names an assistant'); end if;
  if j.status <> 'open' then return jsonb_build_object('error', 'STALE_SCOPE'); end if;
  shape := jarvis_context_shape(owner, p_job, p_resources, p_fields);
  if shape ->> 'manifest_hash' <> p_manifest_hash then return jsonb_build_object('error', 'STALE_SCOPE'); end if;
  if (shape ->> 'record_count')::int = 0 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'an empty grant grants nothing'); end if;
  exp := case p_duration when 'once' then now() + interval '15 minutes' else null end;
  insert into scope_grant (owner_id, agent_id, project_id, resource_ids, fields, purposes, manifest_hash, expires_at, approved_by)
  values (owner, j.agent_id, j.project_id,
          (select coalesce(array_agg((e ->> 'resource_id')::uuid), '{}') from jsonb_array_elements(shape -> 'manifest') e),
          (select coalesce(array_agg(distinct f), '{}') from jsonb_array_elements(shape -> 'manifest') e, jsonb_array_elements_text(e -> 'fields') f),
          array[coalesce(p_purpose, j.purpose)], p_manifest_hash, exp, owner)
  returning id into g;
  return jsonb_build_object('grant_id', g, 'expires_at', exp, 'manifest_hash', p_manifest_hash, 'record_count', shape -> 'record_count');
end;
$$;

-- Issue a package. Agent: needs a live grant with this exact hash, a current
-- epoch, the capability, the switch on. Person: a manual export, where the
-- tap is the authority. In both the disclosure receipt is written before the
-- data is returned, in this transaction.
create or replace function context_issue(
  p_job uuid, p_manifest_hash text, p_resources uuid[] default '{}', p_fields text[] default '{}', p_purpose text default null,
  p_owner uuid default null, p_connection uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  j job%rowtype;
  c agent_connection%rowtype;
  shape jsonb;
  sw text;
  pkg uuid;
  exp timestamptz := now() + interval '15 minutes';
  epoch integer := 0;
  n integer;
  title text;
  verb text;
  actor_kind text := 'user';
  transport text := 'manual';
begin
  if p_connection is not null then
    if not jarvis_is_server() or p_owner is null then raise exception 'server only' using errcode = '42501'; end if;
    owner := p_owner;
    actor_kind := 'agent';
    transport := 'https';
    select * into c from agent_connection where id = p_connection and owner_id = owner for update;
    if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
    if c.status <> 'connected' then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
    epoch := c.auth_epoch;
    sw := jarvis_ai_switch(owner);
    if sw <> 'ok' then return jsonb_build_object('error', sw); end if;
    if not ('read_context' = any(c.verified_capabilities)) then return jsonb_build_object('error', 'CAPABILITY_UNVERIFIED'); end if;
  else
    owner := auth.uid();
    if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  end if;
  select * into j from job where id = p_job and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if j.status <> 'open' then return jsonb_build_object('error', 'STALE_SCOPE'); end if;
  if p_connection is not null then
    if j.agent_id is distinct from p_connection then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
    if not exists (
      select 1 from scope_grant g
       where g.owner_id = owner and g.agent_id = p_connection and g.revoked_at is null
         and (g.expires_at is null or g.expires_at > now())
         and g.manifest_hash = p_manifest_hash and g.project_id is not distinct from j.project_id
    ) then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  end if;

  shape := jarvis_context_shape(owner, p_job, p_resources, p_fields);
  -- The source moved since the preview or the grant: nothing leaves.
  if shape ->> 'manifest_hash' <> p_manifest_hash then return jsonb_build_object('error', 'STALE_SCOPE'); end if;
  n := (shape ->> 'record_count')::int;

  select coalesce(data ->> 'title', 'this project') into title from item where id = j.project_id and owner_id = owner;
  verb := case when j.project_id is not null
    then format('Read %s %s in %s', n, case when n = 1 then 'record' else 'records' end, title)
    else format('Read %s %s', n, case when n = 1 then 'message' else 'messages' end) end;
  if actor_kind = 'user' then verb := replace(verb, 'Read ', 'Exported '); end if;

  insert into context_package (owner_id, job_id, agent_id, manifest, expires_at, auth_epoch, package_hash, status, omitted_counts, record_count, content_bytes)
  values (owner, p_job, case when actor_kind = 'agent' then p_connection else j.agent_id end, shape -> 'manifest', exp, epoch, p_manifest_hash, 'active',
          shape -> 'omitted_counts', n, (shape ->> 'content_bytes')::int)
  returning id into pkg;

  -- The disclosure receipt, before a byte goes back.
  perform jarvis_record(owner, case when actor_kind = 'agent' then 'read_context' else 'export_context' end, actor_kind,
                        case when actor_kind = 'agent' then p_connection else null end, verb, 'project', 'confirmed',
                        p_manifest_hash, 'ctx:' || pkg::text,
                        coalesce(title, 'Email') || ' · ' || n || ' ' || case when n = 1 then 'record' else 'records' end || ' · ' || transport,
                        'verified_jarvis');

  return jsonb_build_object(
    'protocol_version', 1, 'package_id', pkg, 'job_id', p_job, 'agent_id', case when actor_kind = 'agent' then p_connection else j.agent_id end,
    'project_id', j.project_id, 'purpose', coalesce(p_purpose, j.purpose),
    'manifest', shape -> 'manifest', 'data', shape -> 'data', 'expires_at', exp, 'auth_epoch', epoch,
    'package_hash', p_manifest_hash,
    'omitted_counts', case when actor_kind = 'agent' then jsonb_build_object('over_limit', shape -> 'omitted_counts' -> 'over_limit') else shape -> 'omitted_counts' end);
end;
$$;

-- The encrypted snapshot behind a package (ciphertext made by the server).
create or replace function context_snapshot_store(p_owner uuid, p_package uuid, p_cipher text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  exp timestamptz;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select expires_at into exp from context_package where id = p_package and owner_id = p_owner and status = 'active';
  if exp is null then return false; end if;
  insert into jarvis_private.context_snapshot (package_id, owner_id, snapshot_enc, purge_after)
  values (p_package, p_owner, p_cipher, exp + interval '24 hours')
  on conflict (package_id) do update set snapshot_enc = excluded.snapshot_enc, purge_after = excluded.purge_after;
  return true;
end;
$$;

-- Expire and purge: an operator step, also safe to call from a sweep.
create or replace function context_packages_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired integer;
  purged integer;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  update context_package set status = 'expired' where status = 'active' and expires_at <= now();
  get diagnostics expired = row_count;
  delete from jarvis_private.context_snapshot where purge_after <= now();
  get diagnostics purged = row_count;
  update context_package set purged_at = now()
   where purged_at is null and status in ('expired', 'revoked')
     and not exists (select 1 from jarvis_private.context_snapshot s where s.package_id = context_package.id);
  return jsonb_build_object('expired', expired, 'purged', purged);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. What an agent may put forward: a proposal, an inert draft. Never a
--    commitment, never a send.
-- ---------------------------------------------------------------------------

-- Keys that would carry authority if the server believed them. A payload
-- with any of them is refused whole.
create or replace function jarvis_payload_clean(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'object'
     and not (p ?| array['approved', 'approved_by', 'approval', 'status', 'execute', 'executed', 'owner_id', 'user_id', 'actor', 'capabilities', 'mode', 'confirmed']);
$$;

create or replace function proposal_submit(
  p_owner uuid, p_connection uuid, p_package uuid, p_surface text, p_type text, p_payload jsonb, p_evidence uuid[], p_idempotency text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c agent_connection%rowtype;
  pk context_package%rowtype;
  j job%rowtype;
  sw text;
  existing proposal%rowtype;
  h text;
  pid uuid;
  cand uuid;
  msg email_message%rowtype;
  cap_kind text;
  verb text;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into c from agent_connection where id = p_connection and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if c.status <> 'connected' then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
  sw := jarvis_ai_switch(p_owner);
  if sw <> 'ok' then return jsonb_build_object('error', sw); end if;
  if not ('propose' = any(c.verified_capabilities)) then return jsonb_build_object('error', 'CAPABILITY_UNVERIFIED'); end if;
  if c.mode = 'read_only' then return jsonb_build_object('error', 'SCOPE_DENIED', 'detail', 'read only'); end if;
  if p_surface not in ('project', 'email') or p_type not in ('decision', 'constraint_change', 'capture') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if (p_surface = 'email') <> (p_type = 'capture') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if not jarvis_payload_clean(p_payload) or length(p_payload::text) > 16384 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if cardinality(coalesce(p_evidence, '{}')) > 20 or p_idempotency is null or length(p_idempotency) not between 1 and 128 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;

  select * into pk from context_package where id = p_package and owner_id = p_owner and agent_id = p_connection;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if pk.status <> 'active' or pk.expires_at <= now() then return jsonb_build_object('error', 'PACKAGE_EXPIRED'); end if;
  if pk.auth_epoch <> c.auth_epoch then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
  select * into j from job where id = pk.job_id and owner_id = p_owner;
  if not found or j.status <> 'open' then return jsonb_build_object('error', 'STALE_SCOPE'); end if;
  if (p_surface = 'email') <> (j.project_id is null) then return jsonb_build_object('error', 'SCOPE_DENIED', 'detail', 'surface does not match the job'); end if;

  -- Evidence must come from inside the package.
  if exists (
    select 1 from unnest(coalesce(p_evidence, '{}')) e
     where not exists (select 1 from jsonb_array_elements(pk.manifest) m where (m ->> 'resource_id')::uuid = e)
  ) then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'evidence outside the package'); end if;

  h := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  select * into existing from proposal where owner_id = p_owner and idempotency_key = p_idempotency;
  if found then
    if existing.payload_hash <> h then return jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('proposal_id', existing.id, 'status', existing.status, 'replay', true);
  end if;

  if p_surface = 'project' then
    insert into proposal (owner_id, job_id, agent_id, surface, type, payload, payload_hash, evidence_refs, created_by, idempotency_key)
    values (p_owner, pk.job_id, p_connection, 'project', p_type, p_payload, h, coalesce(p_evidence, '{}'), 'agent', p_idempotency)
    returning id into pid;
    verb := case p_type when 'decision' then 'Suggested a decision' else 'Suggested a constraint change' end;
  else
    -- An Email capture: the message must be in the job, and the payload is a
    -- capture of a known kind. The payload lives on the candidate only.
    cap_kind := p_payload ->> 'kind';
    if cap_kind not in ('bill', 'receipt', 'task', 'event', 'waiting') then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
    if (p_payload ->> 'message_id') is null then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'message_id'); end if;
    select * into msg from email_message where id = (p_payload ->> 'message_id')::uuid and owner_id = p_owner and id = any(j.resource_ids);
    if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
    insert into proposal (owner_id, job_id, agent_id, surface, type, payload, payload_hash, evidence_refs, created_by, idempotency_key)
    values (p_owner, pk.job_id, p_connection, 'email', 'capture', null, h, coalesce(p_evidence, '{}'), 'agent', p_idempotency)
    returning id into pid;
    insert into email_candidate (owner_id, account_id, message_id, source_hash, extractor_version, kind, origin, agent_id, payload, payload_hash, fingerprint, status, proposal_id)
    values (p_owner, msg.account_id, msg.id, msg.source_hash, 'agent:' || c.provider_key, cap_kind, 'agent', p_connection,
            p_payload - 'message_id', h, 'agent:' || h, 'proposed', pid)
    on conflict (owner_id, account_id, message_id, kind, fingerprint) do update set proposal_id = excluded.proposal_id
    returning id into cand;
    verb := 'Suggested an email item';
  end if;

  perform jarvis_record(p_owner, 'propose', 'agent', p_connection, verb, p_surface, 'confirmed', h, 'proposal:' || pid::text,
                        c.display_name, 'verified_jarvis', '{}', null, pid);
  return jsonb_build_object('proposal_id', pid, 'status', 'proposed', 'candidate_id', cand);
end;
$$;

-- An inert draft in the mailbox the job names. Never sends.
create or replace function draft_submit(p_owner uuid, p_connection uuid, p_package uuid, p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c agent_connection%rowtype;
  pk context_package%rowtype;
  j job%rowtype;
  acct email_account%rowtype;
  sw text;
  d uuid;
  rev integer;
  n_rcpt integer;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into c from agent_connection where id = p_connection and owner_id = p_owner;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if c.status <> 'connected' then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
  sw := jarvis_ai_switch(p_owner);
  if sw <> 'ok' then return jsonb_build_object('error', sw); end if;
  if not ('write_inert_draft' = any(c.verified_capabilities)) then return jsonb_build_object('error', 'CAPABILITY_UNVERIFIED'); end if;
  if c.mode = 'read_only' then return jsonb_build_object('error', 'SCOPE_DENIED', 'detail', 'read only'); end if;
  if not jarvis_payload_clean(p_draft) or length(p_draft::text) > 65536 then return jsonb_build_object('error', 'INVALID_PAYLOAD'); end if;
  if (p_draft ->> 'account_id') is null then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'account_id'); end if;
  if jsonb_typeof(coalesce(p_draft -> 'to', '[]')) <> 'array' or jsonb_typeof(coalesce(p_draft -> 'cc', '[]')) <> 'array' or jsonb_typeof(coalesce(p_draft -> 'bcc', '[]')) <> 'array' then
    return jsonb_build_object('error', 'INVALID_PAYLOAD');
  end if;
  n_rcpt := jsonb_array_length(coalesce(p_draft -> 'to', '[]')) + jsonb_array_length(coalesce(p_draft -> 'cc', '[]')) + jsonb_array_length(coalesce(p_draft -> 'bcc', '[]'));
  if n_rcpt > 20 then return jsonb_build_object('error', 'INVALID_PAYLOAD', 'detail', 'recipients'); end if;

  select * into pk from context_package where id = p_package and owner_id = p_owner and agent_id = p_connection;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if pk.status <> 'active' or pk.expires_at <= now() then return jsonb_build_object('error', 'PACKAGE_EXPIRED'); end if;
  if pk.auth_epoch <> c.auth_epoch then return jsonb_build_object('error', 'CONNECTION_REVOKED'); end if;
  select * into j from job where id = pk.job_id and owner_id = p_owner;
  if not found or j.status <> 'open' then return jsonb_build_object('error', 'STALE_SCOPE'); end if;
  -- The exact account must already be in the job's scope.
  select * into acct from email_account where id = (p_draft ->> 'account_id')::uuid and owner_id = p_owner and id = any(j.resource_ids);
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED', 'detail', 'account not in scope'); end if;

  insert into email_draft (owner_id, account_id, thread_id, to_addresses, cc_addresses, bcc_addresses, subject, body_text, reply_headers, send_state)
  values (p_owner, acct.id, p_draft ->> 'thread_id',
          coalesce(p_draft -> 'to', '[]'), coalesce(p_draft -> 'cc', '[]'), coalesce(p_draft -> 'bcc', '[]'),
          left(coalesce(p_draft ->> 'subject', ''), 998), coalesce(p_draft ->> 'body_text', ''),
          coalesce(p_draft -> 'reply_headers', '{}'), 'draft')
  returning id, revision into d, rev;
  perform jarvis_record(p_owner, 'draft', 'agent', p_connection, 'Saved reply draft', 'email', 'confirmed',
                        encode(sha256(convert_to(p_draft::text, 'UTF8')), 'hex'), 'draft:' || d::text, acct.address, 'verified_jarvis');
  return jsonb_build_object('draft_id', d, 'revision', rev, 'review_path', '/email/drafts/' || d::text);
end;
$$;

-- The internal path to review a proposal this agent put forward. No bearer
-- credential in it; the person opens it signed in as themselves.
create or replace function review_link(p_owner uuid, p_connection uuid, p_proposal uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pr proposal%rowtype;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into pr from proposal where id = p_proposal and owner_id = p_owner and agent_id = p_connection;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  return jsonb_build_object('proposal_id', pr.id, 'surface', pr.surface, 'status', pr.status,
    'path', case pr.surface when 'email' then '/email/review' else '/hub/review/' || pr.id::text end);
end;
$$;

-- An agent may ask after an action it is credited on, and learns its state
-- and exact verb: nothing else, and no way to move it.
create or replace function action_status(p_owner uuid, p_connection uuid, p_action uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a action%rowtype;
  r receipt_event%rowtype;
begin
  if not jarvis_is_server() then raise exception 'server only' using errcode = '42501'; end if;
  select * into a from action where id = p_action and owner_id = p_owner and actor_id = p_connection;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  select * into r from receipt_event where action_id = a.id order by sequence desc limit 1;
  return jsonb_build_object('action_id', a.id, 'state', a.state, 'exact_verb', coalesce(r.exact_verb, a.verb), 'updated_at', a.updated_at, 'assurance', r.assurance);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The person's own commands: revoke, import.
-- ---------------------------------------------------------------------------

-- Immediate revocation. The epoch moves, the token goes, live packages and
-- grants die, unconsumed approvals credited to the agent lapse, queued jobs
-- close. A dispatched external operation cannot be recalled; nothing here
-- claims otherwise. Idempotent.
create or replace function connection_revoke(p_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  c agent_connection%rowtype;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  select * into c from agent_connection where id = p_connection and owner_id = owner for update;
  if not found then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  if c.status = 'revoked' then return jsonb_build_object('status', 'revoked', 'auth_epoch', c.auth_epoch, 'already', true); end if;
  update agent_connection set status = 'revoked', revoked_at = now(), auth_epoch = auth_epoch + 1 where id = c.id;
  delete from jarvis_private.agent_credential where connection_id = c.id;
  delete from jarvis_private.agent_rate where connection_id = c.id;
  update context_package set status = 'revoked' where owner_id = owner and agent_id = c.id and status = 'active';
  delete from jarvis_private.context_snapshot s using context_package p where s.package_id = p.id and p.agent_id = c.id and p.owner_id = owner;
  update scope_grant set revoked_at = now() where owner_id = owner and agent_id = c.id and revoked_at is null;
  update approval ap set expires_at = least(ap.expires_at, now())
    from action a where ap.action_id = a.id and a.owner_id = owner and a.actor_id = c.id and ap.consumed_at is null;
  update job set status = 'cancelled' where owner_id = owner and agent_id = c.id and status = 'open';
  update action set state = 'cancelled', error_code = 'CONNECTION_REVOKED' where owner_id = owner and actor_id = c.id and state in ('proposed', 'approved');
  perform jarvis_record(owner, 'revoke_agent', 'user', null, 'Revoked access · ' || c.display_name, 'project', 'confirmed',
                        encode(sha256(convert_to(c.id::text || ':' || (c.auth_epoch + 1)::text, 'UTF8')), 'hex'),
                        'revoke:' || c.id::text || ':' || (c.auth_epoch + 1)::text, c.display_name, 'verified_jarvis');
  return jsonb_build_object('status', 'revoked', 'auth_epoch', c.auth_epoch + 1);
end;
$$;

-- A manual import: a JSON response from an assistant, or pasted prose. Each
-- item becomes a proposal the person reviews; prose is Mentioned, never
-- Decided. Authority fields in the file are refused whole.
create or replace function proposals_import(p_job uuid, p_items jsonb, p_source text default 'import')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  j job%rowtype;
  it jsonb;
  n integer := 0;
  ids uuid[] := '{}';
  pid uuid;
  cls text;
  payload jsonb;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 or length(p_items::text) > 262144 then
    return jsonb_build_object('error', 'IMPORT_INVALID');
  end if;
  select * into j from job where id = p_job and owner_id = owner;
  if not found or j.status <> 'open' or j.project_id is null then return jsonb_build_object('error', 'SCOPE_DENIED'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if not jarvis_payload_clean(it) then return jsonb_build_object('error', 'IMPORT_INVALID'); end if;
    if (it ->> 'statement') is null or length(it ->> 'statement') not between 1 and 500 then return jsonb_build_object('error', 'IMPORT_INVALID'); end if;
    if coalesce(it ->> 'type', 'decision') not in ('decision', 'constraint_change') then return jsonb_build_object('error', 'IMPORT_INVALID'); end if;
    cls := case when p_source = 'prose' then 'mentioned' when coalesce(it ->> 'classification', 'mentioned') = 'decided' then 'decided' else 'mentioned' end;
    payload := jsonb_build_object('statement', it ->> 'statement', 'rationale', left(coalesce(it ->> 'rationale', ''), 4000), 'classification', cls, 'origin', 'untrusted_suggestion');
    n := n + 1;
  end loop;
  for it in select * from jsonb_array_elements(p_items) loop
    cls := case when p_source = 'prose' then 'mentioned' when coalesce(it ->> 'classification', 'mentioned') = 'decided' then 'decided' else 'mentioned' end;
    payload := jsonb_build_object('statement', it ->> 'statement', 'rationale', left(coalesce(it ->> 'rationale', ''), 4000), 'classification', cls, 'origin', 'untrusted_suggestion');
    insert into proposal (owner_id, job_id, agent_id, surface, type, payload, payload_hash, created_by)
    values (owner, p_job, j.agent_id, 'project', coalesce(it ->> 'type', 'decision'), payload, encode(sha256(convert_to(payload::text, 'UTF8')), 'hex'), 'import')
    returning id into pid;
    ids := ids || pid;
  end loop;
  perform jarvis_record(owner, 'import_proposals', 'user', null, format('Imported %s %s to review', n, case when n = 1 then 'suggestion' else 'suggestions' end), 'project', 'confirmed',
                        encode(sha256(convert_to(p_items::text, 'UTF8')), 'hex'), 'import:' || gen_random_uuid()::text, coalesce((select data ->> 'title' from item where id = j.project_id), ''), 'verified_jarvis');
  return jsonb_build_object('proposal_ids', to_jsonb(ids), 'count', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Internal helpers get none. Agent-side commands: service_role.
--    Person-side commands: authenticated.
-- ---------------------------------------------------------------------------
revoke all on function jarvis_ai_switch(uuid) from public, anon, authenticated;
revoke all on function jarvis_record(uuid, text, text, uuid, text, text, text, text, text, text, text, uuid[], uuid, uuid) from public, anon, authenticated;
revoke all on function jarvis_context_fields(text) from public, anon, authenticated;
revoke all on function jarvis_context_rows(uuid, uuid, uuid[], text[]) from public, anon, authenticated;
revoke all on function jarvis_context_shape(uuid, uuid, uuid[], text[]) from public, anon, authenticated;
revoke all on function jarvis_payload_clean(jsonb) from public, anon, authenticated;

revoke all on function agent_connection_verify(uuid, uuid, text, text[], text) from public, anon, authenticated;
revoke all on function agent_resolve_token(text) from public, anon, authenticated;
revoke all on function agent_rate_take(uuid, integer) from public, anon, authenticated;
revoke all on function agent_capabilities(uuid, uuid) from public, anon, authenticated;
revoke all on function context_snapshot_store(uuid, uuid, text) from public, anon, authenticated;
revoke all on function context_packages_sweep() from public, anon, authenticated;
revoke all on function proposal_submit(uuid, uuid, uuid, text, text, jsonb, uuid[], text) from public, anon, authenticated;
revoke all on function draft_submit(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function action_status(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function review_link(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function review_link(uuid, uuid, uuid) to service_role;
grant execute on function agent_connection_verify(uuid, uuid, text, text[], text) to service_role;
grant execute on function agent_resolve_token(text) to service_role;
grant execute on function agent_rate_take(uuid, integer) to service_role;
grant execute on function agent_capabilities(uuid, uuid) to service_role;
grant execute on function context_snapshot_store(uuid, uuid, text) to service_role;
grant execute on function context_packages_sweep() to service_role;
grant execute on function proposal_submit(uuid, uuid, uuid, text, text, jsonb, uuid[], text) to service_role;
grant execute on function draft_submit(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function action_status(uuid, uuid, uuid) to service_role;

revoke all on function context_preview(uuid, uuid[], text[], text, uuid, uuid) from public, anon;
revoke all on function context_issue(uuid, text, uuid[], text[], text, uuid, uuid) from public, anon;
revoke all on function scope_grant_create(uuid, text, text, uuid[], text[], text) from public, anon;
revoke all on function connection_revoke(uuid) from public, anon;
revoke all on function proposals_import(uuid, jsonb, text) from public, anon;
grant execute on function context_preview(uuid, uuid[], text[], text, uuid, uuid) to authenticated, service_role;
grant execute on function context_issue(uuid, text, uuid[], text[], text, uuid, uuid) to authenticated, service_role;
grant execute on function scope_grant_create(uuid, text, text, uuid[], text[], text) to authenticated;
grant execute on function connection_revoke(uuid) to authenticated;
grant execute on function proposals_import(uuid, jsonb, text) to authenticated;
