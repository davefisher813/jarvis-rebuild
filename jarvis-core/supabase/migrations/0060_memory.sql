-- Migration 0060: memory, the database records why it knows a thing (Phase 0 design D1, D2, D9; 2026-10-10).
--
-- Two questions this account could not answer before this file: "Why does JARVIS know this?"
-- and "What does this record point at?" Every write to `item` (the Store, the seven SQL doors,
-- the server, a hand edit in the SQL editor) passes one seam, an AFTER trigger on the table, and
-- that seam now writes history beside the record and projects the record's pointers into one
-- relationship table. Nothing the app writes changes shape: the JSONB fields stay the one write
-- path, and item_link is a projection of them, never a table the browser writes.
--
--   item_change  one row per insert, update and delete of an item: which keys moved, the old and
--                new values for those keys under four closed rules, when (server clock), when the
--                person acted (client_at), and who: origin and the door (via).
--   item_link    one row per pointer a record holds, from a closed registry of 42 paths, with the
--                target id kept as written and the resolved row beside it (null when gone or never
--                the owner's).
--
-- The rules this file carries:
--   1. Origin is derived by the database, never declared by the caller. `server` when the request
--      role is service_role; `function` when a SECURITY DEFINER PL/pgSQL frame is on the call
--      stack, with the INNERMOST such name as `via` (pg_context lists frames innermost first);
--      `user` when the request role is anon or authenticated and no definer frame is present
--      (item_apply_patch and item_apply_patch_if_older are invokers); `operator` otherwise (the
--      SQL editor, psql, a migration's own statements).
--   2. client_at is the capture moment: an insert's created_at (an offline create replays with its
--      own time), and for a patch the `jarvis.client_at` setting the two patch functions set from
--      their p_client_at, else now(). The two functions refuse a p_client_at that is not finite
--      (item_apply_patch answers false, item_apply_patch_if_older answers 'stale', nothing is
--      written) and stamp at most now() + interval '5 minutes', so a caller's clock can claim an
--      earlier moment but never a far future one. item_apply_patch is dropped and recreated with a
--      third, defaulted parameter in this one transaction so the live app's two argument call keeps
--      resolving (a second overload would give PostgREST two candidates).
--   3. Values are recorded for changed keys only, with JSON null and absence treated as one value,
--      under four closed rules: NOISE_KEYS keep the name and never the value; BULK_KEYS and any
--      value over 2048 bytes are recorded as {"_omitted": "bulk", "bytes": n}; EXCLUDED_KINDS keep
--      keys and never values. The 2048 is octet_length of the value's JSON text, quotes included: a
--      string of 2046 ASCII characters is kept, one of 2047 is omitted. An update whose normalised
--      diff is empty writes no row. A change of entity_type alone is a change: the row carries
--      changed_keys {entity_type} with the two type words as before and after, and the links are
--      recomputed for the new kind (from_type follows).
--   4. Deleting an item erases every value in its history and writes a keys only delete row:
--      history holds small values while the record lives and only facts once it is gone.
--   5. item_change is append only by trigger: the only update it accepts is an erasure, and only
--      the server deletes (delete_owned, item_change_prune). history_erase blanks a living
--      record's history for the owner; item_change_prune is a service request, never scheduled,
--      and never removes an item's first row, so the origin answer survives any retention.
--   6. item_link is maintained by the same trigger from jarvis_link_paths(), the closed registry
--      mirrored by app/substrate/links/paths.ts. Both ends are composite (id, owner_id) foreign
--      keys; the target id is kept beside the resolved one; a recreate under the same id heals a
--      dangling pointer; a self pointer projects nothing and never blocks a save. The link's
--      author rides on the row's own Source stamp: `rule` when the path's leaf is in
--      source.inferred on a browser insert, `import` inside record_approve, `function` with via
--      for a definer door, else the write's origin. Categories and external identities are not
--      links (the registry header says why).
--   7. The only backfill is of links, as created_by operator, via backfill_0060: the pointer
--      existed on that date; who set it is not recorded. No history rows are invented.
--   8. Every table has RLS on, the double revoke, exact grants and owner policies written
--      (select auth.uid()). Every function carries set search_path, a revoke line and a narrow
--      grant. item_why is SECURITY INVOKER so row level security scopes every join.
--
-- Additive: no column of an existing table changes; five functions are replaced with their
-- current bodies plus the stated diffs (item_apply_patch, item_apply_patch_if_older,
-- set_monotonic_updated_at, substrate_readiness, delete_owned).
-- Rollback: supabase/rollback/0060_memory_down.sql (the exact inverse; the two tables are derived
-- records and are dropped; copy them out first if the history is wanted).
-- Proof: supabase/tests/memory.sh on the local Postgres (forward twice, 49 checks, rollback,
-- forward again). Rehearsed by supabase/tests/rehearsal.sh.
--
-- Review fixes (2026-10-10), from the adversarial SQL review of the working tree:
--   6. item_apply_patch and item_apply_patch_if_older refuse a non finite p_client_at (false / 'stale',
--      the functions' own refusal shapes) and clamp the recorded moment to now() + interval '5 minutes'
--      (rule 2). rollback/0060_memory_down.sql restores the 0031 and 0032 bodies, which carry no
--      client_at at all, so it needs no mirror; 0061 and its rollback never touch these two bodies.
--   7. jarvis_item_memory treats old.entity_type <> new.entity_type as a change (rule 3): a history
--      row with changed_keys {entity_type}, and the links recomputed for the new kind with from_type
--      updated, where before such an update wrote no row and left item_link stale.
--   9. Header note, no body change: the 2048 byte value cap counts JSON text bytes, quotes included (rule 3).

-- ---------------------------------------------------------------------------
-- 1. item_change: history beside the record.
-- ---------------------------------------------------------------------------
create table if not exists item_change (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  item_id uuid not null,
  entity_type text not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  changed_keys text[] not null,
  before jsonb,
  after jsonb,
  revision timestamptz not null,
  at timestamptz not null default now(),
  client_at timestamptz,
  origin text not null check (origin in ('user', 'function', 'server', 'operator')),
  via text check (via is null or via ~ '^[a-z0-9_]{1,64}$'),
  erased_at timestamptz
);
create index if not exists item_change_owner_item_idx on item_change (owner_id, item_id, at desc);
create index if not exists item_change_owner_at_idx on item_change (owner_id, at);

alter table item_change enable row level security;
revoke all on table item_change from public;
revoke all on table item_change from anon, authenticated;
grant select on table item_change to authenticated;
grant all on table item_change to service_role;
drop policy if exists item_change_select on item_change;
create policy item_change_select on item_change for select using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. item_link: the projection of every pointer a record holds.
-- ---------------------------------------------------------------------------
create table if not exists item_link (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  from_item uuid not null,
  from_type text not null,
  target uuid not null,
  to_item uuid,
  to_type text,
  kind text not null check (kind in ('about', 'in', 'under', 'for', 'from', 'became', 'has', 'mentions',
                                    'replaces', 'replaced_by', 'because_of', 'pays', 'matches', 'attached', 'reminds', 'triggers')),
  path text not null,
  created_by text not null check (created_by in ('user', 'rule', 'function', 'import', 'server', 'operator')),
  via text check (via is null or via ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, from_item, target, kind, path),
  check (from_item <> target),
  foreign key (from_item, owner_id) references item (id, owner_id) on delete cascade,
  foreign key (to_item, owner_id) references item (id, owner_id) on delete set null (to_item)
);
create index if not exists item_link_owner_to_idx on item_link (owner_id, to_item) where to_item is not null;
create index if not exists item_link_owner_target_idx on item_link (owner_id, target);
create index if not exists item_link_owner_from_idx on item_link (owner_id, from_item);
create index if not exists item_link_owner_kind_idx on item_link (owner_id, kind);

drop trigger if exists item_link_touch on item_link;
create trigger item_link_touch before insert or update on item_link
  for each row execute function jarvis_touch_updated_at();

alter table item_link enable row level security;
revoke all on table item_link from public;
revoke all on table item_link from anon, authenticated;
grant select on table item_link to authenticated;
grant all on table item_link to service_role;
drop policy if exists item_link_select on item_link;
create policy item_link_select on item_link for select using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. The closed registry of link paths. One row per pointer path, in the
--    REFERENCE_FIELDS spelling (app/backup/references.ts), with the jsonpath
--    that extracts it and the kind the relationship reads as. Mirrored by
--    app/substrate/links/paths.ts; laws/linkLaw.test.ts parses both.
--
--    Not links, on purpose:
--      category, extraCategories[], categoryIds[], tags[], gameCategoryId and the month_seal
--        keys: a classification, single valued data with 192 readers, not a relationship.
--      fromThread, gcalId, bookingId, clientId, emailIds[], sourceUid, source.ref of a non item
--        type: external identities, not rows of item.
--      note.found[].targetId: a suggestion not taken.
--      exploration_note.evidenceIds[], waiting.sourceEvidenceId: point at source_evidence.
-- ---------------------------------------------------------------------------
create or replace function jarvis_link_paths()
returns table (entity_type text, path text, jsonpath text, kind text)
language sql
immutable
set search_path = public
as $$
  values
    ('task', 'personId', '$.personId', 'about'),
    ('task', 'projectId', '$.projectId', 'in'),
    ('task', 'goalId', '$.goalId', 'under'),
    ('task', 'eventId', '$.eventId', 'for'),
    ('task', 'fromNote', '$.fromNote', 'from'),
    ('task', 'reminder.linkedItem.id', '$.reminder.linkedItem.id', 'reminds'),
    ('task', 'plan.contextTrigger.targetId', '$.plan.contextTrigger.targetId', 'triggers'),
    ('event', 'sourceTaskId', '$.sourceTaskId', 'from'),
    ('event', 'taskIds[]', '$.taskIds[*]', 'has'),
    ('event', 'projectId', '$.projectId', 'in'),
    ('note', 'connections[].targetId', '$.connections[*] ? (@.kind == "person").targetId', 'about'),
    ('note', 'connections[].targetId', '$.connections[*] ? (!exists(@.kind) || @.kind != "person").targetId', 'mentions'),
    ('note', 'blocks[].items[].taskId', '$.blocks[*].items[*].taskId', 'has'),
    ('project', 'goalId', '$.goalId', 'under'),
    ('goal', 'areaId', '$.areaId', 'under'),
    ('goal', 'dropped.decisionId', '$.dropped.decisionId', 'because_of'),
    ('decision_record', 'linkedId', '$.linkedId', 'mentions'),
    ('decision_record', 'supersedesId', '$.supersedesId', 'replaces'),
    ('decision_record', 'supersededById', '$.supersededById', 'replaced_by'),
    ('decision_record', 'links[].id', '$.links[*].id', 'mentions'),
    ('decision_record', 'ruleStrandId', '$.ruleStrandId', 'because_of'),
    ('decision_record', 'source.entityId', '$.source.entityId', 'from'),
    ('strand', 'link.entityId', '$.link.entityId', 'mentions'),
    ('brain_memory', 'linkedItemIds[]', '$.linkedItemIds[*]', 'mentions'),
    ('brain_memory', 'supersedes', '$.supersedes', 'replaces'),
    ('brain_memory', 'supersededBy', '$.supersededBy', 'replaced_by'),
    ('waiting', 'contactId', '$.contactId', 'about'),
    ('exploration_note', 'projectId', '$.projectId', 'in'),
    ('exploration_note', 'promotedToItemId', '$.promotedToItemId', 'became'),
    ('money_tx', 'paysBillId', '$.paysBillId', 'pays'),
    ('money_tx', 'matchedReceiptId', '$.matchedReceiptId', 'matches'),
    ('money_bill', 'paidEvidence.transactionId', '$.paidEvidence.transactionId', 'because_of'),
    ('money_receipt', 'linkedTransactionId', '$.linkedTransactionId', 'matches'),
    ('money_receipt', 'attachmentFileId', '$.attachmentFileId', 'attached'),
    ('workout', 'programId', '$.programId', 'in'),
    ('metric_log', 'metricId', '$.metricId', 'in'),
    ('health_ate_before', 'eventId', '$.eventId', 'for'),
    ('health_call_it', 'eventId', '$.eventId', 'for'),
    ('health_bag_check', 'eventId', '$.eventId', 'for'),
    ('health_took_it', 'medId', '$.medId', 'for'),
    ('health_trusted_adult', 'personId', '$.personId', 'about'),
    ('chat_message', 'provenance.refs[].id', '$.provenance.refs[*].id', 'mentions');
$$;
revoke all on function jarvis_link_paths() from public, anon, authenticated;

-- The pointers one record holds: every registry path of its kind that yields a
-- uuid, minus a pointer at the record itself. Pure; the trigger and the
-- backfill both read it.
create or replace function jarvis_links_of(p_type text, p_data jsonb, p_self uuid default null)
returns table (path text, kind text, target uuid)
language sql
immutable
set search_path = public
as $$
  select r.path, r.kind, (v #>> '{}')::uuid
    from jarvis_link_paths() r
    cross join lateral jsonb_path_query(p_data, r.jsonpath::jsonpath) v
   where r.entity_type = p_type
     and jsonb_typeof(v) = 'string'
     and (v #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (p_self is null or (v #>> '{}')::uuid <> p_self);
$$;
revoke all on function jarvis_links_of(text, jsonb, uuid) from public, anon, authenticated;

-- The backfill: every pointer already in item, as operator via backfill_0060.
-- A second run writes nothing. No browser grant.
create or replace function jarvis_link_project_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into item_link (owner_id, from_item, from_type, target, to_item, to_type, kind, path, created_by, via)
  select i.owner_id, i.id, i.entity_type, l.target, t.id, t.entity_type, l.kind, l.path, 'operator', 'backfill_0060'
    from item i
    cross join lateral jarvis_links_of(i.entity_type, i.data, i.id) l
    left join item t on t.id = l.target and t.owner_id = i.owner_id
  on conflict (owner_id, from_item, target, kind, path) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function jarvis_link_project_all() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The seam: one AFTER trigger on item writes the history row and keeps the
--    projection. SECURITY DEFINER so it may write item_change and item_link,
--    which no browser role may. It never swallows an error: a failed history
--    write fails the item write.
-- ---------------------------------------------------------------------------
create or replace function jarvis_item_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The four closed rules (D1 change 3). laws/runVocabulary.test.ts reads NOISE_KEYS from this line.
  NOISE_KEYS constant text[] := array['runLen', 'bestRun', 'lastCounted', 'doneCount'];
  BULK_KEYS constant text[] := array['doc', 'blocks', 'versions', 'revisions', 'history', 'gcalHash', 'found', 'attendees'];
  VALUE_CAP constant integer := 2048;
  EXCLUDED_KINDS constant text[] := array['health_consent', 'metric_log', 'profile', 'chat_message', 'user_file', 'brain_doc'];
  v_ctx text;
  v_frames text[];
  v_origin text;
  v_via text;
  v_client_at timestamptz;
  v_old jsonb;
  v_new jsonb;
  v_keys text[];
  v_before jsonb;
  v_after jsonb;
  v_excluded boolean;
  v_roots text[];
begin
  -- 1. Origin and via, from the call stack and the request role.
  get diagnostics v_ctx = pg_context;
  select coalesce(array_agg(f.name order by f.ord), '{}')
    into v_frames
    from (select r.m[1] as name, r.ord
            from regexp_matches(v_ctx, 'PL/pgSQL function (?:[a-z0-9_]+\.)?([a-z0-9_]+)\(', 'g') with ordinality as r(m, ord)) f
   where f.name <> 'jarvis_item_memory'
     and exists (select 1 from pg_proc p where p.proname = f.name and p.prosecdef);
  v_origin := case
    when coalesce(auth.role(), '') = 'service_role' then 'server'
    when cardinality(v_frames) > 0 then 'function'
    when current_setting('role', true) in ('anon', 'authenticated') then 'user'
    else 'operator' end;
  if v_origin = 'function' then v_via := v_frames[1]; end if;

  -- 2. Delete: erase every value this id ever had, then the keys only delete row.
  if tg_op = 'DELETE' then
    v_old := case when jsonb_typeof(old.data) = 'object' then old.data else '{}'::jsonb end;
    v_client_at := coalesce(nullif(current_setting('jarvis.client_at', true), '')::timestamptz, now());
    update item_change set before = null, after = null, erased_at = now()
     where owner_id = old.owner_id and item_id = old.id and erased_at is null;
    select coalesce(array_agg(k order by k), '{}') into v_keys from jsonb_object_keys(v_old) k;
    insert into item_change (owner_id, item_id, entity_type, op, changed_keys, before, after, revision, client_at, origin, via)
    values (old.owner_id, old.id, old.entity_type, 'delete', v_keys, null, null, old.updated_at, v_client_at, v_origin, v_via);
    return old;
  end if;

  v_new := case when jsonb_typeof(new.data) = 'object' then new.data else '{}'::jsonb end;
  v_excluded := new.entity_type like 'health\_%' or new.entity_type = any(EXCLUDED_KINDS);

  -- 3. The history row.
  if tg_op = 'INSERT' then
    v_client_at := new.created_at;
    select coalesce(array_agg(e.k order by e.k), '{}') into v_keys
      from jsonb_each(v_new) e(k, v) where jsonb_typeof(e.v) <> 'null';
    if not v_excluded then
      select coalesce(jsonb_object_agg(k, case when k = any(BULK_KEYS) or octet_length(x.v::text) > VALUE_CAP
                                              then jsonb_build_object('_omitted', 'bulk', 'bytes', octet_length(x.v::text)) else x.v end), '{}'::jsonb)
        into v_after
        from unnest(v_keys) k cross join lateral (select coalesce(v_new -> k, 'null'::jsonb) as v) x
       where not (k = any(NOISE_KEYS));
    end if;
    insert into item_change (owner_id, item_id, entity_type, op, changed_keys, before, after, revision, client_at, origin, via)
    values (new.owner_id, new.id, new.entity_type, 'insert', v_keys, null, v_after, new.updated_at, v_client_at, v_origin, v_via);
  else
    v_old := case when jsonb_typeof(old.data) = 'object' then old.data else '{}'::jsonb end;
    -- JSON null and absence are one value: the patch path strips nulls, a create keeps them.
    select coalesce(array_agg(ks.k order by ks.k), '{}') into v_keys
      from (select k from jsonb_object_keys(v_old) k union select k from jsonb_object_keys(v_new) k) ks
     where coalesce(v_old -> ks.k, 'null'::jsonb) is distinct from coalesce(v_new -> ks.k, 'null'::jsonb);
    -- The kind itself is a key: a row that becomes another kind has changed.
    if old.entity_type <> new.entity_type then
      select array_agg(distinct x.k order by x.k) into v_keys from unnest(v_keys || 'entity_type'::text) as x(k);
    end if;
    if cardinality(v_keys) = 0 then
      return new;
    end if;
    v_client_at := coalesce(nullif(current_setting('jarvis.client_at', true), '')::timestamptz, now());
    if not v_excluded then
      select coalesce(jsonb_object_agg(k, case when k = any(BULK_KEYS) or octet_length(x.v::text) > VALUE_CAP
                                              then jsonb_build_object('_omitted', 'bulk', 'bytes', octet_length(x.v::text)) else x.v end), '{}'::jsonb)
        into v_before
        from unnest(v_keys) k cross join lateral (select coalesce(v_old -> k, 'null'::jsonb) as v) x
       where not (k = any(NOISE_KEYS));
      select coalesce(jsonb_object_agg(k, case when k = any(BULK_KEYS) or octet_length(x.v::text) > VALUE_CAP
                                              then jsonb_build_object('_omitted', 'bulk', 'bytes', octet_length(x.v::text)) else x.v end), '{}'::jsonb)
        into v_after
        from unnest(v_keys) k cross join lateral (select coalesce(v_new -> k, 'null'::jsonb) as v) x
       where not (k = any(NOISE_KEYS));
      if old.entity_type <> new.entity_type then
        v_before := v_before || jsonb_build_object('entity_type', old.entity_type);
        v_after := v_after || jsonb_build_object('entity_type', new.entity_type);
      end if;
    end if;
    insert into item_change (owner_id, item_id, entity_type, op, changed_keys, before, after, revision, client_at, origin, via)
    values (new.owner_id, new.id, new.entity_type, 'update', v_keys, v_before, v_after, new.updated_at, v_client_at, v_origin, v_via);
  end if;

  -- 4. Links.
  if tg_op = 'INSERT' then
    insert into item_link (owner_id, from_item, from_type, target, to_item, to_type, kind, path, created_by, via)
    select new.owner_id, new.id, new.entity_type, l.target, t.id, t.entity_type, l.kind, l.path,
           case when v_via = 'record_approve' then 'import'
                when v_origin = 'user'
                 and jsonb_typeof(v_new -> 'source' -> 'inferred') = 'array'
                 and (v_new -> 'source' -> 'inferred') ? regexp_replace(regexp_replace(l.path, '^.*\.', ''), '\[\]$', '') then 'rule'
                else v_origin end,
           v_via
      from jarvis_links_of(new.entity_type, v_new, new.id) l
      left join item t on t.id = l.target and t.owner_id = new.owner_id
    on conflict (owner_id, from_item, target, kind, path) do nothing;
    -- A recreate under the same id heals every pointer that was waiting for it.
    update item_link set to_item = new.id, to_type = new.entity_type
     where owner_id = new.owner_id and target = new.id and to_item is null;
  else
    -- Only when a changed key is the root of a registry path for this kind, or the kind itself changed.
    select array_agg(distinct regexp_replace(split_part(r.path, '.', 1), '\[\]$', ''))
      into v_roots from jarvis_link_paths() r where r.entity_type = new.entity_type;
    if (v_roots is not null and v_keys && v_roots) or old.entity_type <> new.entity_type then
      update item_link set from_type = new.entity_type
       where owner_id = new.owner_id and from_item = new.id and from_type <> new.entity_type;
      insert into item_link (owner_id, from_item, from_type, target, to_item, to_type, kind, path, created_by, via)
      select new.owner_id, new.id, new.entity_type, l.target, t.id, t.entity_type, l.kind, l.path,
             case when v_via = 'record_approve' then 'import' else v_origin end, v_via
        from jarvis_links_of(new.entity_type, v_new, new.id) l
        left join item t on t.id = l.target and t.owner_id = new.owner_id
      on conflict (owner_id, from_item, target, kind, path) do nothing;
      delete from item_link il
       where il.owner_id = new.owner_id and il.from_item = new.id
         and not exists (select 1 from jarvis_links_of(new.entity_type, v_new, new.id) l
                          where l.path = il.path and l.kind = il.kind and l.target = il.target);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function jarvis_item_memory() from public, anon, authenticated;

-- Not "drop trigger if exists ... create trigger": DROP TRIGGER takes an ACCESS
-- EXCLUSIVE lock on item, the table the app runs on, even when there is
-- nothing to drop (the 0052 lesson on auth.users). CREATE TRIGGER takes SHARE
-- ROW EXCLUSIVE, which waits for no read. AFTER, so item_set_updated_at
-- (BEFORE, 0001) has stamped the revision this row records.
do $mig$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'item'::regclass and tgname = 'item_memory' and not tgisinternal
  ) then
    create trigger item_memory
      after insert or update or delete on item
      for each row execute function jarvis_item_memory();
  end if;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 5. History is append only. The only update a row accepts is an erasure
--    (changed_keys, before, after and erased_at may move, erased_at must be
--    set); only the server deletes (delete_owned, item_change_prune).
-- ---------------------------------------------------------------------------
create or replace function jarvis_item_change_append_only()
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
    raise exception 'item_change is append-only' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  o := to_jsonb(old);
  n := to_jsonb(new);
  for col in select key from jsonb_object_keys(o) as k(key) loop
    if col in ('changed_keys', 'before', 'after', 'erased_at') then
      continue;
    end if;
    if (o -> col) is distinct from (n -> col) then
      raise exception 'item_change.% cannot change after it is written', col using errcode = '42501';
    end if;
  end loop;
  if new.erased_at is null then
    raise exception 'the only update a history row accepts is an erasure' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function jarvis_item_change_append_only() from public, anon, authenticated;

drop trigger if exists item_change_append_only on item_change;
create trigger item_change_append_only before update or delete on item_change
  for each row execute function jarvis_item_change_append_only();

-- The owner's erasure of a living record's history: the words go, the facts
-- (op, at, client_at, origin, via) stay. It does not undo a change.
create or replace function history_erase(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := auth.uid();
  n integer;
begin
  if owner is null then return jsonb_build_object('error', 'AUTH_REQUIRED'); end if;
  update item_change
     set changed_keys = '{}', before = null, after = null, erased_at = coalesce(erased_at, now())
   where owner_id = owner and item_id = p_item
     and (erased_at is null or changed_keys <> '{}' or before is not null or after is not null);
  get diagnostics n = row_count;
  return jsonb_build_object('item_id', p_item, 'erased_rows', n, 'note', 'Erasing history does not undo a change.');
end;
$$;
revoke all on function history_erase(uuid) from public, anon, authenticated;
grant execute on function history_erase(uuid) to authenticated;

-- Retention, as a service request only and never scheduled: rows older than
-- the interval go, except each item's earliest row, so the origin answer
-- survives any retention.
create or replace function item_change_prune(p_older_than interval default interval '365 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not jarvis_is_service_request() then
    raise exception 'item_change_prune is a service request' using errcode = '42501';
  end if;
  delete from item_change c
   where c.at < now() - p_older_than
     and exists (select 1 from item_change f
                  where f.owner_id = c.owner_id and f.item_id = c.item_id and (f.at, f.id) < (c.at, c.id));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function item_change_prune(interval) from public, anon, authenticated;
grant execute on function item_change_prune(interval) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The two patch functions carry the capture moment. item_apply_patch is
--    dropped and recreated with a defaulted third parameter in this same
--    transaction (a second overload would be PGRST203 for the live app's two
--    argument call); the body is 0031's plus the first statement and the
--    search_path. item_apply_patch_if_older is 0032's body plus the same two.
-- ---------------------------------------------------------------------------
drop function if exists item_apply_patch(uuid, jsonb);
create or replace function item_apply_patch(p_id uuid, p_patch jsonb, p_client_at timestamptz default null)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  n int;
begin
  -- A moment, not a word: a non finite stamp is refused, a far future one is clamped (rule 2).
  if p_client_at is not null and not isfinite(p_client_at) then return false; end if;
  perform set_config('jarvis.client_at', case when p_client_at is null then '' else least(p_client_at, now() + interval '5 minutes')::text end, true);
  update item
     set data = jsonb_strip_nulls(data || p_patch)
   where id = p_id;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function item_apply_patch(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function item_apply_patch(uuid, jsonb, timestamptz) to authenticated, service_role;

create or replace function item_apply_patch_if_older(p_id uuid, p_patch jsonb, p_client_at timestamptz)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  cur timestamptz;
  n int;
begin
  -- A moment, not a word: a non finite stamp is refused, a far future one is clamped (rule 2).
  if p_client_at is not null and not isfinite(p_client_at) then return 'stale'; end if;
  perform set_config('jarvis.client_at', case when p_client_at is null then '' else least(p_client_at, now() + interval '5 minutes')::text end, true);
  select updated_at into cur from item where id = p_id;
  if cur is null then
    return 'missing';
  end if;
  -- Strictly newer only. A row written in the same instant is not newer, so
  -- a replay can never be refused by its own earlier attempt.
  if cur > p_client_at then
    return 'stale';
  end if;
  update item
     set data = jsonb_strip_nulls(data || p_patch)
   where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then
    return 'missing';
  end if;
  return 'applied';
end;
$$;
revoke all on function item_apply_patch_if_older(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function item_apply_patch_if_older(uuid, jsonb, timestamptz) to authenticated, service_role;

-- 0001's body, byte for byte, plus the search_path. A trigger function needs
-- no grant to fire.
create or replace function set_monotonic_updated_at()
returns trigger
language plpgsql
set search_path = public
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
revoke all on function set_monotonic_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. "Why does JARVIS know this?" for one item, for the developer and the
--    exit test. SECURITY INVOKER: row level security scopes every join, so
--    another owner's item answers null. evidence.source_app and
--    source_record_id are null constants here; 0061 redefines item_why with
--    the real columns, and the same for proposals.source_app.
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
revoke all on function item_why(uuid) from public, anon, authenticated;
grant execute on function item_why(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Readiness: the 0044 body with the migration number and Phase 0's probes.
--    `registered` is unchanged.
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
    'migration', '0060',
    'registered', (
      select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
      from entity_type
      where key in ('money_bill', 'money_receipt', 'task', 'event', 'waiting', 'exploration_note', 'decision_record')
    ),
    'phase0', jsonb_build_object(
      'memory', to_regclass('public.item_change') is not null and to_regprocedure('public.item_why(uuid)') is not null,
      'inbox', to_regprocedure('public.record_push(uuid, uuid, text, jsonb)') is not null,
      'private', case when to_regclass('public.feedback') is null then false
                      else not has_table_privilege('authenticated', 'public.feedback', 'select') end
    )
  );
$$;
revoke all on function substrate_readiness() from public, anon, authenticated;
grant execute on function substrate_readiness() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Account deletion reaches both tables: item_link before the items (the
--    cascade would do it; this says so), item_change LAST, because deleting
--    the items writes delete rows into it. Otherwise the 0044 body.
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
  delete from public.item_link where owner_id = p_uid;
  delete from public.item where owner_id = p_uid;
  delete from public.scalar_setting where owner_id = p_uid;
  delete from public.event_log where owner_id = p_uid;
  delete from public.ai_usage where user_id = p_uid;
  delete from public.ai_tokens where user_id = p_uid;
  delete from public.item_change where owner_id = p_uid;
end;
$$;
revoke all on function delete_owned(uuid) from public, anon, authenticated;
grant execute on function delete_owned(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. The backfill of links only. No history rows are invented for rows that
--     predate this file: item_why answers `unknown` for them.
-- ---------------------------------------------------------------------------
select jarvis_link_project_all();
