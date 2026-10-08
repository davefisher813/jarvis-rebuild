#!/usr/bin/env bash
# Real-Postgres proof for migration 0059 (the 30-second send hold, Email v1 spec
# 2026-10-08 section 9, Dave's locked decision 4; AC27 to AC33).
#
# Usage: eval "$(./local_pg.sh start)"; ./send_hold.sh
#
# What it proves:
#   the approval stamps hold_until = +30s and dispatch_deadline = +60s from the SERVER clock, once; a replay never extends it
#   no worker can claim a held command (claim and claim_action both answer nothing inside the hold)
#   Undo inside the hold cancels the command and brings the draft back; Undo after the countdown but before a claim still works
#   once a worker has claimed it, Undo answers "already handed to Gmail" and changes nothing (the race has one winner)
#   past the deadline a worker cancels it as HOLD_EXPIRED (the draft comes back, a receipt is written), never sends late
#   a command with no hold (the older path) is claimable at once, exactly as before
#   the status read is the owner's alone; the browser cannot claim; rollback puts the old bodies back
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=send_hold_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
as_user() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" 2>&1 | tail -1; }
as_user_state() { local out st; if out=$(PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" 2>&1 >/dev/null); then echo ok; return; fi; st=$(echo "$out" | sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' | head -1); echo "${st:-fail}"; }
jget() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d
for k in sys.argv[1].split('.'):
    v=v[int(k)] if isinstance(v,list) else v.get(k)
print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))" "$1"; }
py() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }

echo "-- forward: stub + chain 0001..0059, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
q -f "$here/../migrations/0059_send_hold.sql" >/dev/null
check "0059 forwards twice (idempotent)" ok "$(q -f "$here/../migrations/0059_send_hold.sql" >/dev/null && echo ok)"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
ACCT_A=60000000-0000-0000-0000-00000000000a
AUTH=authenticated
SVC=service_role

draft() { # a new draft, reviewed: prints "draft_id nonce hash action"
  local s d rv
  s=$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"to_addresses\":[\"coach@example.test\"],\"subject\":\"Re: $1\",\"body_text\":\"On it.\"}')")
  d=$(echo "$s" | jget draft_id)
  rv=$(as_user $A $AUTH "select send_review('$d')")
  echo "$d $(echo "$rv" | jget review.review_nonce) $(echo "$rv" | jget review.payload_hash) $(echo "$rv" | jget review.action_id)"
}
claim_action() { as_user $A $SVC "select outbox_claim_action('test','$1')"; }

echo "-- the hold is stamped once, from the server clock"
read -r D1 N1 H1 X1 <<<"$(draft one)"
AP1=$(as_user $A $AUTH "select send_approve_held('$D1','$N1','$H1','k-1')")
check "the approval is held: queued, with hold_until = server_now + 30s and the deadline 30s after" "queued|30|30" "$(echo "$AP1" | py "from datetime import datetime as D
p=lambda s: D.fromisoformat(s)
print(d['outbox_state']+'|'+str(int((p(d['hold_until'])-p(d['server_now'])).total_seconds()))+'|'+str(int((p(d['dispatch_deadline'])-p(d['hold_until'])).total_seconds())))")"
check "the draft is sending, bound to the action" "sending|$X1" "$(q -c "select send_state || '|' || sent_action_id from email_draft where id='$D1'")"
HOLD1=$(q -c "select hold_until from outbox_command where action_id='$X1'")
AP1B=$(as_user $A $AUTH "select send_approve_held('$D1','$N1','$H1','k-1b')")
check "a replay is the same action and does NOT extend the hold" "$X1|$HOLD1" "$(echo "$AP1B" | jget action_id)|$(q -c "select hold_until from outbox_command where action_id='$X1'")"

echo "-- no worker can claim inside the hold"
check "claim_action answers nothing inside the hold" "" "$(claim_action $X1 | tr -d ' ')"
check "claim (the generic one) answers nothing inside the hold" "" "$(as_user $A $SVC "select outbox_claim('test')" | tr -d ' ')"
check "the command is still queued" queued "$(q -c "select state from outbox_command where action_id='$X1'")"

echo "-- Undo inside the hold (AC28)"
UN1=$(as_user $A $AUTH "select command_cancel('$X1')")
check "Undo cancels the command" "cancelled|cancelled|CANCELLED" "$(echo "$UN1" | jget state)|$(q -c "select state from outbox_command where action_id='$X1'")|$(q -c "select error_code from outbox_command where action_id='$X1'")"
check "...and the draft is a draft again, free to edit" "draft|" "$(q -c "select send_state || '|' || coalesce(sent_action_id::text,'') from email_draft where id='$D1'")"
check "...and a worker finds nothing to send (zero provider calls)" "" "$(claim_action $X1 | tr -d ' ')"

echo "-- Undo after the countdown but before a claim still wins (the spec: it succeeds while the command is held)"
read -r D2 N2 H2 X2 <<<"$(draft two)"
as_user $A $AUTH "select send_approve_held('$D2','$N2','$H2','k-2')" >/dev/null
q -c "update outbox_command set hold_until = now() - interval '2 seconds', dispatch_deadline = now() + interval '28 seconds' where action_id='$X2'" >/dev/null
check "countdown at zero, no worker yet: Undo cancels" "cancelled|draft" "$(as_user $A $AUTH "select command_cancel('$X2')" | jget state)|$(q -c "select send_state from email_draft where id='$D2'")"

echo "-- the race: a worker claims first, Undo then loses and changes nothing (AC29)"
read -r D3 N3 H3 X3 <<<"$(draft three)"
as_user $A $AUTH "select send_approve_held('$D3','$N3','$H3','k-3')" >/dev/null
q -c "update outbox_command set hold_until = now() - interval '1 second', dispatch_deadline = now() + interval '29 seconds' where action_id='$X3'" >/dev/null
CL3=$(claim_action $X3)
check "after the hold a worker claims it" "claimed|1" "$(q -c "select state from outbox_command where action_id='$X3'")|$(echo "$CL3" | jget attempt)"
check "Undo now answers 'already handed', not cancelled" "cancellation_requested|claimed|sending" "$(as_user $A $AUTH "select command_cancel('$X3')" | jget state)|$(q -c "select state from outbox_command where action_id='$X3'")|$(q -c "select send_state from email_draft where id='$D3'")"

echo "-- never sent late (AC32): past the deadline the claim cancels it"
read -r D4 N4 H4 X4 <<<"$(draft four)"
as_user $A $AUTH "select send_approve_held('$D4','$N4','$H4','k-4')" >/dev/null
q -c "update outbox_command set hold_until = now() - interval '31 seconds', dispatch_deadline = now() - interval '1 second' where action_id='$X4'" >/dev/null
CL4=$(claim_action $X4)
check "the worker answers HOLD_EXPIRED and does not claim" "HOLD_EXPIRED|cancelled|HOLD_EXPIRED" "$(echo "$CL4" | jget reason)|$(q -c "select state from outbox_command where action_id='$X4'")|$(q -c "select error_code from outbox_command where action_id='$X4'")"
check "the draft comes back for a fresh review, not stuck sending" "draft|" "$(q -c "select send_state || '|' || coalesce(sent_action_id::text,'') from email_draft where id='$D4'")"
check "a receipt says it was held too long" "1" "$(q -c "select count(*) from receipt_event where action_id='$X4' and error_code='HOLD_EXPIRED'")"
check "the generic claim does the same for a stranded one" "HOLD_EXPIRED" "$(read -r D5 N5 H5 X5 <<<"$(draft five)"; as_user $A $AUTH "select send_approve_held('$D5','$N5','$H5','k-5')" >/dev/null; q -c "update outbox_command set hold_until = now() - interval '40 seconds', dispatch_deadline = now() - interval '10 seconds' where action_id='$X5'" >/dev/null; as_user $A $SVC "select outbox_claim('test')" | jget reason)"

echo "-- the older path: no hold, claimable at once (unchanged)"
read -r D6 N6 H6 X6 <<<"$(draft six)"
as_user $A $AUTH "select send_approve('$D6','$N6','$H6','k-6')" >/dev/null
check "no hold timestamps" "|" "$(q -c "select coalesce(hold_until::text,'') || '|' || coalesce(dispatch_deadline::text,'') from outbox_command where action_id='$X6'")"
check "a worker claims it immediately" "claimed" "$(claim_action $X6 >/dev/null; q -c "select state from outbox_command where action_id='$X6'")"

echo "-- the status read, and who may call what"
read -r D7 N7 H7 X7 <<<"$(draft seven)"
as_user $A $AUTH "select send_approve_held('$D7','$N7','$H7','k-7')" >/dev/null
ST=$(as_user $A $AUTH "select send_hold_status('$X7')")
check "the owner reads state, both timestamps, the server clock and the draft" "queued|true|true|sending" "$(echo "$ST" | py "print(d['state']+'|'+str(bool(d['hold_until'])).lower()+'|'+str(bool(d['server_now'])).lower()+'|'+d['draft_state'])")"
check "another owner reads nothing" NOT_FOUND "$(as_user $B $AUTH "select send_hold_status('$X7')" | jget error)"
check "anon cannot read it" 42501 "$(as_user_state $A anon "select send_hold_status('$X7')")"
check "the browser cannot claim" 42501 "$(as_user_state $A $AUTH "select outbox_claim('x')")"
check "the browser cannot claim an action" 42501 "$(as_user_state $A $AUTH "select outbox_claim_action('x','$X7')")"
check "B cannot hold A's draft" NOT_FOUND "$(as_user $B $AUTH "select send_approve_held('$D7','$N7','$H7','k-b')" | jget error)"
check "no hold is ever stamped on a refused approval" REVIEW_CHANGED "$(read -r D8 N8 H8 X8 <<<"$(draft eight)"; as_user $A $AUTH "select send_approve_held('$D8','$N8','deadbeef','k-8')" | jget error)"

echo "-- rollback: the old bodies are back, the columns stay"
q -f "$here/../rollback/0059_send_hold_down.sql" >/dev/null
check "the hold functions are gone" 0 "$(q -c "select count(*) from pg_proc where proname in ('send_approve_held','send_hold_status')")"
check "the columns stay" 2 "$(q -c "select count(*) from information_schema.columns where table_name='outbox_command' and column_name in ('hold_until','dispatch_deadline')")"
check "the old claim ignores a hold (claimable at once)" claimed "$(read -r D9 N9 H9 X9 <<<"$(draft nine)"; as_user $A $AUTH "select send_approve('$D9','$N9','$H9','k-9')" >/dev/null; q -c "update outbox_command set hold_until = now() + interval '30 seconds' where action_id='$X9'" >/dev/null; claim_action $X9 >/dev/null; q -c "select state from outbox_command where action_id='$X9'")"
q -f "$here/../migrations/0059_send_hold.sql" >/dev/null
check "forward again after a rollback" 2 "$(q -c "select count(*) from pg_proc where proname in ('send_approve_held','send_hold_status')")"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILURES"; exit 1; }
