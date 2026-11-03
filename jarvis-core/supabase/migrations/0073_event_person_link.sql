-- 0073: AN EVENT'S PERSON IS A LINK (2026-10-31). PREPARED FOR DAVE'S REVIEW. NOT APPLIED.
--
-- Since 2026-10-27 an event carries a person (EventData.personId, the event sheet's Person row; Dave, "Text Josh Rudd"). The
-- app writes the id into item.data like every other pointer, but jarvis_link_paths() (0060) did not list it, so item_link
-- never projected it: the event's person was invisible to item_why, the history's link view and anything that reads the
-- projection. CLAUDE.md records it: "a DB projection needs a migration and the linkLaw change with it". This is that
-- migration.
--
-- What it does, and nothing else:
--   1. Replaces jarvis_link_paths() with 0060's exact list plus one row: ('event', 'personId', '$.personId', 'about').
--      The kind 'about' is already in item_link's check constraint (a task's person uses it), so no constraint changes.
--   2. Projects the pointers that already exist: for every event whose data already holds a personId, one item_link row,
--      created_by 'operator', via 'backfill_0073', exactly as 0060's backfill marked what it found. A second run writes
--      nothing (on conflict do nothing). No item row is read for writing, changed or deleted; item_change is not touched.
--
-- What it does not do: change any item, any column, any policy, any grant, or any other function. The trigger
-- (jarvis_item_memory) already reads the registry through jarvis_links_of(), so new and edited events project their person
-- from the moment this function is replaced.
--
-- Rollback: supabase/rollback/0073_event_person_link_down.sql (0060's list back, and only the rows this migration's
-- backfill wrote are removed; rows the trigger projected after it ran stay correct pointers and are removed too, because
-- without the registry row nothing would maintain them).
-- Proof: supabase/tests/event_person_link.sh on the local Postgres (forward twice, checks, rollback, forward again).

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
    ('event', 'personId', '$.personId', 'about'),
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

-- The pointers already there, as operator via backfill_0073. Events only; a second run writes nothing.
insert into item_link (owner_id, from_item, from_type, target, to_item, to_type, kind, path, created_by, via)
select i.owner_id, i.id, i.entity_type, l.target, t.id, t.entity_type, l.kind, l.path, 'operator', 'backfill_0073'
  from item i
  cross join lateral jarvis_links_of(i.entity_type, i.data, i.id) l
  left join item t on t.id = l.target and t.owner_id = i.owner_id
 where i.entity_type = 'event' and l.path = 'personId'
on conflict (owner_id, from_item, target, kind, path) do nothing;
