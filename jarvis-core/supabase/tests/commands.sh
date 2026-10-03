#!/usr/bin/env bash
# Real-Postgres proof for migration 0046 (shared commands, exact approvals and
# receipts, slice 03). Runs on the same stubbed Supabase as substrate.sh, with
# 0044's fixtures, and drives the functions the way the person (session), the
# outbox worker (service role) and a second device do.
#
# Usage: eval "$(./local_pg.sh start)"; ./commands.sh
#
# What it proves (IMPLEMENTATION-SPEC.md 07, 15; prompt 03 "Verify before completing"):
#   S14  a transaction that fails after the item write leaves no item, no action, no receipt
#   S15  two taps, two devices, a retry after a timeout: one item, one action, the same answer
#   S16  the global Activity feed carries no provisional Email content, only a count
#   S17  a different hash on the same review is REVIEW_CHANGED; the approval is not reused
#   S18  a timeout after dispatch is outcome_unknown, never failed, never resent
#   S19  erasure leaves a tombstone and no words; the action is not undone
#   S13  an outside-reported action is reported_external and confirms nothing
#   plus: hash replay, approval expiry, stale source, stale destination, undo guards,
#         fenced claims, revocation after dispatch, a bill is never a task.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=commands_test
# UTF8 like the live project: a JSON escape above 007F is a 22P05 in a SQL_ASCII database.
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
as_user() { # uid role sql -> last line
  PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" \
    -c "set role $2" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" \
    -c "$3" 2>&1 | tail -1
}
as_user_state() { # uid role sql -> ok | SQLSTATE
  local out st
  if out=$(PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
      -c "set role $2" \
      -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" \
      -c "$3" 2>&1 >/dev/null); then echo ok; return; fi
  st=$(echo "$out" | sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' | head -1); echo "${st:-fail}"
}
jget() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d
for k in sys.argv[1].split('.'):
    v=v[int(k)] if isinstance(v,list) else v.get(k)
print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))" "$1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }

echo "-- forward: stub + chain 0001..0046, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
echo "-- rollback 0046, forward again (idempotent)"
q -f "$here/../rollback/0046_commands_approvals_receipts_down.sql" >/dev/null
check "rollback removes the command functions and the outbox" 0 "$(q -c "select count(*) from pg_proc where proname in ('capture_approve','action_undo','outbox_claim')" -c "select count(*) from information_schema.tables where table_name = 'outbox_command'" | paste -sd+ | bc)"
q -f "$here/../migrations/0046_commands_approvals_receipts.sql" >/dev/null
q -f "$here/../migrations/0046_commands_approvals_receipts.sql" >/dev/null
check "forward again is idempotent" 3 "$(q -c "select count(*) from pg_proc where proname in ('capture_approve','action_undo','outbox_claim')")"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
CONN=50000000-0000-0000-0000-00000000000a
ACCT=60000000-0000-0000-0000-00000000000a
MSG_BILL=70000000-0000-0000-0000-00000000000a
MSG_TASK=70000000-0000-0000-0000-0000000000a2
C_BILL=90000000-0000-0000-0000-00000000000a
C_TASK=90000000-0000-0000-0000-0000000000a2
C_B=90000000-0000-0000-0000-00000000000b
SVC=service_role
AUTH=authenticated
BILL_PREP='{"destination_kind":"money_bill","data":{"vendor":"Con Edison","amountCents":14230,"currency":"USD","dueDate":"2026-10-15","category":"Utilities","fingerprint":"fp-bill-con-edison-14230-2026-10-15","history":[{"at":"2026-10-03T00:00:00Z","by":"you","what":"created from an email"}]},"exact_effect":"Saved $142.30 Bill to Money","display_summary":"Con Edison · $142.30 · Due Oct 15","module_version":"money-ledger-2026-10-02","evidence_excerpt":"Amount due $142.30 by Oct 15"}'
TASK_PREP='{"destination_kind":"task","data":{"text":"Review transcript","category":"","done":false,"due":"2026-10-09"},"exact_effect":"Added to Tasks · Review transcript","display_summary":"Review transcript · Due Oct 9","module_version":"tasks-2026-10-02"}'
items_before=$(q -c "select count(*) from item")

echo "-- the provisional feed rule, before anything is saved (S16)"
as_user $A $SVC "select jarvis_record('$A','propose','agent','$CONN','Suggested an email item','email','confirmed','h-prop','proposal:test','Con Edison \$142.30','verified_jarvis')" >/dev/null
FEED=$(as_user $A $AUTH "select activity_feed(50, null, 'global')")
check "global feed omits the email suggestion row" 0 "$(echo "$FEED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for r in d['rows'] if r['kind']=='propose'))")"
check "global feed text never carries the candidate's vendor" "" "$(echo "$FEED" | grep -o 'Con Edison' | head -1)"
check "global feed carries the generic review count only" 2 "$(echo "$FEED" | jget email_review_count)"
check "the Email scope shows the suggestion" 1 "$(as_user $A $AUTH "select activity_feed(50, null, 'email')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for r in d['rows'] if r['kind']=='propose'))")"
check "B's feed holds none of A's rows" 0 "$(as_user $B $AUTH "select activity_feed(50, null, 'email')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for r in d['rows'] if r['actor_display']=='Claude'))")"

echo "-- access"
check "anon cannot approve" 42501 "$(as_user_state $A anon "select capture_approve('$C_BILL',1,'ph-a1','k','{}')")"
check "B cannot approve A's candidate" NOT_FOUND "$(as_user $B $AUTH "select capture_approve('$C_BILL',1,'ph-a1','k-b','$BILL_PREP')" | jget error)"
check "no session, no approval" AUTH_REQUIRED "$(q -c "set role authenticated; select capture_approve('$C_BILL',1,'ph-a1','k','$BILL_PREP')" | jget error)"

echo "-- refusals that write nothing"
check "a stale revision is SOURCE_CHANGED" SOURCE_CHANGED "$(as_user $A $AUTH "select capture_approve('$C_BILL',7,'ph-a1','k1','$BILL_PREP')" | jget error)"
check "...and names the current revision" 1 "$(as_user $A $AUTH "select capture_approve('$C_BILL',7,'ph-a1','k1','$BILL_PREP')" | jget revision)"
check "a hash that is not the card's is SOURCE_CHANGED" SOURCE_CHANGED "$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-other','k1','$BILL_PREP')" | jget error)"
check "...carrying the owned payload for a fresh diff" "Con Edison" "$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-other','k1','$BILL_PREP')" | jget payload.issuer)"
check "a bill cannot be sent to Tasks" INVALID_PAYLOAD "$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-a1','k1','{\"destination_kind\":\"task\",\"data\":{\"text\":\"Pay Con Edison\"},\"exact_effect\":\"x\"}')" | jget error)"
check "a task carrying an amount is refused: a bill is never a task" bill_is_not_a_task "$(as_user $A $AUTH "select capture_approve('$C_TASK',1,'ph-a2','k1','{\"destination_kind\":\"task\",\"data\":{\"text\":\"Pay\",\"amountCents\":100,\"category\":\"\",\"done\":false},\"exact_effect\":\"x\"}')" | jget missing.0)"
check "an unregistered destination is MODULE_UNAVAILABLE" MODULE_UNAVAILABLE "$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-a1','k1','{\"destination_kind\":\"money_bill_v9\",\"data\":{},\"exact_effect\":\"x\"}')" | jget error)"
check "a bill without its ledger fields is MISSING_DETAILS" ledger "$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-a1','k1','{\"destination_kind\":\"money_bill\",\"data\":{\"vendor\":\"Con Edison\",\"amountCents\":14230,\"currency\":\"USD\"},\"exact_effect\":\"x\"}')" | jget missing.0)"
check "an authority key in an edit is refused whole" INVALID_PAYLOAD "$(as_user $A $AUTH "select candidate_edit('$C_BILL',1,'{\"issuer\":\"X\",\"approved\":true}','{issuer}')" | jget error)"
check "nothing was written by any refusal" "$items_before" "$(q -c "select count(*) from item")"
check "...no action either" 0 "$(q -c "select count(*) from action where kind like 'capture_%' and idempotency_key like 'capture:%'")"
check "the candidate is still proposed" proposed "$(q -c "select status from email_candidate where id='$C_BILL'")"

echo "-- S14: a failure after the item write leaves nothing behind"
q -c "create or replace function chaos_receipt() returns trigger language plpgsql as \$\$ begin if new.exact_verb like 'CHAOS%' then raise exception 'chaos'; end if; return new; end; \$\$; create trigger chaos before insert on receipt_event for each row execute function chaos_receipt();" >/dev/null
CHAOS=$(echo "$BILL_PREP" | python3 -c "import json,sys; d=json.load(sys.stdin); d['exact_effect']='CHAOS '+d['exact_effect']; print(json.dumps(d, ensure_ascii=False))")
ev_before=$(q -c "select count(*) from source_evidence")
check "the call fails" fail "$(as_user_state $A $AUTH "select capture_approve('$C_BILL',1,'ph-a1','k-chaos','$CHAOS')" | sed 's/^P0001$/fail/')"
check "no item" "$items_before" "$(q -c "select count(*) from item")"
check "no action" 0 "$(q -c "select count(*) from action where idempotency_key like 'capture:%'")"
check "no approval" 0 "$(q -c "select count(*) from approval ap join action a on a.id=ap.action_id where a.idempotency_key like 'capture:%'")"
check "no evidence" "$ev_before" "$(q -c "select count(*) from source_evidence")"
check "the candidate is still proposed" proposed "$(q -c "select status from email_candidate where id='$C_BILL'")"
q -c "drop trigger chaos on receipt_event; drop function chaos_receipt();" >/dev/null

echo "-- the atomic local save (07.2)"
R1=$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-a1','k-dev1','$BILL_PREP')")
ACT=$(echo "$R1" | jget action_id); DEST=$(echo "$R1" | jget destination_id); IUA=$(echo "$R1" | jget item_updated_at)
check "confirmed" confirmed "$(echo "$R1" | jget state)"
check "the exact verb" "Saved \$142.30 Bill to Money" "$(echo "$R1" | jget safe_message)"
check "the item is a Money bill owned by A" "money_bill|$A" "$(q -c "select entity_type || '|' || owner_id from item where id='$DEST'")"
check "the item carries the adapter's data untouched" "Con Edison|14230|fp-bill-con-edison-14230-2026-10-15" "$(q -c "select (data->>'vendor') || '|' || (data->>'amountCents') || '|' || (data->>'fingerprint') from item where id='$DEST'")"
check "the candidate is saved and points at it" "saved|$DEST|$ACT" "$(q -c "select status || '|' || destination_id || '|' || action_id from email_candidate where id='$C_BILL'")"
check "the action's key is the server's" "capture:$C_BILL:1" "$(q -c "select idempotency_key from action where id='$ACT'")"
check "the rule is the actor, the person the initiator" "rule||$A" "$(q -c "select actor_kind || '|' || coalesce(actor_id::text,'') || '|' || initiated_by_user_id from action where id='$ACT'")"
check "the approval was created and consumed by this tap, bound to the hash and the account" "ph-a1|1|$ACCT|true" "$(q -c "select payload_hash || '|' || source_revision || '|' || account_id || '|' || (consumed_at is not null) from approval where action_id='$ACT'")"
check "one receipt, confirmed, verified by JARVIS, with the evidence" "1|confirmed|verified_jarvis|1" "$(q -c "select count(*) || '|' || min(state) || '|' || min(assurance) || '|' || min(cardinality(evidence_refs)) from receipt_event where action_id='$ACT'")"
check "the evidence is an excerpt from the message, not the message" "email|$MSG_BILL|Amount due \$142.30 by Oct 15" "$(q -c "select type || '|' || message_id || '|' || excerpt from source_evidence where id = (select evidence_refs[1] from receipt_event where action_id='$ACT')")"
check "the receipt's diff is the card's fields" "issuer" "$(q -c "select diff->0->>'field' from receipt_event where action_id='$ACT' order by sequence limit 1" | sed 's/^\(amount\|due_date\|no_due_date_confirmed\|issuer\)$/issuer/')"

echo "-- S15: parallel taps, two devices, a retry after a timeout"
R2=$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-a1','k-dev1','$BILL_PREP')")
check "the same key again replays" "True|$ACT|$DEST" "$(echo "$R2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d['replay'])+'|'+d['action_id']+'|'+d['destination_id'])")"
R3=$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-a1','k-dev2','$BILL_PREP')")
check "another device, another key, the same card: the same action" "True|$ACT" "$(echo "$R3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d['replay'])+'|'+d['action_id'])")"
check "an older card on another device is IDEMPOTENCY_CONFLICT, with the saved action" "IDEMPOTENCY_CONFLICT|$ACT" "$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-old','k-dev3','$BILL_PREP')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['error']+'|'+d['action_id'])")"
check "still one item" $((items_before + 1)) "$(q -c "select count(*) from item")"
# Two sessions race for the task card at the same instant.
tmp=$(mktemp -d)
( as_user $A $AUTH "select capture_approve('$C_TASK',1,'ph-a2','k-race-1','$TASK_PREP')" > "$tmp/1" ) &
( as_user $A $AUTH "select capture_approve('$C_TASK',1,'ph-a2','k-race-2','$TASK_PREP')" > "$tmp/2" ) &
wait
check "the race has one winner: both answers name one action" "$(jget action_id < "$tmp/1")" "$(jget action_id < "$tmp/2")"
check "...and one task" 1 "$(q -c "select count(*) from item where entity_type='task' and data->>'text'='Review transcript' and data->>'due'='2026-10-09'")"
check "...exactly one of them was the write" 1 "$(cat "$tmp/1" "$tmp/2" | python3 -c "import json,sys; print(sum(1 for l in sys.stdin if l.strip() and not json.loads(l).get('replay')))")"
TASK_ACT=$(jget action_id < "$tmp/1"); TASK_ITEM=$(jget destination_id < "$tmp/1")
rm -rf "$tmp"

echo "-- the feed after a save"
FEED=$(as_user $A $AUTH "select activity_feed(50, null, 'global')")
check "the saved bill is in the global feed with its exact verb" "Saved \$142.30 Bill to Money" "$(echo "$FEED" | python3 -c "import json,sys; d=json.load(sys.stdin); print([r['exact_verb'] for r in d['rows'] if r['action_id']=='$ACT'][0])")"
check "...marked undoable" True "$(echo "$FEED" | python3 -c "import json,sys; d=json.load(sys.stdin); print([r['undoable'] for r in d['rows'] if r['action_id']=='$ACT'][0])")"
check "the review count fell to zero" 0 "$(echo "$FEED" | jget email_review_count)"
DET=$(as_user $A $AUTH "select receipt_detail('$ACT')")
check "detail: the chain, the evidence, the actor, approved by the person" "1|1|Rule|True|False" "$(echo "$DET" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(len(d['receipts']))+'|'+str(len(d['evidence']))+'|'+d['actor_display']+'|'+str(d['approved_by_user'])+'|'+str(d['inside_email']))")"
check "B cannot read A's receipt" NOT_FOUND "$(as_user $B $AUTH "select receipt_detail('$ACT')" | jget error)"

echo "-- undo (07.4): a compensating action under the destination's revision"
check "a wrong expected revision is DESTINATION_CHANGED" DESTINATION_CHANGED "$(as_user $A $AUTH "select action_undo('$ACT','2020-01-01T00:00:00Z','u1')" | jget error)"
check "B cannot undo A's action" NOT_FOUND "$(as_user $B $AUTH "select action_undo('$ACT','$IUA','u1')" | jget error)"
U1=$(as_user $A $AUTH "select action_undo('$ACT','$IUA','u1')")
UNDO=$(echo "$U1" | jget action_id)
check "undo confirmed with its own verb" "confirmed|Removed From Money · Con Edison" "$(echo "$U1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['state']+'|'+d['safe_message'])")"
check "the item is gone" 0 "$(q -c "select count(*) from item where id='$DEST'")"
check "the card is back, at a new revision, with no destination" "proposed||" "$(q -c "select status || '|' || coalesce(destination_id::text,'') || '|' || coalesce(action_id::text,'') from email_candidate where id='$C_BILL'")"
check "the original's chain records the reversal" "$UNDO" "$(q -c "select reversal_action_id from receipt_event where action_id='$ACT' and sequence=2")"
check "the undo action points back" "$ACT" "$(q -c "select authorization_snapshot->>'undoes' from action where id='$UNDO'")"
check "undo again replays" "True|$UNDO" "$(as_user $A $AUTH "select action_undo('$ACT','$IUA','u2')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d['replay'])+'|'+d['action_id'])")"
check "the feed no longer offers undo on the original" False "$(as_user $A $AUTH "select activity_feed(50, null, 'global')" | python3 -c "import json,sys; d=json.load(sys.stdin); print([r['undoable'] for r in d['rows'] if r['action_id']=='$ACT'][0])")"
REV=$(q -c "select revision from email_candidate where id='$C_BILL'")
check "the old card's revision cannot be approved again" SOURCE_CHANGED "$(as_user $A $AUTH "select capture_approve('$C_BILL',1,'ph-a1','k-again','$BILL_PREP')" | jget error)"
R4=$(as_user $A $AUTH "select capture_approve('$C_BILL',$REV,'ph-a1','k-again','$BILL_PREP')")
ACT2=$(echo "$R4" | jget action_id); DEST2=$(echo "$R4" | jget destination_id); IUA2=$(echo "$R4" | jget item_updated_at)
check "the current card saves again, as a new action" "confirmed|False" "$(echo "$R4" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['state']+'|'+str(d.get('replay',False)))")"
check "...under a new logical key" "capture:$C_BILL:$REV" "$(q -c "select idempotency_key from action where id='$ACT2'")"
q -c "update item set data = data || '{\"paidAt\":\"2026-10-04\"}' where id='$DEST2'" >/dev/null
check "a stale destination (edited since) is DESTINATION_CHANGED" DESTINATION_CHANGED "$(as_user $A $AUTH "select action_undo('$ACT2','$IUA2','u3')" | jget error)"
IUA2b=$(q -c "select updated_at from item where id='$DEST2'")
check "...and a referenced one (paid) stays: REFERENCED" "DESTINATION_CHANGED|REFERENCED" "$(as_user $A $AUTH "select action_undo('$ACT2','$IUA2b','u3')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['error']+'|'+d['detail'])")"
check "the item was not touched" 1 "$(q -c "select count(*) from item where id='$DEST2'")"
q -c "insert into item (owner_id, entity_type, data) values ('$A','event','{\"title\":\"Call\",\"date\":\"2026-10-09\",\"start\":\"09:00\",\"sourceTaskId\":\"$TASK_ITEM\"}')" >/dev/null
TIUA=$(q -c "select updated_at from item where id='$TASK_ITEM'")
check "a task an event points at is REFERENCED" REFERENCED "$(as_user $A $AUTH "select action_undo('$TASK_ACT','$TIUA','u4')" | jget detail)"
q -c "delete from item where entity_type='event' and data->>'sourceTaskId'='$TASK_ITEM'" >/dev/null
q -c "delete from item where id='$TASK_ITEM'" >/dev/null   # the person deleted it in Tasks; counted below
removed_elsewhere=1
check "an item removed elsewhere: Item removed" "NOT_FOUND|Item removed" "$(as_user $A $AUTH "select action_undo('$TASK_ACT','$TIUA','u4')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['error']+'|'+d['detail'])")"

echo "-- edit, needs details, dismiss, restore"
q -c "update email_candidate set status='proposed', destination_id=null, action_id=null where id='$C_TASK'" >/dev/null
REVT=$(q -c "select revision from email_candidate where id='$C_TASK'")
E1=$(as_user $A $AUTH "select candidate_edit('$C_TASK',$REVT,'{\"title\":\"Review transcript\",\"due_date\":null,\"notes\":\"\"}','{due_date}','{due_date}')")
check "an edit with a missing field is needs_details at a new revision" "needs_details|$((REVT + 1))" "$(echo "$E1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status']+'|'+str(d['revision']))")"
check "...tagged entered_by_user" true "$(q -c "select provenance_by_field->'due_date'->>'entered_by_user' from email_candidate where id='$C_TASK'")"
check "approving it is MISSING_DETAILS naming the field" '["due_date"]' "$(as_user $A $AUTH "select capture_approve('$C_TASK',$((REVT + 1)),'$(echo "$E1" | jget payload_hash)','k5','$TASK_PREP')" | jget missing)"
check "an edit at a stale revision is SOURCE_CHANGED" SOURCE_CHANGED "$(as_user $A $AUTH "select candidate_edit('$C_TASK',$REVT,'{\"title\":\"x\"}','{title}')" | jget error)"
E2=$(as_user $A $AUTH "select candidate_edit('$C_TASK',$((REVT + 1)),'{\"title\":\"Review transcript\",\"due_date\":\"2026-10-10\",\"notes\":\"\"}','{due_date}','{}')")
H2=$(echo "$E2" | jget payload_hash)
check "the hash moved with the edit" "proposed|moved" "$(echo "$E2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status']+'|'+('moved' if d['payload_hash']!='$(echo "$E1" | jget payload_hash)' else 'same'))")"
check "the old card's hash cannot approve the new card" SOURCE_CHANGED "$(as_user $A $AUTH "select capture_approve('$C_TASK',$((REVT + 2)),'$(echo "$E1" | jget payload_hash)','k6','$TASK_PREP')" | jget error)"
check "dismiss at a stale revision is SOURCE_CHANGED" SOURCE_CHANGED "$(as_user $A $AUTH "select candidate_dismiss('$C_TASK',1)" | jget error)"
check "dismiss" dismissed "$(as_user $A $AUTH "select candidate_dismiss('$C_TASK',$((REVT + 2)))" | jget status)"
check "a dismissed card cannot be approved" INVALID_PAYLOAD "$(as_user $A $AUTH "select capture_approve('$C_TASK',$((REVT + 3)),'$H2','k7','$TASK_PREP')" | jget error)"
check "the source row is unchanged by a dismissal" sh-a2 "$(q -c "select source_hash from email_message where id='$MSG_TASK'")"
check "restore" proposed "$(as_user $A $AUTH "select candidate_restore('$C_TASK',$((REVT + 3)))" | jget status)"
q -c "update email_message set source_hash='sh-a2-changed' where id='$MSG_TASK'" >/dev/null
check "a source that changed underneath is SOURCE_CHANGED" "SOURCE_CHANGED|email changed" "$(as_user $A $AUTH "select capture_approve('$C_TASK',$((REVT + 4)),'$H2','k8','$TASK_PREP')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['error']+'|'+d['detail'])")"
check "...and the card is marked stale" stale "$(q -c "select status from email_candidate where id='$C_TASK'")"
q -c "update email_message set source_hash='sh-a2' where id='$MSG_TASK'; update email_candidate set status='proposed' where id='$C_TASK'" >/dev/null

echo "-- an agent-origin capture credits the agent and names the person"
q -c "update email_candidate set origin='agent', agent_id='$CONN' where id='$C_TASK'" >/dev/null
REVT=$(q -c "select revision from email_candidate where id='$C_TASK'")
R5=$(as_user $A $AUTH "select capture_approve('$C_TASK',$REVT,'$H2','k9','$TASK_PREP')")
ACT3=$(echo "$R5" | jget action_id)
check "saved" confirmed "$(echo "$R5" | jget state)"
check "actor agent, initiated by the person, approved by the person" "agent|$CONN|$A|$A" "$(q -c "select actor_kind || '|' || actor_id || '|' || initiated_by_user_id || '|' || (authorization_snapshot->>'approved_by') from action where id='$ACT3'")"
check "the receipt names the assistant" Claude "$(q -c "select actor_display from receipt_event where action_id='$ACT3'")"

echo "-- S19: erasure is a tombstone, not an undo"
check "erase" 1 "$(as_user $A $AUTH "select receipt_erase('$ACT3')" | jget erased_receipts)"
check "the receipt carries no words" "Erased||[]|0|true" "$(q -c "select exact_verb || '|' || scope_summary || '|' || diff::text || '|' || cardinality(evidence_refs) || '|' || (erased_at is not null) from receipt_event where action_id='$ACT3'")"
check "the action is a tombstone" "Erased|erased:" "$(q -c "select verb || '|' || left(idempotency_key, 7) from action where id='$ACT3'")"
check "the item is still there: erasing a receipt undoes nothing" 1 "$(q -c "select count(*) from item where id='$(echo "$R5" | jget destination_id)'")"
check "the browser cannot update a receipt" 42501 "$(as_user_state $A $AUTH "update receipt_event set exact_verb='x' where action_id='$ACT2'")"
check "the browser cannot delete a receipt" 42501 "$(as_user_state $A $AUTH "delete from receipt_event where action_id='$ACT2'")"
check "a server cannot rewrite a receipt's verb outside an erasure" 42501 "$(as_user_state $A $SVC "update receipt_event set exact_verb='x' where action_id='$ACT2'")"
check "erase of another user's action: NOT_FOUND" NOT_FOUND "$(as_user $B $AUTH "select receipt_erase('$ACT2')" | jget error)"

echo "-- sends (07.3): review, exact approval, outbox, fenced claim, settle"
SEND='{"account_id":"'$ACCT'","from":"a@example.test","to":["coach@example.test"],"cc":[],"bcc":[],"subject":"Re: Transcript","body_text":"On it.","attachments":[],"in_reply_to":"<m-a2@example.test>","draft_revision":3}'
check "an authority key in a send review is refused" INVALID_PAYLOAD "$(as_user $A $AUTH "select command_review('send_email','{\"to\":[\"x\"],\"execute\":true}','$ACCT','Sent reply to coach@example.test',3)" | jget error)"
check "a review needs a connected account of the person's" PROVIDER_AUTH "$(as_user $A $AUTH "select command_review('send_email','$SEND','60000000-0000-0000-0000-00000000000b','Sent reply to coach@example.test',3)" | jget error)"
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',3)")
NONCE=$(echo "$RV" | jget review_nonce); HASH=$(echo "$RV" | jget payload_hash); SACT=$(echo "$RV" | jget action_id); OB=$(echo "$RV" | jget outbox_id)
check "the review holds the snapshot in the outbox, not yet queued" "reviewed|proposed" "$(q -c "select o.state || '|' || a.state from outbox_command o join action a on a.id=o.action_id where o.id='$OB'")"
check "nothing can claim a reviewed command" "" "$(as_user $A $SVC "select outbox_claim('w1')")"
check "S17: a different hash is REVIEW_CHANGED" REVIEW_CHANGED "$(as_user $A $AUTH "select command_approve('$NONCE','0000','s1')" | jget error)"
check "...and the approval is still unconsumed" f "$(q -c "select consumed_at is not null from approval where nonce='$NONCE'")"
check "B cannot approve A's review" NOT_FOUND "$(as_user $B $AUTH "select command_approve('$NONCE','$HASH','s1')" | jget error)"
AP=$(as_user $A $AUTH "select command_approve('$NONCE','$HASH','s1')")
check "the tap approves and queues" "approved|queued" "$(echo "$AP" | jget state)|$(q -c "select state from outbox_command where id='$OB'")"
check "the approval is consumed once" t "$(q -c "select consumed_at is not null from approval where nonce='$NONCE'")"
check "a second tap replays" "True|$SACT" "$(as_user $A $AUTH "select command_approve('$NONCE','$HASH','s2')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d['replay'])+'|'+d['action_id'])")"
check "the nonce cannot bind another payload" IDEMPOTENCY_CONFLICT "$(as_user $A $AUTH "select command_approve('$NONCE','ffff','s3')" | jget error)"
check "the browser cannot claim" 42501 "$(as_user_state $A $AUTH "select outbox_claim('w1')")"
check "the browser cannot settle" 42501 "$(as_user_state $A $AUTH "select outbox_settle('$OB','00000000-0000-0000-0000-000000000000','confirmed','x')")"
CL=$(as_user $A $SVC "select outbox_claim('w1')")
TOK=$(echo "$CL" | jget claim_token)
check "the worker claims it under a token, with the exact payload" "$OB|1|coach@example.test" "$(echo "$CL" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['outbox_id']+'|'+str(d['attempt'])+'|'+d['payload']['to'][0])")"
check "the action is running" running "$(q -c "select state from action where id='$SACT'")"
check "a second worker finds nothing" "" "$(as_user $A $SVC "select outbox_claim('w2')")"
check "a settle under the wrong token is NOT_FOUND" NOT_FOUND "$(as_user $A $SVC "select outbox_settle('$OB','00000000-0000-0000-0000-000000000000','confirmed','Sent reply to coach@example.test','{\"id\":\"x\"}')" | jget error)"
check "a claim that was never dispatched cannot be confirmed" INVALID_PAYLOAD "$(as_user $A $SVC "select outbox_settle('$OB','$TOK','confirmed','Sent reply','{\"id\":\"x\"}')" | jget error)"
check "cancel while claimed is a request, not a cancellation" cancellation_requested "$(as_user $A $AUTH "select command_cancel('$SACT')" | jget state)"
check "...unknown before dispatch settles as failed: it never left" failed "$(as_user $A $SVC "select outbox_settle('$OB','$TOK','outcome_unknown','Not Sent · Gmail Did Not Answer')" | jget state)"
check "the action is failed with no provider ack" "failed|false" "$(q -c "select state || '|' || (select bool_or(provider_ack is not null) from receipt_event where action_id='$SACT') from action where id='$SACT'")"

echo "-- S18: a timeout after dispatch is unknown, never failed, never resent"
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',4)")
NONCE=$(echo "$RV" | jget review_nonce); HASH=$(echo "$RV" | jget payload_hash); SACT=$(echo "$RV" | jget action_id); OB=$(echo "$RV" | jget outbox_id)
as_user $A $AUTH "select command_approve('$NONCE','$HASH','s4')" >/dev/null
CL=$(as_user $A $SVC "select outbox_claim('w1')"); TOK=$(echo "$CL" | jget claim_token)
check "dispatched under the token" t "$(as_user $A $SVC "select outbox_dispatched('$OB','$TOK')")"
check "dispatched twice is false" f "$(as_user $A $SVC "select outbox_dispatched('$OB','$TOK')")"
check "cancel after dispatch cannot recall it" cancellation_requested "$(as_user $A $AUTH "select command_cancel('$SACT')" | jget state)"
check "a failure without a definitive refusal is outcome_unknown" outcome_unknown "$(as_user $A $SVC "select outbox_settle('$OB','$TOK','failed','Send Status Unknown · Check Gmail Before Trying Again')" | jget state)"
check "the receipt says unknown" "outcome_unknown|OUTCOME_UNKNOWN" "$(q -c "select state || '|' || error_code from receipt_event where action_id='$SACT' order by sequence desc limit 1")"
check "an unknown command is never claimed again" "" "$(as_user $A $SVC "select outbox_claim('w1')")"
check "reconciliation without evidence is refused" INVALID_PAYLOAD "$(as_user $A $SVC "select outbox_reconcile('$OB','confirmed','Sent reply to coach@example.test','{}')" | jget error)"
check "...and absence of a search hit is not evidence of failure" INVALID_PAYLOAD "$(as_user $A $SVC "select outbox_reconcile('$OB','failed','Not Sent','{\"searched\":true}')" | jget error)"
check "reconciliation with a provider message id confirms" confirmed "$(as_user $A $SVC "select outbox_reconcile('$OB','confirmed','Sent reply to coach@example.test','{\"provider_message_id\":\"18f2\",\"thread_id\":\"t-a2\"}')" | jget state)"
check "...with provider_ack assurance" provider_ack "$(q -c "select assurance from receipt_event where action_id='$SACT' order by sequence desc limit 1")"

echo "-- a worker that vanished after dispatch: unknown by the sweep; one that vanished before: claimed again"
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',5)")
NONCE=$(echo "$RV" | jget review_nonce); HASH=$(echo "$RV" | jget payload_hash); SACT=$(echo "$RV" | jget action_id); OB=$(echo "$RV" | jget outbox_id)
as_user $A $AUTH "select command_approve('$NONCE','$HASH','s5')" >/dev/null
CL=$(as_user $A $SVC "select outbox_claim('w1', interval '1 second')"); TOK=$(echo "$CL" | jget claim_token)
q -c "update outbox_command set claim_expires_at = now() - interval '1 second' where id='$OB'" >/dev/null
CL2=$(as_user $A $SVC "select outbox_claim('w2')")
check "a lapsed claim that never dispatched is claimed again, attempt 2" "$OB|2" "$(echo "$CL2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['outbox_id']+'|'+str(d['attempt']))")"
check "the old token is dead" NOT_FOUND "$(as_user $A $SVC "select outbox_settle('$OB','$TOK','failed','x',null,'REFUSED')" | jget error)"
TOK=$(echo "$CL2" | jget claim_token)
as_user $A $SVC "select outbox_dispatched('$OB','$TOK')" >/dev/null
q -c "update outbox_command set claim_expires_at = now() - interval '1 second' where id='$OB'" >/dev/null
check "a third worker cannot claim a dispatched command" "" "$(as_user $A $SVC "select outbox_claim('w3')")"
check "the sweep marks it unknown" 1 "$(as_user $A $SVC "select outbox_sweep()" | jget unknown)"
check "with the honest line" "Send Status Unknown · Check Gmail Before Trying Again" "$(q -c "select exact_verb from receipt_event where action_id='$SACT' order by sequence desc limit 1")"

echo "-- approval expiry (07.1): five minutes, undispatched"
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',6)")
NONCE=$(echo "$RV" | jget review_nonce); HASH=$(echo "$RV" | jget payload_hash); SACT=$(echo "$RV" | jget action_id); OB=$(echo "$RV" | jget outbox_id)
q -c "update approval set granted_at = now() - interval '6 minutes', expires_at = now() - interval '1 minute' where nonce='$NONCE'" >/dev/null
check "a tap after the nonce lapsed is APPROVAL_EXPIRED" APPROVAL_EXPIRED "$(as_user $A $AUTH "select command_approve('$NONCE','$HASH','s6')" | jget error)"
check "...the action closed and the snapshot cancelled" "cancelled|cancelled" "$(q -c "select a.state || '|' || o.state from action a join outbox_command o on o.action_id=a.id where a.id='$SACT'")"
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',7)")
NONCE=$(echo "$RV" | jget review_nonce); HASH=$(echo "$RV" | jget payload_hash); SACT=$(echo "$RV" | jget action_id); OB=$(echo "$RV" | jget outbox_id)
as_user $A $AUTH "select command_approve('$NONCE','$HASH','s7')" >/dev/null
q -c "update approval set consumed_at = now() - interval '6 minutes' where nonce='$NONCE'" >/dev/null
check "a queued command approved more than five minutes ago lapses at the claim" APPROVAL_EXPIRED "$(as_user $A $SVC "select outbox_claim('w1')" | jget reason)"
check "...with a receipt the person can read" "Not Sent · Approval Expired · Review It Again" "$(q -c "select exact_verb from receipt_event where action_id='$SACT' order by sequence desc limit 1")"
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',8)")
NONCE=$(echo "$RV" | jget review_nonce); SACT=$(echo "$RV" | jget action_id)
q -c "update approval set granted_at = now() - interval '6 minutes', expires_at = now() - interval '1 minute' where nonce='$NONCE'" >/dev/null
check "the sweep closes reviews nobody tapped" 1 "$(as_user $A $SVC "select approvals_sweep()" | jget expired)"
check "...cancelled" cancelled "$(q -c "select state from action where id='$SACT'")"

echo "-- cancel before it leaves"
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',9)")
NONCE=$(echo "$RV" | jget review_nonce); HASH=$(echo "$RV" | jget payload_hash); SACT=$(echo "$RV" | jget action_id)
check "cancel a review" cancelled "$(as_user $A $AUTH "select command_cancel('$SACT')" | jget state)"
check "the tap after a cancel does nothing" INVALID_PAYLOAD "$(as_user $A $AUTH "select command_approve('$NONCE','$HASH','s9')" | jget error)"
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',10)")
NONCE=$(echo "$RV" | jget review_nonce); HASH=$(echo "$RV" | jget payload_hash); SACT=$(echo "$RV" | jget action_id); OB=$(echo "$RV" | jget outbox_id)
as_user $A $AUTH "select command_approve('$NONCE','$HASH','s10')" >/dev/null
check "cancel a queued command" "cancelled|cancelled" "$(as_user $A $AUTH "select command_cancel('$SACT')" | jget state)|$(q -c "select state from outbox_command where id='$OB'")"
check "nothing to claim" "" "$(as_user $A $SVC "select outbox_claim('w1')")"

echo "-- revocation and disconnection around dispatch (S07, S24)"
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',11)")
NONCE=$(echo "$RV" | jget review_nonce); HASH=$(echo "$RV" | jget payload_hash); SACT=$(echo "$RV" | jget action_id); OB=$(echo "$RV" | jget outbox_id)
as_user $A $AUTH "select command_approve('$NONCE','$HASH','s11')" >/dev/null
q -c "update email_account set state='reauth' where id='$ACCT'" >/dev/null
check "a queued command whose account needs reauth fails at the claim, not silently" PROVIDER_AUTH "$(as_user $A $SVC "select outbox_claim('w1')" | jget reason)"
check "...with the line" "Not Sent · Reconnect Gmail" "$(q -c "select exact_verb from receipt_event where action_id='$SACT' order by sequence desc limit 1")"
check "a tap with the account disconnected is PROVIDER_AUTH" PROVIDER_AUTH "$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','x',12)" | jget error)"
q -c "update email_account set state='connected' where id='$ACCT'" >/dev/null
RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',13)")
NONCE=$(echo "$RV" | jget review_nonce); HASH=$(echo "$RV" | jget payload_hash); SACT=$(echo "$RV" | jget action_id); OB=$(echo "$RV" | jget outbox_id)
as_user $A $AUTH "select command_approve('$NONCE','$HASH','s13')" >/dev/null
CL=$(as_user $A $SVC "select outbox_claim('w1')"); TOK=$(echo "$CL" | jget claim_token)
as_user $A $SVC "select outbox_dispatched('$OB','$TOK')" >/dev/null
q -c "update email_account set state='disconnected' where id='$ACCT'" >/dev/null
check "a send cannot be called confirmed without the provider's ack" INVALID_PAYLOAD "$(as_user $A $SVC "select outbox_settle('$OB','$TOK','confirmed','x')" | jget error)"
check "disconnected after dispatch: the ack still settles it as confirmed, honestly" confirmed "$(as_user $A $SVC "select outbox_settle('$OB','$TOK','confirmed','Sent reply to coach@example.test','{\"id\":\"18f3\",\"threadId\":\"t-a2\"}')" | jget state)"
check "...a confirmed send carries the provider's ack" "provider_ack|18f3" "$(q -c "select assurance || '|' || (provider_ack->>'id') from receipt_event where action_id='$SACT' order by sequence desc limit 1")"
check "...and its token is spent" NOT_FOUND "$(as_user $A $SVC "select outbox_settle('$OB','$TOK','failed','x',null,'X')" | jget error)"
q -c "update email_account set state='connected' where id='$ACCT'" >/dev/null
check "erasing a settled send blanks the snapshot too" "{}" "$(as_user $A $AUTH "select receipt_erase('$SACT')" >/dev/null; q -c "select payload::text from outbox_command where id='$OB'")"
check "erasing an in-flight command is refused" INVALID_PAYLOAD "$(RV=$(as_user $A $AUTH "select command_review('send_email','$SEND','$ACCT','Sent reply to coach@example.test',14)"); as_user $A $AUTH "select command_approve('$(echo "$RV" | jget review_nonce)','$(echo "$RV" | jget payload_hash)','s14')" >/dev/null; as_user $A $AUTH "select receipt_erase('$(echo "$RV" | jget action_id)')" | jget error)"

echo "-- S13: an outside-reported action is reported, never verified, and confirms nothing"
PENDING=$(q -c "select count(*) from action where state in ('approved','running')")
RE=$(as_user $A $SVC "select reported_external_record('$A','$CONN','Emailed the coach from Claude','rep-1')")
check "recorded with reported_external assurance" reported_external "$(echo "$RE" | jget assurance)"
check "the receipt says so in words" "Reported by assistant · Not verified by JARVIS" "$(q -c "select scope_summary from receipt_event where action_id='$(echo "$RE" | jget action_id)'")"
check "replay by key" True "$(as_user $A $SVC "select reported_external_record('$A','$CONN','Emailed the coach from Claude','rep-1')" | jget replay)"
check "no JARVIS command moved" "$PENDING" "$(q -c "select count(*) from action where state in ('approved','running')")"
check "the browser cannot record one" 42501 "$(as_user_state $A $AUTH "select reported_external_record('$A','$CONN','x','rep-2')")"
q -c "update agent_connection set status='revoked' where id='$CONN'" >/dev/null
check "a revoked connection cannot report" CONNECTION_REVOKED "$(as_user $A $SVC "select reported_external_record('$A','$CONN','x','rep-3')" | jget error)"
q -c "update agent_connection set status='connected' where id='$CONN'" >/dev/null

echo "-- S02: a denied agent call leaves a safe receipt, metadata only"
DN=$(as_user $A $SVC "select access_denied_record('$A','$CONN','proposal.submit','MODE_CEILING')")
DACT=$(echo "$DN" | jget action_id)
check "recorded: who, which method, which code" "Denied · Suggest|MODE_CEILING|system|agent|$CONN" "$(q -c "select verb || '|' || error_code || '|' || surface || '|' || actor_kind || '|' || actor_id from action where id='$DACT'")"
check "the record holds no params" '["code", "method"]' "$(q -c "select jsonb_agg(k order by k) from jsonb_object_keys((select authorization_snapshot from action where id='$DACT')) k")"
check "a repeat in the same hour bumps the count, adds no receipt" "2|1" "$(as_user $A $SVC "select access_denied_record('$A','$CONN','proposal.submit','MODE_CEILING')" | jget repeated)|$(q -c "select count(*) from receipt_event where action_id='$DACT'")"
check "a different code is its own row" "1" "$(as_user $A $SVC "select access_denied_record('$A','$CONN','context.issue','SCOPE_DENIED')" | jget repeated)"
check "the browser cannot record a denial" 42501 "$(as_user_state $A $AUTH "select access_denied_record('$A','$CONN','proposal.submit','MODE_CEILING')")"
check "a code that is not a code is refused" INVALID_PAYLOAD "$(as_user $A $SVC "select access_denied_record('$A','$CONN','proposal.submit','drop table')" | jget error)"
check "another owner's connection is NOT_FOUND" NOT_FOUND "$(as_user $A $SVC "select access_denied_record('$B','$CONN','proposal.submit','MODE_CEILING')" | jget error)"
check "the person sees it in Activity" "Denied · Suggest" "$(as_user $A $AUTH "select activity_feed(50, null, 'global')" | python3 -c "import json,sys; d=json.load(sys.stdin); print([r['exact_verb'] for r in d['rows'] if r['action_id']=='$DACT'][0])")"

echo "-- invariants over everything written above"
check "no confirmed capture receipt without its committed item, except the one the person removed in Tasks (undone ones carry their reversal)" "$removed_elsewhere" "$(q -c "select count(*) from receipt_event r join action a on a.id=r.action_id where r.state='confirmed' and a.kind like 'capture_%' and a.idempotency_key like 'capture:%' and a.destination_id is null and not exists (select 1 from receipt_event z where z.action_id=a.id and z.reversal_action_id is not null)")"
check "no confirmed send receipt without a provider acknowledgement" 0 "$(q -c "select count(*) from receipt_event r join action a on a.id=r.action_id where a.kind='send_email' and r.state='confirmed' and r.provider_ack is null and r.erased_at is null")"
check "no receipt ever left its action's owner" 0 "$(q -c "select count(*) from receipt_event r join action a on a.id=r.action_id where r.owner_id <> a.owner_id")"
check "every approval is bound to one action and one hash" 0 "$(q -c "select count(*) from approval ap join action a on a.id=ap.action_id where ap.payload_hash <> a.payload_hash and a.verb <> 'Erased'")"
check "receipts are a gapless sequence per action" 0 "$(q -c "select count(*) from (select action_id, count(*) c, max(sequence) m from receipt_event group by action_id) s where c <> m")"
check "the global feed still carries no provisional text" "" "$(as_user $A $AUTH "select activity_feed(200, null, 'global')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(''.join(r['kind'] for r in d['rows'] if r['kind'] in ('propose','draft')))")"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "SOME CHECKS FAILED"; exit 1; }
