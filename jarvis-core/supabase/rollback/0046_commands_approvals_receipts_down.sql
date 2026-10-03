-- Rollback for 0046 (shared commands, exact approvals and receipts).
-- Not a migration: lives outside supabase/migrations so nothing applies it by
-- accident. Removes the functions and the outbox table 0046 added and puts
-- 0044's receipt trigger function back as it was. Actions, approvals and
-- receipts the functions wrote are the person's records and stay in 0044's
-- tables; items written to the life modules stay where they landed.

drop function if exists receipt_detail(uuid);
drop function if exists activity_feed(integer, timestamptz, text);
drop function if exists access_denied_record(uuid, uuid, text, text);
drop function if exists reported_external_record(uuid, uuid, text, text);
drop function if exists outbox_sweep();
drop function if exists approvals_sweep();
drop function if exists outbox_reconcile(uuid, text, text, jsonb);
drop function if exists outbox_settle(uuid, uuid, text, text, jsonb, text);
drop function if exists outbox_dispatched(uuid, uuid);
drop function if exists outbox_claim(text, interval);
drop function if exists command_cancel(uuid);
drop function if exists command_approve(text, text, text);
drop function if exists command_review(text, jsonb, uuid, text, integer);
drop function if exists receipt_erase(uuid);
drop function if exists action_undo(uuid, timestamptz, text);
drop function if exists capture_approve(uuid, integer, text, text, jsonb);
drop function if exists candidate_restore(uuid, integer);
drop function if exists candidate_dismiss(uuid, integer);
drop function if exists candidate_edit(uuid, integer, jsonb, text[], text[]);
drop function if exists jarvis_action_replay(action);
drop function if exists jarvis_action_provisional_email(text, text, text);
drop function if exists jarvis_undo_block(uuid, uuid, timestamptz);
drop function if exists jarvis_capture_valid(text, text, jsonb);
drop function if exists jarvis_receipt_append(uuid, uuid, text, text, text, uuid, text, text, uuid[], uuid, uuid, jsonb, jsonb, text, uuid);
drop table if exists outbox_command;

-- 0044's receipt trigger, as it was before 0046 let an erasure change the verb.
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
