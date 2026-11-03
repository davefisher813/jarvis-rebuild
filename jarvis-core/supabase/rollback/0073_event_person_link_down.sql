-- Rollback of 0073 (2026-10-31): the registry goes back to 0060's list, and the event-person rows come out of item_link,
-- because with the registry row gone nothing maintains them. No item row is touched.
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

delete from item_link where from_type = 'event' and path = 'personId';
