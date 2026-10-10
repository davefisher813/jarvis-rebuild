#!/usr/bin/env bash
# Real-Postgres proof for migration 0064 (the durable connection incident, Email v1 spec 2026-10-08 section 10, Dave's
# locked decisions L1 and L5; AC22 to AC24).
#
# Usage: eval "$(./local_pg.sh start)"; ./connection_incident.sh
#
# What it proves:
#   two finders of the same incident write one row; a malformed ID or kind is refused
#   the alert is due 15 minutes after DETECTION (the database's clock), not after the anchor
#   the claim takes only due, open, pending, unleased rows, and two claims never take the same one
#   only the claim's holder can settle it, only forward (pending -> unavailable, pending -> unknown -> submitted), never twice
#   recovery resolves the account's open incidents and suppresses a pending alert; an attempted alert keeps its outcome
#   a resolved incident is never claimed and cannot be marked for dispatch
#   the browser can neither read the table nor call any of the four functions; rollback removes them; forward twice is a no-op
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=connection_incident_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
as_user() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" 2>&1 | tail -1; }
as_user_state() { local out st; if out=$(PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" 2>&1 >/dev/null); then echo ok; return; fi; st=$(echo "$out" | sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' | head -1); echo "${st:-fail}"; }
jget() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d
for k in sys.argv[1].split('.'):
    v=v[int(k)] if isinstance(v,list) else v.get(k)
print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list,bool)) else v))" "$1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }

echo "-- forward: stub + the whole chain, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
check "0064 forwards twice (idempotent)" ok "$(q -f "$here/../migrations/0064_connection_incident.sql" >/dev/null && echo ok)"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
SVC=service_role
AUTH=authenticated
rec() { as_user $A $SVC "select connection_incident_record('$1','$2','$3','$4','$5','testing_mode_7_day','INVALID_GRANT','status')"; }
row() { q -c "select $2 from connection_incident where incident_id='$1'"; }

echo "-- record: once per incident, whoever finds it"
check "the first finder records it" true "$(rec $A A@Example.test JC-0000AAAA auth 2026-10-10T09:00:00Z | jget recorded)"
check "the second finder (same ID) records nothing" false "$(rec $A a@example.test JC-0000AAAA auth 2026-10-10T09:00:00Z | jget recorded)"
check "one row, lowercased, bound to the account, open, alert pending" "1|a@example.test|60000000-0000-0000-0000-00000000000a|open|pending|connection" "$(q -c "select count(*) from connection_incident where incident_id='JC-0000AAAA'")|$(row JC-0000AAAA "account_address || '|' || account_id || '|' || state || '|' || alert_status || '|' || alert_type")"
check "due 15 minutes after detection, not after the anchor" "900|true" "$(row JC-0000AAAA "extract(epoch from alert_due_at - first_detected_at)::int || '|' || (first_detected_at > opened_at)")"
check "a malformed ID is refused" INVALID_PAYLOAD "$(rec $A a@example.test 'JC-1' auth 2026-10-10T09:00:00Z | jget error)"
check "an unknown kind is refused" INVALID_PAYLOAD "$(rec $A a@example.test JC-0000AAAB lost 2026-10-10T09:00:00Z | jget error)"
check "another owner's incident is its own row" true "$(rec $B b@example.test JC-0000BBBB auth 2026-10-10T09:00:00Z | jget recorded)"

echo "-- the claim: only what is due"
check "nothing is due inside the 15 minutes" "[]" "$(as_user $A $SVC "select connection_incident_claim(10)")"
q -c "update connection_incident set alert_due_at = now() - interval '1 second' where incident_id in ('JC-0000AAAA','JC-0000BBBB')" >/dev/null
C1=$(as_user $A $SVC "select connection_incident_claim(1)")
ID1=$(echo "$C1" | jget 0.id); T1=$(echo "$C1" | jget 0.claim_token); INC1=$(echo "$C1" | jget 0.incident_id)
check "a due alert is claimed with a token" "true|true" "$([ -n "$ID1" ] && echo true)|$([ -n "$T1" ] && echo true)"
C2=$(as_user $A $SVC "select connection_incident_claim(10)")
check "a second tick takes the OTHER one, never the leased one" "1|false" "$(echo "$C2" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")|$(echo "$C2" | python3 -c "import json,sys; print(str(any(r['id']=='$ID1' for r in json.load(sys.stdin))).lower())")"
ID2=$(echo "$C2" | jget 0.id); T2=$(echo "$C2" | jget 0.claim_token)
check "a third tick takes nothing" "[]" "$(as_user $A $SVC "select connection_incident_claim(10)")"

echo "-- settle: once, forward, by the holder only"
check "a wrong token settles nothing" false "$(as_user $A $SVC "select connection_incident_alert_settle('$ID1','$T2','unavailable','no_user_scoped_transport')" | jget settled)"
check "no transport: pending -> unavailable, with the reason and the time" "true|unavailable|no_user_scoped_transport|true" "$(as_user $A $SVC "select connection_incident_alert_settle('$ID1','$T1','unavailable','no_user_scoped_transport')" | jget settled)|$(q -c "select alert_status || '|' || alert_reason || '|' || (alert_attempted_at is not null) from connection_incident where id='$ID1'")"
check "it is never attempted again (a second settle is refused)" false "$(as_user $A $SVC "select connection_incident_alert_settle('$ID1','$T1','unknown','dispatching')" | jget settled)"
q -c "update connection_incident set alert_lease_until = now() - interval '1 second' where id='$ID1'" >/dev/null
check "and never claimed again, even with its lease gone" "[]" "$(as_user $A $SVC "select connection_incident_claim(10)")"
check "a transport path: pending -> unknown (marked before the send)" unknown "$(as_user $A $SVC "select connection_incident_alert_settle('$ID2','$T2','unknown','dispatching')" | jget alert_status)"
check "unknown -> submitted (the provider accepted it)" submitted "$(as_user $A $SVC "select connection_incident_alert_settle('$ID2','$T2','submitted',null)" | jget alert_status)"
check "submitted is final" false "$(as_user $A $SVC "select connection_incident_alert_settle('$ID2','$T2','failed',null)" | jget settled)"
check "an unknown status is refused" INVALID_PAYLOAD "$(as_user $A $SVC "select connection_incident_alert_settle('$ID2','$T2','pending',null)" | jget error)"

echo "-- recovery: resolves, and suppresses a pending alert"
rec $A a@example.test JC-0000CCCC degraded 2026-10-09T09:00:00Z >/dev/null
R=$(as_user $A $SVC "select connection_incident_resolve('$A','A@example.test')")
check "both open incidents on the account end; the pending one is suppressed" "2|1" "$(echo "$R" | jget resolved)|$(echo "$R" | jget suppressed)"
check "the pending alert is suppressed, never sent" "resolved|suppressed|recovered|true" "$(row JC-0000CCCC "state || '|' || alert_status || '|' || alert_reason || '|' || (alert_attempted_at is null)")"
check "the alert already attempted keeps its outcome" "resolved|unavailable" "$(row JC-0000AAAA "state || '|' || alert_status")"
check "a second resolve finds nothing open" 0 "$(as_user $A $SVC "select connection_incident_resolve('$A','a@example.test')" | jget resolved)"
check "B's incident is untouched by A's recovery" open "$(row JC-0000BBBB state)"
check "the resolved incident is the same ID forever: a later finder writes nothing" false "$(rec $A a@example.test JC-0000CCCC degraded 2026-10-09T09:00:00Z | jget recorded)"
q -c "update connection_incident set alert_due_at = now() - interval '1 minute' where incident_id='JC-0000CCCC'" >/dev/null
check "a resolved incident is never claimed" "[]" "$(as_user $A $SVC "select connection_incident_claim(10)")"

echo "-- a recovery between the claim and the send wins"
rec $A a@example.test JC-0000DDDD auth 2026-10-10T10:00:00Z >/dev/null
q -c "update connection_incident set alert_due_at = now() - interval '1 second' where incident_id='JC-0000DDDD'" >/dev/null
C3=$(as_user $A $SVC "select connection_incident_claim(10)"); ID3=$(echo "$C3" | jget 0.id); T3=$(echo "$C3" | jget 0.claim_token)
as_user $A $SVC "select connection_incident_resolve('$A','a@example.test')" >/dev/null
check "the pre-dispatch mark is refused on a resolved incident" "false|suppressed" "$(as_user $A $SVC "select connection_incident_alert_settle('$ID3','$T3','unknown','dispatching')" | jget settled)|$(row JC-0000DDDD alert_status)"

echo "-- who may call what"
check "the browser cannot read the table" 42501 "$(as_user_state $A $AUTH "select count(*) from connection_incident")"
check "anon cannot read the table" 42501 "$(as_user_state $A anon "select count(*) from connection_incident")"
check "the browser cannot record" 42501 "$(as_user_state $A $AUTH "select connection_incident_record('$A','a@example.test','JC-0000EEEE','auth',now())")"
check "the browser cannot resolve" 42501 "$(as_user_state $A $AUTH "select connection_incident_resolve('$A','a@example.test')")"
check "the browser cannot claim" 42501 "$(as_user_state $A $AUTH "select connection_incident_claim(10)")"
check "the browser cannot settle" 42501 "$(as_user_state $A $AUTH "select connection_incident_alert_settle('$ID3','$T3','unavailable',null)")"

echo "-- rollback, and forward again"
q -f "$here/../rollback/0064_connection_incident_down.sql" >/dev/null
check "the table and the four functions are gone" "0|0" "$(q -c "select count(*) from pg_class where relname='connection_incident'")|$(q -c "select count(*) from pg_proc where proname like 'connection_incident_%'")"
q -f "$here/../migrations/0064_connection_incident.sql" >/dev/null
check "forward again after a rollback" "1|4" "$(q -c "select count(*) from pg_class where relname='connection_incident'")|$(q -c "select count(*) from pg_proc where proname like 'connection_incident_%'")"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILURES"; exit 1; }
