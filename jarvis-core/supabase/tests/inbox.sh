#!/usr/bin/env bash
# Real-Postgres proof for migration 0061 (the VYZN feed: the app proposal surface, record_push,
# records_import, record_approve; Phase 0 design D5 and D6, 2026-10-10).
#
# Usage: eval "$(./local_pg.sh start)"; ./inbox.sh
#
# What it proves (the 30 checks of PHASE0-DESIGN.md section 3, 35 as run: 12a, 12b, 19a, 26a and 26b
# are the review fixes of 2026-10-10, named in the 0061 header):
#   an app is a connection the server mints, with a hashed token, propose only, Help Me; a second mint
#   rotates the hash and the epoch and writes a second receipt, never a second row
#   a push writes proposals on the app surface with no job, never an item; the inbox is invisible to
#   hub_overview; a replay is a replay with its status; a batch with one bad record writes nothing
#   (authority keys, reserved keys inside data, fifty one records, a 9 KB data, a reused key with a
#   different hash); the feed never asks the AI switch while proposal_submit does
#   the browser cannot push; a read only, revoked or non app connection cannot push; records_import runs
#   as the person with the app's connection when one exists
#   the arrival receipt reads Received 3 Records From Backend Inbox (singular: Received 1 Record)
#   record_approve makes the item with the server's clientId and app stamp, the evidence, the action, the
#   consumed approval and one confirmed receipt; the actor is the agent when the connection exists and
#   You otherwise; the item's history reads function via record_approve and its links created_by import
#   a lower or equal revision of a saved record is already_saved; a higher one is a proposal that
#   record_approve refuses with DESTINATION_CHANGED and the difference; a higher revision before any tap
#   supersedes the lower; dismiss, undo and the two receipt readers know a record
#   Just Handle It is refused for an app; Read Only pauses pushes; B reads nothing of A's
#   a client_at that is infinite or more than a day ahead is refused; two sessions pushing the same new
#   batch at once answer replay, and other bytes under one key refuse the loser whole; a null expected
#   revision is INVALID_PAYLOAD; Undo then Approve approves again under a new key and a third tap replays
#   the second; a newer revision whose item was undone is not a dead end
#   readiness carries phase0.inbox true; every function carries search_path; rollback restores the six
#   bodies, drops the eight functions, keeps the columns and the person's proposals; forward again
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=inbox_test
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
counts() { q -c "select (select count(*) from pg_tables where schemaname='public') || '/' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')"; }
app_props() { q -c "select count(*) from proposal where owner_id='$1' and surface='app'"; }
outcomes() { py "print(','.join(r['outcome'] for r in d['results']))"; }

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
AUTH=authenticated
SVC=service_role
CONN=50000000-0000-0000-0000-00000000000a
PKG=c0000000-0000-0000-0000-00000000000a
PROJ_A=10000000-0000-0000-0000-00000000000a
C_TASK=90000000-0000-0000-0000-0000000000a2
FIX_ACT=e0000000-0000-0000-0000-00000000000a
APP=backend-inbox
ID1=inbox_11111111-1111-4111-8111-111111111111
ID2=inbox_22222222-2222-4222-8222-222222222222
ID3=inbox_33333333-3333-4333-8333-333333333333
ID4=inbox_44444444-4444-4444-8444-444444444444
ID5=inbox_55555555-5555-4555-8555-555555555555
ID6=inbox_66666666-6666-4666-8666-666666666666
ID7=inbox_77777777-7777-4777-8777-777777777777
ID8=inbox_88888888-8888-4888-8888-888888888888
ID9=inbox_99999999-9999-4999-8999-999999999999
IDN=inbox_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
IDP=inbox_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
IDB=inbox_cccccccc-cccc-4ccc-8ccc-cccccccccccc
IDC=inbox_dddddddd-dddd-4ddd-8ddd-dddddddddddd
IDR1=inbox_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1
IDR2=inbox_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2
IDR3=inbox_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3
IDR4=inbox_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4
IDT=inbox_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5
IDF=inbox_ffffffff-ffff-4fff-8fff-ffffffffffff
rec() { # id revision text [extra data keys] [client_at]
  echo "{\"source_record_id\":\"$1\",\"revision\":$2,\"kind\":\"task\",\"data\":{\"text\":\"$3\",\"due\":\"2026-10-01\",\"notes\":\"Priority High\"${4:-}},\"source\":{\"label\":\"Added by Michael Corleone\"},\"client_at\":\"${5:-2026-10-09T12:00:00Z}\"}"
}
BATCH3="[$(rec $ID1 1 'Send the grant letter'),$(rec $ID2 1 'Call the board chair'),$(rec $ID3 1 'Book the venue')]"
TASK_PREP="{\"destination_kind\":\"task\",\"data\":{\"text\":\"Send the grant letter\",\"category\":\"\",\"done\":false,\"due\":\"2026-10-01\",\"notes\":\"Priority High\",\"projectId\":\"$PROJ_A\",\"source\":{\"type\":\"paste\",\"ts\":1}},\"exact_effect\":\"Added to Tasks · Send the Grant Letter\",\"display_summary\":\"Send the Grant Letter · Due Oct 1\",\"module_version\":\"tasks-service-2026-10-03\"}"
CAP_PREP='{"destination_kind":"task","data":{"text":"Review transcript","category":"","done":false,"due":"2026-10-09"},"exact_effect":"Added to Tasks · Review transcript","display_summary":"Review transcript · Due Oct 9","module_version":"tasks-2026-10-02"}'
push() { as_user $A $SVC "select record_push('$A','$FEED','$APP','$1')"; }
# One session, one transaction, several statements (each -c); the service role's claims are local to it.
push_tx() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -c "begin" -c "set local role $SVC" -c "select set_config('request.jwt.claims', '{\"sub\":\"$A\",\"role\":\"$SVC\"}', true)" "$@" -c "commit" 2>&1 | tail -1; }
# A push held open for three seconds before it commits, in the background: the race partner of a second push.
push_held() { push_tx -c "select record_push('$A','$FEED','$APP','$1')" -c "select pg_sleep(3)" >/dev/null & sleep 1; }
approve() { # proposal prepared [who]
  local who=${3:-$A}; local rev hash
  rev=$(q -c "select revision from proposal where id='$1'"); hash=$(q -c "select payload_hash from proposal where id='$1'")
  as_user $who $AUTH "select record_approve('$1',$rev,'$hash','k-$1','$2')"
}

echo "-- forward: stub + chain 0001..0061, fixtures, then 0061 twice"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort | grep -v '/0062_'); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
COUNTS1=$(counts)
check "1. 0061 forwards twice (idempotent)" "ok|$COUNTS1|1|1" "$(q -f "$here/../migrations/0061_vyzn_inbox.sql" >/dev/null && echo ok)|$(counts)|$(q -c "select count(*) from pg_constraint where conrelid='proposal'::regclass and conname='proposal_app_job_check'")|$(q -c "select count(*) from pg_constraint where conrelid='source_evidence'::regclass and conname='source_evidence_app_fields_check'")"

echo "-- the app's connection: minted by the server, a hash only, rotated on a second mint"
M1=$(as_user $A $SVC "select vyzn_app_connect('$A','$APP','hash-feed')")
FEED=$(echo "$M1" | jget connection_id)
H1=$(q -c "select token_hash from jarvis_private.agent_credential where connection_id='$FEED'")
M2=$(as_user $A $SVC "select vyzn_app_connect('$A','$APP','hash-feed-2')")
check "2. vyzn_app_connect makes one connected connection with propose and help_me, stores only a hash; a second call rotates the hash, writes no second row and writes a second receipt under the next epoch" \
  "connected|1|Backend Inbox|connected|https|{propose}|help_me|hash-feed|$FEED|2|1|hash-feed-2|connect:$FEED:1,connect:$FEED:2|Connected · Backend Inbox|42501" \
  "$(echo "$M1" | jget status)|$(echo "$M1" | jget auth_epoch)|$(q -c "select display_name||'|'||status||'|'||transport||'|'||verified_capabilities::text||'|'||mode from agent_connection where id='$FEED'")|$H1|$(echo "$M2" | jget connection_id)|$(echo "$M2" | jget auth_epoch)|$(q -c "select count(*) from agent_connection where owner_id='$A' and provider_key='$APP'")|$(q -c "select token_hash from jarvis_private.agent_credential where connection_id='$FEED'")|$(q -c "select string_agg(idempotency_key, ',' order by idempotency_key) from action where owner_id='$A' and kind='connect_app'")|$(q -c "select distinct verb from action where owner_id='$A' and kind='connect_app'")|$(as_user_state $A $AUTH "select token_hash from jarvis_private.agent_credential where connection_id='$FEED'")"
check "3. an unknown app is refused; the browser cannot call vyzn_app_connect" "INVALID_PAYLOAD|42501" "$(as_user $A $SVC "select vyzn_app_connect('$A','notion','h')" | jget error)|$(as_user_state $A $AUTH "select vyzn_app_connect('$A','$APP','h')")"

echo "-- the push: proposals on the app surface, never an item"
ITEMS0=$(q -c "select count(*) from item where owner_id='$A'")
P1=$(push "$BATCH3")
check "4. record_push as service role writes one proposal per record with surface app and job_id null, and no item" "proposed,proposed,proposed|3|3|3|$ITEMS0" \
  "$(echo "$P1" | outcomes)|$(echo "$P1" | jget received)|$(app_props $A)|$(q -c "select count(*) from proposal where owner_id='$A' and surface='app' and job_id is null")|$(q -c "select count(*) from item where owner_id='$A'")"
PR1=$(echo "$P1" | jget results.0.proposal_id)
RCPT1=$(echo "$P1" | jget receipt_id)
check "5. the proposal carries the envelope" "client_at,client_id,data,kind,revision,source,source_app,source_record_id|task|$APP|$ID1|$APP:$ID1|1|Added by Michael Corleone|Send the grant letter|$FEED|agent|untrusted_suggestion|$APP:$ID1:1|capture" \
  "$(q -c "select (select string_agg(k, ',' order by k) from jsonb_object_keys(payload) k)||'|'||(payload->>'kind')||'|'||(payload->>'source_app')||'|'||(payload->>'source_record_id')||'|'||(payload->>'client_id')||'|'||(payload->>'revision')||'|'||(payload->'source'->>'label')||'|'||(payload->'data'->>'text')||'|'||agent_id||'|'||created_by||'|'||origin_taint||'|'||idempotency_key||'|'||type from proposal where id='$PR1'")"
check "6. the inbox is invisible to hub_overview and the Review feed; vyzn_inbox() has 3" "1|0|3|3|$ID1" \
  "$(as_user $A $AUTH "select hub_overview()" | py "print(len(d['proposals']))")|$(as_user $A $AUTH "select hub_overview()" | py "print(sum(1 for p in d['proposals'] if p['id']=='$PR1'))")|$(as_user $A $AUTH "select vyzn_inbox()" | jget count)|$(as_user $A $AUTH "select vyzn_inbox()" | py "print(len(d['rows']))")|$(as_user $A $AUTH "select vyzn_inbox()" | py "print([r['source_record_id'] for r in d['rows'] if r['id']=='$PR1'][0])")"
ACTS=$(q -c "select count(*) from action where owner_id='$A'")
P2=$(push "$BATCH3")
check "7. a replay is a replay with its status: same batch, three replays with status proposed, no new rows, the same receipt" "replay,replay,replay|proposed,proposed,proposed|True|3|$ACTS|$RCPT1" \
  "$(echo "$P2" | outcomes)|$(echo "$P2" | py "print(','.join(r['status'] for r in d['results']))")|$(echo "$P2" | jget replay)|$(app_props $A)|$(q -c "select count(*) from action where owner_id='$A'")|$(echo "$P2" | jget receipt_id)"
check "8. the same key with a different payload refuses the whole batch" "IDEMPOTENCY_CONFLICT|$ID2|3" \
  "$(push "[$(rec $ID4 1 'A new one'),$(rec $ID2 1 'Call the board chair tomorrow')]" | py "print(d['error']+'|'+d['source_record_id'])")|$(app_props $A)"
check "9. an authority key inside data refuses the whole batch; previous_item, destination_id, clientId or source inside data refuses the whole batch" "INVALID_PAYLOAD|INVALID_PAYLOAD|INVALID_PAYLOAD|INVALID_PAYLOAD|INVALID_PAYLOAD|INVALID_PAYLOAD|INVALID_PAYLOAD|3" \
  "$(push "[$(rec $ID4 1 'Clean'),$(rec $ID5 1 'Smuggled' ',"approved":true')]" | jget error)|$(push "[$(rec $ID4 1 'Clean' ',"approved_by":"me"')]" | jget error)|$(push "[$(rec $ID4 1 'Clean'),$(rec $ID5 1 'Points' ',"previous_item":"'$PROJ_A'"')]" | jget error)|$(push "[$(rec $ID4 1 'Clean' ',"destination_id":"'$PROJ_A'"')]" | jget error)|$(push "[$(rec $ID4 1 'Clean' ',"clientId":"x"')]" | jget error)|$(push "[$(rec $ID4 1 'Clean' ',"source":{"type":"app"}')]" | jget error)|$(push "[{\"source_record_id\":\"$ID4\",\"revision\":1,\"kind\":\"task\",\"data\":{\"text\":\"x\"},\"status\":\"accepted\"}]" | jget error)|$(app_props $A)"
BIG=$(python3 -c "import json; print(json.dumps([{'source_record_id':'inbox_%08d-0000-4000-8000-000000000000' % i,'revision':1,'kind':'task','data':{'text':'Task %d' % i}} for i in range(51)]))")
FAT=$(python3 -c "import json; print(json.dumps([{'source_record_id':'$ID4','revision':1,'kind':'task','data':{'text':'x','notes':'n'*9000}}]))")
check "10. fifty one records is refused; a 9 KB data is refused" "INVALID_PAYLOAD|records|INVALID_PAYLOAD|data|3" \
  "$(push "$BIG" | py "print(d['error']+'|'+d['detail'])")|$(push "$FAT" | py "print(d['error']+'|'+d['detail'])")|$(app_props $A)"

echo "-- the feed never asks the AI switch"
q -c "update auth.users set raw_app_meta_data = raw_app_meta_data || '{\"ai_allowed\": false}' where id='$A'" >/dev/null
check "11. record_push never asks the AI switch: A's AI off, a push still answers proposed, proposal_submit on the same connection answers ADMIN_AI_DISABLED" "proposed|ADMIN_AI_DISABLED" \
  "$(push "[$(rec $ID4 1 'Pay the caterer')]" | outcomes)|$(as_user $A $SVC "select proposal_submit('$A','$FEED','$PKG','project','decision','{\"statement\":\"x\"}','{}','k-ai')" | jget error)"
q -c "update agent_connection set mode='read_only' where id='$FEED'" >/dev/null
RO=$(push "[$(rec $ID5 1 'Paused')]" | jget error)
q -c "update agent_connection set mode='help_me', status='revoked' where id='$FEED'" >/dev/null
RV=$(push "[$(rec $ID5 1 'Revoked')]" | jget error)
q -c "update agent_connection set status='connected' where id='$FEED'" >/dev/null
check "12. the browser cannot call record_push; a read only or revoked connection cannot push; a connection with provider_key claude cannot push" "42501|SCOPE_DENIED|CONNECTION_REVOKED|SCOPE_DENIED|4" \
  "$(as_user_state $A $AUTH "select record_push('$A','$FEED','$APP','$BATCH3')")|$RO|$RV|$(as_user $A $SVC "select record_push('$A','$CONN','$APP','[$(rec $ID5 1 'Claude')]')" | jget error)|$(app_props $A)"

echo "-- the moment and the race (review fixes 2 and 3)"
N12=$(app_props $A)
check "12a. a client_at of infinity, -infinity or the year 9999 is refused with INVALID_PAYLOAD client_at and the record's id, writes nothing; the year 2000 is accepted" "INVALID_PAYLOAD|client_at|$IDC|INVALID_PAYLOAD|client_at|INVALID_PAYLOAD|client_at|$N12|proposed" \
  "$(push "[$(rec $IDC 1 'When' '' infinity)]" | py "print(d['error']+'|'+d['detail']+'|'+d['source_record_id'])")|$(push "[$(rec $IDC 1 'When' '' -infinity)]" | py "print(d['error']+'|'+d['detail'])")|$(push "[$(rec $IDC 1 'When' '' 9999-12-31T00:00:00Z)]" | py "print(d['error']+'|'+d['detail'])")|$(app_props $A)|$(push "[$(rec $IDC 1 'When' '' 2000-01-01T00:00:00Z)]" | outcomes)"
RACE1="[$(rec $IDR1 1 'Race one'),$(rec $IDR2 1 'Race two')]"
push_held "$RACE1"
R12B=$(push "$RACE1")
wait
push_held "[$(rec $IDR3 1 'Race three')]"
R12C=$(push "[$(rec $IDR4 1 'Innocent'),$(rec $IDR3 1 'Race three, other bytes')]")
wait
check "12b. two sessions push the same new batch at once: the second answers replay for both with the first's receipt, one proposal per record; other bytes under one key refuse the loser whole (the innocent record is not written); two pushes inside one transaction answer replay" \
  "replay,replay|True|2|t|1|1|IDEMPOTENCY_CONFLICT|$IDR3|1|0|replay" \
  "$(echo "$R12B" | outcomes)|$(echo "$R12B" | py "print(str(d['replay'])+'|'+str(len([1 for r in d['results'] if r['proposal_id']])))")|$(q -c "select '$(echo "$R12B" | jget receipt_id)' = (select r.id::text from receipt_event r join action a on a.id = r.action_id where a.owner_id='$A' and a.idempotency_key = 'records:' || encode(sha256(convert_to('$RACE1'::jsonb::text, 'UTF8')), 'hex'))")|$(q -c "select count(*) from proposal where owner_id='$A' and payload->>'source_record_id'='$IDR1'")|$(q -c "select count(*) from proposal where owner_id='$A' and payload->>'source_record_id'='$IDR2'")|$(echo "$R12C" | py "print(d['error']+'|'+d['source_record_id'])")|$(q -c "select count(*) from proposal where owner_id='$A' and payload->>'source_record_id'='$IDR3'")|$(q -c "select count(*) from proposal where owner_id='$A' and payload->>'source_record_id'='$IDR4'")|$(push_tx -c "select record_push('$A','$FEED','$APP','[$(rec $IDT 1 'Twice')]')" -c "select record_push('$A','$FEED','$APP','[$(rec $IDT 1 'Twice')]')" | outcomes)"

echo "-- the pull: records_import as the person"
I1=$(as_user $A $AUTH "select records_import('$APP','[$(rec $ID5 1 'Thank the donors')]')")
PR5=$(echo "$I1" | jget results.0.proposal_id)
I2=$(as_user $B $AUTH "select records_import('$APP','[$(rec $ID6 1 'Order tiles for the hall')]')")
PRB=$(echo "$I2" | jget results.0.proposal_id)
check "13. records_import runs as the person; with the app's connection present created_by is import and the proposal carries agent_id; with no connection agent_id is null; anon is 42501" "proposed|import|$FEED|proposed|import||42501" \
  "$(echo "$I1" | outcomes)|$(q -c "select created_by||'|'||agent_id from proposal where id='$PR5'")|$(echo "$I2" | outcomes)|$(q -c "select created_by||'|'||coalesce(agent_id::text,'') from proposal where id='$PRB'")|$(as_user_state $A anon "select records_import('$APP','[$(rec $ID7 1 'Anon')]')")"
check "14. the arrival receipt reads Received 3 Records From Backend Inbox and the singular reads Received 1 Record" "Received 3 Records From Backend Inbox|agent|Backend Inbox|Received 1 Record From Backend Inbox|Received 1 Record From Backend Inbox|user|You" \
  "$(q -c "select r.exact_verb||'|'||r.actor_kind||'|'||r.actor_display from receipt_event r where r.id='$RCPT1'")|$(q -c "select exact_verb from receipt_event where id='$(echo "$I1" | jget receipt_id)'")|$(q -c "select exact_verb||'|'||actor_kind||'|'||actor_display from receipt_event where id='$(echo "$I2" | jget receipt_id)'")"

echo "-- the tap: record_approve"
R15=$(approve $PR1 "$TASK_PREP")
DEST=$(echo "$R15" | jget destination_id)
ACT=$(echo "$R15" | jget action_id)
EV=$(echo "$R15" | jget evidence_id)
check "15. record_approve makes the task with clientId and the app stamp, drops the prepared source key, writes evidence type app with the text as excerpt, an action record_task, a consumed approval and one confirmed receipt with the per field diff" \
  "confirmed|False|task|$APP:$ID1|app|$APP:$ID1|1791547200000|app|$APP|$ID1|Send the grant letter|record_task|true|$PR1|confirmed|1|1|confirmed|Added to Tasks · Send the Grant Letter|3|accepted" \
  "$(echo "$R15" | py "print(d['state']+'|'+str(d['already']))")|$(q -c "select entity_type||'|'||(data->>'clientId')||'|'||(data->'source'->>'type')||'|'||(data->'source'->>'ref')||'|'||(data->'source'->>'ts') from item where id='$DEST'")|$(q -c "select type||'|'||source_app||'|'||source_record_id||'|'||excerpt from source_evidence where id='$EV'")|$(q -c "select kind||'|'||(authorization_snapshot ? 'approved_by')||'|'||proposal_id||'|'||state from action where id='$ACT'")|$(q -c "select count(*) from approval where action_id='$ACT' and consumed_at is not null")|$(q -c "select count(*) from receipt_event where action_id='$ACT'")|$(q -c "select state||'|'||exact_verb||'|'||jsonb_array_length(diff) from receipt_event where action_id='$ACT'")|$(q -c "select status from proposal where id='$PR1'")"
RB=$(approve $PRB "$(echo "$TASK_PREP" | sed "s/Send the grant letter/Order tiles for the hall/; s/\"projectId\":\"$PROJ_A\",//")" $B)
check "16. a record with agent_id reads actor agent and the receipt actor_display Backend Inbox; a record with no agent_id reads actor user" "agent|Backend Inbox|True|user|You|confirmed" \
  "$(q -c "select actor_kind||'|'||actor_display from receipt_event where action_id='$ACT'")|$(as_user $A $AUTH "select receipt_detail('$ACT')" | jget approved_by_user)|$(q -c "select actor_kind||'|'||actor_display from receipt_event where action_id='$(echo "$RB" | jget action_id)'")|$(echo "$RB" | jget state)"
check "17. the item's first change reads function via record_approve and a projectId link reads created_by import; item_why(dest).answer = import" "insert|function|record_approve|in|projectId|import|record_approve|import|1|record_task|$APP|$ID1" \
  "$(q -c "select op||'|'||origin||'|'||via from item_change where item_id='$DEST' order by at, id limit 1")|$(q -c "select kind||'|'||path||'|'||created_by||'|'||via from item_link where from_item='$DEST'")|$(as_user $A $AUTH "select item_why('$DEST')" | py "print(d['answer']+'|'+str(len(d['actions']))+'|'+d['actions'][0]['kind']+'|'+d['evidence'][0]['source_app']+'|'+d['evidence'][0]['source_record_id'])")"
check "18. receipt_detail and activity_feed read undoable true for a record_task and still true for a capture_task" "True|True|True|True" \
  "$(as_user $A $AUTH "select receipt_detail('$ACT')" | jget undoable)|$(as_user $A $AUTH "select activity_feed(200)" | py "print([r['undoable'] for r in d['rows'] if r['action_id']=='$ACT'][0])")|$(as_user $A $AUTH "select receipt_detail('$FIX_ACT')" | jget undoable)|$(as_user $A $AUTH "select activity_feed(200)" | py "print([r['undoable'] for r in d['rows'] if r['action_id']=='$FIX_ACT'][0])")"
HASH1=$(q -c "select payload_hash from proposal where id='$PR1'")
REV1=$(q -c "select revision from proposal where id='$PR1'")
PR2=$(echo "$P1" | jget results.1.proposal_id)
check "19. a second tap with the same hash is a replay; a different hash is IDEMPOTENCY_CONFLICT; a wrong revision is SOURCE_CHANGED" "True|$ACT|IDEMPOTENCY_CONFLICT|SOURCE_CHANGED" \
  "$(as_user $A $AUTH "select record_approve('$PR1',$REV1,'$HASH1','k-again','$TASK_PREP')" | py "print(str(d['replay'])+'|'+d['action_id'])")|$(as_user $A $AUTH "select record_approve('$PR1',$REV1,'other-hash','k-other','$TASK_PREP')" | jget error)|$(as_user $A $AUTH "select record_approve('$PR2',99,'$(q -c "select payload_hash from proposal where id='$PR2'")','k-rev','$TASK_PREP')" | jget error)"
check "19a. a null expected revision is INVALID_PAYLOAD expected_revision for record_approve and record_dismiss, and the row stays proposed" "INVALID_PAYLOAD|expected_revision|INVALID_PAYLOAD|expected_revision|proposed" \
  "$(as_user $A $AUTH "select record_approve('$PR2',null,'$(q -c "select payload_hash from proposal where id='$PR2'")','k-null','$TASK_PREP')" | py "print(d['error']+'|'+d['detail'])")|$(as_user $A $AUTH "select record_dismiss('$PR2',null)" | py "print(d['error']+'|'+d['detail'])")|$(q -c "select status from proposal where id='$PR2'")"
PRBILL=$(push "[$(rec $IDB 1 'Con Edison bill' ',"amountCents":14230,"vendor":"Con Edison"')]" | jget results.0.proposal_id)
ITEMS_B=$(q -c "select count(*) from item where owner_id='$A'")
check "20. a bill shaped task is MISSING_DETAILS bill_is_not_a_task and writes nothing" "MISSING_DETAILS|[\"bill_is_not_a_task\"]|$ITEMS_B|proposed" \
  "$(approve $PRBILL "$(echo "$TASK_PREP" | sed 's/"notes":"Priority High"/"notes":"","amountCents":14230,"vendor":"Con Edison"/')" | py "print(d['error']+'|'+json.dumps(d['missing']))")|$(q -c "select count(*) from item where owner_id='$A'")|$(q -c "select status from proposal where id='$PRBILL'")"
NOTE_REC="{\"source_record_id\":\"$IDN\",\"revision\":1,\"kind\":\"note\",\"data\":{\"title\":\"Board notes\",\"body\":\"Three items\"}}"
PERSON_REC="{\"source_record_id\":\"$IDP\",\"revision\":1,\"kind\":\"person\",\"data\":{\"name\":\"Jane Donor\",\"email\":\"jane@example.test\"}}"
PN=$(push "[$NOTE_REC,$PERSON_REC]")
PRN=$(echo "$PN" | jget results.0.proposal_id)
PRP=$(echo "$PN" | jget results.1.proposal_id)
NOTE_PREP='{"destination_kind":"note","data":{"title":"Board notes","category":"","blocks":[],"connections":[]},"exact_effect":"Added to Notes · Board Notes","display_summary":"Board Notes","module_version":"notes-2026-10-10"}'
PERSON_PREP='{"destination_kind":"person","data":{"name":"Jane Donor","group":"contacts","triageState":"unsorted","source":"import","email":"jane@example.test"},"exact_effect":"Added to People · Jane Donor","display_summary":"Jane Donor","module_version":"people-2026-10-10"}'
RN=$(approve $PRN "$NOTE_PREP")
RP=$(approve $PRP "$PERSON_PREP")
NOTE_ID=$(echo "$RN" | jget destination_id)
check "21. a note and a person approve into the writers' own shapes" "confirmed|note|Board notes|[]|[]|$APP:$IDN|app|record_note|confirmed|person|Jane Donor|contacts|unsorted|app|record_person|title,email" \
  "$(echo "$RN" | jget state)|$(q -c "select entity_type||'|'||(data->>'title')||'|'||(data->'blocks')::text||'|'||(data->'connections')::text||'|'||(data->>'clientId')||'|'||(data->'source'->>'type') from item where id='$NOTE_ID'")|$(q -c "select kind from action where id='$(echo "$RN" | jget action_id)'")|$(echo "$RP" | jget state)|$(q -c "select entity_type||'|'||(data->>'name')||'|'||(data->>'group')||'|'||(data->>'triageState')||'|'||(data->'source'->>'type') from item where id='$(echo "$RP" | jget destination_id)'")|$(q -c "select kind from action where id='$(echo "$RP" | jget action_id)'")|$(q -c "select coalesce(jarvis_capture_valid('note','note','{\"title\":\"\",\"blocks\":[]}'),'')||','||coalesce(jarvis_capture_valid('person','person','{\"name\":\"x\",\"email\":\"nope\"}'),'')")"

echo "-- revisions: never an overwrite"
PR8=$(push "[$(rec $ID8 2 'Fix the roof')]" | jget results.0.proposal_id)
R8=$(approve $PR8 "$(echo "$TASK_PREP" | sed 's/Send the grant letter/Fix the roof/')")
ITEM8=$(echo "$R8" | jget destination_id)
N22=$(app_props $A)
check "22. a lower or equal revision of a saved record is already_saved (lower) or a replay with status accepted (equal) and writes no proposal" "already_saved|$ITEM8|replay|accepted|$N22" \
  "$(push "[$(rec $ID8 1 'Fix the roof')]" | py "print(d['results'][0]['outcome']+'|'+d['results'][0]['item_id'])")|$(push "[$(rec $ID8 2 'Fix the roof')]" | py "print(d['results'][0]['outcome']+'|'+d['results'][0]['status'])")|$(app_props $A)"
P23=$(push "[$(rec $ID8 3 'Fix the roof and the gutter')]")
PR8b=$(echo "$P23" | jget results.0.proposal_id)
U8=$(q -c "select updated_at from item where id='$ITEM8'")
R23=$(approve $PR8b "$(echo "$TASK_PREP" | sed 's/Send the grant letter/Fix the roof and the gutter/')")
check "23. a higher revision of a saved record is newer_revision_proposed, and approving it is DESTINATION_CHANGED with the difference and no write" "newer_revision_proposed|$ITEM8|$ITEM8|DESTINATION_CHANGED|text|Fix the roof|Fix the roof and the gutter|$U8|Fix the roof|proposed|0" \
  "$(echo "$P23" | py "print(d['results'][0]['outcome']+'|'+d['results'][0]['item_id'])")|$(q -c "select payload->>'previous_item' from proposal where id='$PR8b'")|$(echo "$R23" | py "f=[x for x in d['difference'] if x['field']=='text'][0]; print(d['error']+'|'+f['field']+'|'+f['yours']+'|'+f['theirs'])")|$(q -c "select updated_at||'|'||(data->>'text') from item where id='$ITEM8'")|$(q -c "select status from proposal where id='$PR8b'")|$(q -c "select count(*) from action where proposal_id='$PR8b'")"
PS1=$(push "[$(rec $ID9 1 'Draft the agenda')]" | jget results.0.proposal_id)
PS2R=$(push "[$(rec $ID9 2 'Draft the agenda for Friday')]")
PS2=$(echo "$PS2R" | jget results.0.proposal_id)
check "24. a higher revision before any tap supersedes the lower proposal; vyzn_inbox lists one; approving the superseded one is INVALID_PAYLOAD" "proposed|1|superseded|proposed|1|INVALID_PAYLOAD|superseded" \
  "$(echo "$PS2R" | py "print(d['results'][0]['outcome']+'|'+str(d['results'][0]['superseded']))")|$(q -c "select status from proposal where id='$PS1'")|$(q -c "select status from proposal where id='$PS2'")|$(as_user $A $AUTH "select vyzn_inbox()" | py "print(sum(1 for r in d['rows'] if r['client_id']=='$APP:$ID9'))")|$(approve $PS1 "$TASK_PREP" | py "print(d['error']+'|'+d['detail'])")"
REV_S2=$(q -c "select revision from proposal where id='$PS2'")
check "25. record_dismiss dismisses; the same revision again is a replay with status dismissed; a higher revision is a new proposal" "dismissed|dismissed|True|replay|dismissed|proposed|0" \
  "$(as_user $A $AUTH "select record_dismiss('$PS2',$REV_S2)" | jget status)|$(as_user $A $AUTH "select record_dismiss('$PS2',$REV_S2)" | py "print(d['status']+'|'+str(d['replay']))")|$(push "[$(rec $ID9 2 'Draft the agenda for Friday')]" | py "print(d['results'][0]['outcome']+'|'+d['results'][0]['status'])")|$(push "[$(rec $ID9 3 'Draft the agenda for Monday')]" | py "print(d['results'][0]['outcome']+'|'+str(d['results'][0]['superseded']))")"

echo "-- undo: a record task and a capture task alike"
U15=$(echo "$R15" | jget item_updated_at)
UN=$(as_user $A $AUTH "select action_undo('$ACT','$U15','k-undo-1')")
UNN=$(as_user $A $AUTH "select action_undo('$(echo "$RN" | jget action_id)','$(echo "$RN" | jget item_updated_at)','k-undo-2')")
RC=$(as_user $A $AUTH "select capture_approve('$C_TASK',1,'ph-a2','k-cap','$CAP_PREP')")
UNC=$(as_user $A $AUTH "select action_undo('$(echo "$RC" | jget action_id)','$(echo "$RC" | jget item_updated_at)','k-undo-3')")
check "26. action_undo removes a record task and puts the proposal back to proposed; an undone record note reads Removed From Notes; action_undo still undoes a capture_task exactly as before" \
  "confirmed|Removed From Tasks · Send the grant letter|0|proposed|1|Removed From Notes · Board notes|0|accepted|Removed From Tasks · Review transcript|0|proposed" \
  "$(echo "$UN" | py "print(d['state']+'|'+d['safe_message'])")|$(q -c "select count(*) from item where id='$DEST'")|$(q -c "select status from proposal where id='$PR1'")|$(as_user $A $AUTH "select vyzn_inbox()" | py "print(sum(1 for r in d['rows'] if r['id']=='$PR1'))")|$(echo "$UNN" | jget safe_message)|$(q -c "select count(*) from item where id='$NOTE_ID'")|$(q -c "select status from proposal where id='$PRP'")|$(echo "$UNC" | jget safe_message)|$(q -c "select count(*) from item where id='$(echo "$RC" | jget destination_id)'")|$(q -c "select status from email_candidate where id='$C_TASK'")"

R26A=$(approve $PR1 "$TASK_PREP")
ACT2=$(echo "$R26A" | jget action_id)
R26B=$(as_user $A $AUTH "select record_approve('$PR1',$(q -c "select revision from proposal where id='$PR1'"),'$HASH1','k-third','$TASK_PREP')")
check "26a. Undo then Approve approves the same row again under a new key: a second action, the item made again under its clientId, the row accepted; a third tap with the same hash replays the second action, not the undone one" \
  "confirmed|False|1|accepted|record:$PR1:1:0,record:$PR1:1:1|True|$ACT2|IDEMPOTENCY_CONFLICT" \
  "$(echo "$R26A" | py "print(d['state']+'|'+str(d['already']))")|$(q -c "select count(*) from item where owner_id='$A' and data->>'clientId'='$APP:$ID1'")|$(q -c "select status from proposal where id='$PR1'")|$(q -c "select string_agg(idempotency_key, ',' order by created_at) from action where proposal_id='$PR1' and kind like 'record\\_%'")|$(echo "$R26B" | py "print(str(d['replay'])+'|'+d['action_id'])")|$(as_user $A $AUTH "select record_approve('$PR1',$(q -c "select revision from proposal where id='$PR1'"),'other-hash','k-fourth','$TASK_PREP')" | jget error)"
PF1=$(push "[$(rec $IDF 1 'Paint the fence')]" | jget results.0.proposal_id)
RF1=$(approve $PF1 "$(echo "$TASK_PREP" | sed 's/Send the grant letter/Paint the fence/')")
PF2R=$(push "[$(rec $IDF 2 'Paint the fence white')]")
PF2=$(echo "$PF2R" | jget results.0.proposal_id)
EF2=$(approve $PF2 "$(echo "$TASK_PREP" | sed 's/Send the grant letter/Paint the fence white/')" | jget error)
UF1=$(as_user $A $AUTH "select action_undo('$(echo "$RF1" | jget action_id)','$(echo "$RF1" | jget item_updated_at)','k-undo-f')" | jget state)
RF2=$(approve $PF2 "$(echo "$TASK_PREP" | sed 's/Send the grant letter/Paint the fence white/')")
check "26b. approve rev 1, push rev 2 (newer_revision_proposed, refused while the item stands), undo rev 1: approving rev 2 creates the item instead of a permanent Item removed; rev 1 is back to proposed, rev 2 accepted" \
  "confirmed|newer_revision_proposed|DESTINATION_CHANGED|confirmed|confirmed|False|Paint the fence white|$APP:$IDF|1|proposed|accepted" \
  "$(echo "$RF1" | jget state)|$(echo "$PF2R" | outcomes)|$EF2|$UF1|$(echo "$RF2" | py "print(d['state']+'|'+str(d['already']))")|$(q -c "select (data->>'text')||'|'||(data->>'clientId') from item where id='$(echo "$RF2" | jget destination_id)'")|$(q -c "select count(*) from item where owner_id='$A' and data->>'clientId'='$APP:$IDF'")|$(q -c "select status from proposal where id='$PF1'")|$(q -c "select status from proposal where id='$PF2'")"

echo "-- the mode words for an app"
FEED_REV=$(q -c "select revision from agent_connection where id='$FEED'")
CONN_REV=$(q -c "select revision from agent_connection where id='$CONN'")
check "27. connection_set_mode refuses just_handle_it for a VYZN app with SCOPE_DENIED and still allows it for a claude connection; read_only then makes record_push answer SCOPE_DENIED; help_me restores it" "SCOPE_DENIED|an app only proposes|help_me|just_handle_it|read_only|SCOPE_DENIED|help_me|proposed" \
  "$(as_user $A $AUTH "select connection_set_mode('$FEED',$FEED_REV,'just_handle_it')" | py "print(d['error']+'|'+d['detail'])")|$(q -c "select mode from agent_connection where id='$FEED'")|$(as_user $A $AUTH "select connection_set_mode('$CONN',$CONN_REV,'just_handle_it')" | jget mode)|$(as_user $A $AUTH "select connection_set_mode('$FEED',$FEED_REV,'read_only')" | jget mode)|$(push "[$(rec $ID7 1 'Paused again')]" | jget error)|$(as_user $A $AUTH "select connection_set_mode('$FEED',$((FEED_REV + 1)),'help_me')" | jget mode)|$(push "[$(rec $ID7 1 'Resumed')]" | outcomes)"

echo "-- the owner's alone"
REV2=$(q -c "select revision from proposal where id='$PR2'")
HASH2=$(q -c "select payload_hash from proposal where id='$PR2'")
check "28. B cannot approve, dismiss or read A's proposal; anon is 42501" "NOT_FOUND|NOT_FOUND|0|42501|42501|42501" \
  "$(as_user $B $AUTH "select record_approve('$PR2',$REV2,'$HASH2','k-b','$TASK_PREP')" | jget error)|$(as_user $B $AUTH "select record_dismiss('$PR2',$REV2)" | jget error)|$(as_user $B $AUTH "select vyzn_inbox()" | py "print(sum(1 for r in d['rows'] if r['id']=='$PR2'))")|$(as_user_state $A anon "select record_approve('$PR2',$REV2,'$HASH2','k-anon','$TASK_PREP')")|$(as_user_state $A anon "select record_dismiss('$PR2',$REV2)")|$(as_user_state $A anon "select vyzn_inbox()")"

echo "-- posture"
NEW_FNS="'jarvis_vyzn_apps','vyzn_app_connect','jarvis_records_ingest','record_push','records_import','vyzn_inbox','record_approve','record_dismiss','jarvis_capture_valid','action_undo','activity_feed','receipt_detail','connection_set_mode','item_why'"
check "29. readiness carries phase0.inbox true; every new function carries search_path, is revoked from PUBLIC, and no browser role executes record_push, vyzn_app_connect or jarvis_records_ingest" "0060|True|True|0|0|14|false|false|false|false|false|false" \
  "$(as_user $A $AUTH "select substrate_readiness()" | py "p=d['phase0']; print(d['migration']+'|'+str(p['memory'])+'|'+str(p['inbox']))")|$(q -c "select count(*) filter (where p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')) || '|' || count(*) filter (where not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')) || '|' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ($NEW_FNS)")|$(q -c "select has_function_privilege('authenticated','record_push(uuid, uuid, text, jsonb)','execute')||'|'||has_function_privilege('anon','record_push(uuid, uuid, text, jsonb)','execute')||'|'||has_function_privilege('authenticated','vyzn_app_connect(uuid, text, text)','execute')||'|'||has_function_privilege('anon','vyzn_app_connect(uuid, text, text)','execute')||'|'||has_function_privilege('authenticated','jarvis_records_ingest(uuid, uuid, text, jsonb, text)','execute')||'|'||has_function_privilege('anon','jarvis_records_ingest(uuid, uuid, text, jsonb, text)','execute')")"

echo "-- rollback, then forward again"
N_APP=$(app_props $A)
q -f "$here/../rollback/0061_vyzn_inbox_down.sql" >/dev/null
check "30. rollback restores the six bodies, drops the eight functions, keeps the columns and the person's proposals; forward again" "0|f|f|f|f|f|t|3|$N_APP|f|none|$COUNTS1|$N_APP" \
  "$(q -c "select count(*) from pg_proc where proname in ('jarvis_vyzn_apps','vyzn_app_connect','jarvis_records_ingest','record_push','records_import','vyzn_inbox','record_approve','record_dismiss')")|$(q -c "select pg_get_functiondef('action_undo'::regproc) like '%record\\_%'")|$(q -c "select pg_get_functiondef('jarvis_capture_valid'::regproc) like '%person%'")|$(q -c "select pg_get_functiondef('activity_feed'::regproc) like '%record\\_%'")|$(q -c "select pg_get_functiondef('receipt_detail'::regproc) like '%record\\_%'")|$(q -c "select pg_get_functiondef('connection_set_mode'::regproc) like '%jarvis_vyzn_apps%'")|$(q -c "select pg_get_functiondef('item_why'::regproc) like '%null::text%'")|$(q -c "select count(*) from information_schema.columns where table_name='source_evidence' and column_name in ('source_app','source_record_id','source_url')")|$(app_props $A)|$(q -c "select attnotnull from pg_attribute where attrelid='proposal'::regclass and attname='job_id'")|$(q -c "select coalesce(proconfig::text,'none') from pg_proc where proname='jarvis_capture_valid'")|$(q -f "$here/../migrations/0061_vyzn_inbox.sql" >/dev/null && counts)|$(app_props $A)"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILURES"; exit 1; }
