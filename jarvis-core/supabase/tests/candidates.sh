#!/usr/bin/env bash
# Real-Postgres proof for migration 0049 (candidates proposed and read, slice
# 06). Same stubbed Supabase, 0044's fixtures.
#
# Usage: eval "$(./local_pg.sh start)"; ./candidates.sh
#
# What it proves (IMPLEMENTATION-SPEC.md 08 E07, E09, E10, E25; 10.1 step 7; 13):
#   E07  a proposal is a row of the kind the rules named, with its provenance and missing fields; a browser cannot plant an agent's
#   10.1 the same fingerprint is the same card (a second proposal replays); the semantic fields decide, not the text
#   E10  a dismissed fingerprint stays dismissed when the rules propose it again
#   E25  a changed message marks its older cards stale; the new copy's proposal lands beside them; a stale card cannot be approved
#   E09  the read for a page carries the message's current hash, the saved sibling and the action; another owner reads nothing
#   S16  nothing here writes an item: the item count stands until an approval
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=candidates_test
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

echo "-- forward: stub + chain 0001..0049, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
echo "-- rollback 0049, forward again (idempotent)"
q -f "$here/../rollback/0049_candidates_down.sql" >/dev/null
check "rollback removes the two functions" 0 "$(q -c "select count(*) from pg_proc where proname in ('candidate_propose','candidates_for')")"
q -f "$here/../migrations/0049_candidates.sql" >/dev/null
q -f "$here/../migrations/0049_candidates.sql" >/dev/null
check "forward again is idempotent" 2 "$(q -c "select count(*) from pg_proc where proname in ('candidate_propose','candidates_for')")"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
M1=70000000-0000-0000-0000-00000000000a
M2=70000000-0000-0000-0000-0000000000a2
AUTH=authenticated
ITEMS_BEFORE=$(q -c "select count(*) from item where owner_id='$A'")
BILL='{"kind":"bill","issuer":"Con Edison","amount":{"minor_units":14230,"currency":"USD"},"due_date":"2026-10-15","no_due_date_confirmed":false}'
PROV='{"issuer":{"source":"email"},"amount":{"source":"email","text_start":12,"text_end":22},"due_date":{"source":"email","text_start":40,"text_end":56}}'

echo "-- E07: a proposal is a row of its kind; dedupe by fingerprint; the browser cannot plant an agent"
P1=$(as_user $A $AUTH "select candidate_propose('$M1','bill','$BILL','$PROV','{}','fp-bill-14230-2026-10-15','rules-2026-10-03','sh-a1')")
C1=$(echo "$P1" | jget candidate_id)
check "a new bill candidate: proposed, revision 1, a server hash, not a replay" "proposed|1|false|64" "$(echo "$P1" | py "print(d['status']+'|'+str(d['revision'])+'|'+str(d['replay']).lower()+'|'+str(len(d['payload_hash'])))")"
check "the row carries the rules' provenance, its origin and the extractor's version" "rule|rules-2026-10-03|email|{}" "$(q -c "select origin || '|' || extractor_version || '|' || (provenance_by_field -> 'amount' ->> 'source') || '|' || missing_fields::text from email_candidate where id='$C1'")"
P1B=$(as_user $A $AUTH "select candidate_propose('$M1','bill','$BILL','$PROV','{}','fp-bill-14230-2026-10-15','rules-2026-10-03','sh-a1')")
check "the same fingerprint again is the same card, replayed" "$C1|true|1" "$(echo "$P1B" | py "print(d['candidate_id']+'|'+str(d['replay']).lower()+'|'+str(d['revision']))")"
check "the fixture's own bill card (a different fingerprint) still stands beside it" 2 "$(q -c "select count(*) from email_candidate where message_id='$M1' and kind='bill' and status='proposed'")"
check "a manual capture may be proposed with missing fields and reads as needs details" "needs_details" "$(as_user $A $AUTH "select candidate_propose('$M2','event','{\"kind\":\"event\",\"title\":\"Call about the deposit\"}','{}','{time,timezone}','fp-ev-1','manual','sh-a2','manual')" | jget status)"
check "an agent origin is not the browser's to claim" INVALID_PAYLOAD "$(as_user $A $AUTH "select candidate_propose('$M1','bill','$BILL','{}','{}','fp-x','rules-2026-10-03','sh-a1','agent')" | jget error)"
check "a payload that smuggles an approval is refused" INVALID_PAYLOAD "$(as_user $A $AUTH "select candidate_propose('$M1','bill','{\"kind\":\"bill\",\"approved\":true}','{}','{}','fp-y','rules-2026-10-03','sh-a1')" | jget error)"
check "a kind that is not a capture kind is refused" INVALID_PAYLOAD "$(as_user $A $AUTH "select candidate_propose('$M1','payment','{}','{}','{}','fp-z','rules-2026-10-03','sh-a1')" | jget error)"
check "a bill payload under a task kind is refused" INVALID_PAYLOAD "$(as_user $A $AUTH "select candidate_propose('$M1','task','$BILL','{}','{}','fp-w','rules-2026-10-03','sh-a1')" | jget error)"
check "B cannot propose on A's message" NOT_FOUND "$(as_user $B $AUTH "select candidate_propose('$M1','bill','$BILL','{}','{}','fp-b','rules-2026-10-03','sh-a1')" | jget error)"
check "anon cannot propose" 42501 "$(as_user_state $A anon "select candidate_propose('$M1','bill','$BILL','{}','{}','fp-anon','rules-2026-10-03','sh-a1')")"
check "a copy that is not the current message is refused with the current hash" "SOURCE_CHANGED|sh-a1" "$(as_user $A $AUTH "select candidate_propose('$M1','bill','$BILL','{}','{}','fp-old','rules-2026-10-03','sh-old')" | py "print(d['error']+'|'+d['source_hash'])")"

echo "-- E10: a dismissed fingerprint stays dismissed"
R1=$(as_user $A $AUTH "select candidate_dismiss('$C1',1)")
check "dismissed, with its fingerprint remembered" "dismissed|fp-bill-14230-2026-10-15" "$(q -c "select status || '|' || dismissed_fingerprint from email_candidate where id='$C1'")"
P1C=$(as_user $A $AUTH "select candidate_propose('$M1','bill','$BILL','$PROV','{}','fp-bill-14230-2026-10-15','rules-2026-10-03','sh-a1')")
check "the rules proposing it again get the dismissed card back, not a new one" "$C1|dismissed|true" "$(echo "$P1C" | py "print(d['candidate_id']+'|'+d['status']+'|'+str(d['replay']).lower())")"
check "the page read leaves it out unless asked, and includes it when asked" "0|1" "$(as_user $A $AUTH "select candidates_for('{$M1}')" | py "print(sum(1 for c in d if c['id']=='$C1'))")|$(as_user $A $AUTH "select candidates_for('{$M1}', true)" | py "print(sum(1 for c in d if c['id']=='$C1'))")"
REV=$(q -c "select revision from email_candidate where id='$C1'")
check "restore brings it back as proposed" proposed "$(as_user $A $AUTH "select candidate_restore('$C1',$REV)" | jget status)"

echo "-- E25: the message changes; the older cards go stale; the new copy's card lands; a stale card cannot be approved"
q -c "update email_message set source_hash='sh-a1-v2', snippet='Amount due \$148.20 by Oct 15' where id='$M1'" >/dev/null
BILL2='{"kind":"bill","issuer":"Con Edison","amount":{"minor_units":14820,"currency":"USD"},"due_date":"2026-10-15","no_due_date_confirmed":false}'
P2=$(as_user $A $AUTH "select candidate_propose('$M1','bill','$BILL2','$PROV','{}','fp-bill-14820-2026-10-15','rules-2026-10-03','sh-a1-v2')")
C2=$(echo "$P2" | jget candidate_id)
check "the new copy's card is proposed and the older provisional cards were marked stale" "proposed|2" "$(echo "$P2" | py "print(d['status']+'|'+str(d['stale_marked']))")"
check "...both older bill cards read stale now" 2 "$(q -c "select count(*) from email_candidate where message_id='$M1' and kind='bill' and status='stale'")"
check "the page read shows each card's own hash beside the message's current one" "sh-a1|sh-a1-v2" "$(as_user $A $AUTH "select candidates_for('{$M1}')" | py "c=[x for x in d if x['id']=='$C1'][0]; print(c['source_hash']+'|'+c['message_source_hash'])")"
check "a stale card cannot be approved" SOURCE_CHANGED "$(as_user $A $AUTH "select capture_approve('$C1',$REV,'x','k-stale','{}')" | jget error)"
REV1=$(q -c "select revision from email_candidate where id='$C1'")
P1D=$(as_user $A $AUTH "select candidate_propose('$M1','bill','$BILL','$PROV','{}','fp-bill-14230-2026-10-15','rules-2026-10-03','sh-a1-v2')")
check "the same fingerprint proposed from the new copy refreshes the stale card instead of duplicating it" "$C1|proposed|true|$((REV1+1))" "$(echo "$P1D" | py "print(d['candidate_id']+'|'+d['status']+'|'+str(d['refreshed']).lower()+'|'+str(d['revision']))")"

echo "-- E09: the read for a page: the saved sibling and the action behind a saved card; another owner reads nothing"
BILL_PREP='{"destination_kind":"money_bill","data":{"vendor":"Con Edison","amountCents":14820,"currency":"USD","dueDate":"2026-10-15","source":{"type":"email","fingerprint":"gmail:t-a1","ref":"t-a1"},"fingerprint":"bill|con edison|14820|2026-10-15","history":[{"by":"email","what":"created from an email","at":"2026-10-03T12:00:00Z"}]},"exact_effect":"Saved $148.20 Bill to Money","display_summary":"Con Edison · $148.20 · Due Oct 15","module_version":"money-ledger-2026-10-02"}'
H2=$(echo "$P2" | jget payload_hash)
AP=$(as_user $A $AUTH "select capture_approve('$C2',1,'$H2','k-c2','$BILL_PREP')")
ACT=$(echo "$AP" | jget action_id)
check "the new card saves (slice 03's door) and the item count grew by exactly one" "confirmed|$((ITEMS_BEFORE+1))" "$(echo "$AP" | jget state)|$(q -c "select count(*) from item where owner_id='$A'")"
check "the page read carries the saved card's action and destination" "saved|$ACT|true" "$(as_user $A $AUTH "select candidates_for('{$M1}')" | py "c=[x for x in d if x['id']=='$C2'][0]; print(c['status']+'|'+c['action_id']+'|'+str(c['destination_id'] is not None).lower())")"
check "...and the refreshed older card names the saved sibling with its payload, so the screen can show old and new" "$C2|14820" "$(as_user $A $AUTH "select candidates_for('{$M1}')" | py "c=[x for x in d if x['id']=='$C1'][0]; print(c['saved_sibling']['id']+'|'+str(c['saved_sibling']['payload']['amount']['minor_units']))")"
check "an agent's suggestion (the fixture's gateway path) would carry its assistant's name; a rule's carries none" "" "$(as_user $A $AUTH "select candidates_for('{$M1}')" | py "c=[x for x in d if x['id']=='$C2'][0]; print(c['agent_name'] or '')")"
check "B reads none of A's cards" 0 "$(as_user $B $AUTH "select candidates_for('{$M1,$M2}')" | py "print(len(d))")"
check "anon cannot read cards" 42501 "$(as_user_state $A anon "select candidates_for('{$M1}')")"

echo "-- S16 and S01: proposing writes no item and needs no AI; the only item written was the approved one"
check "no item was written by any proposal" "$((ITEMS_BEFORE+1))" "$(q -c "select count(*) from item where owner_id='$A'")"
check "no candidate ever points at a task item from a bill" 0 "$(q -c "select count(*) from email_candidate c join item i on i.id = c.destination_id where c.kind in ('bill','receipt') and i.entity_type = 'task'")"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "SOME CHECKS FAILED"; exit 1; }
