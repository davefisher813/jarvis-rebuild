#!/usr/bin/env bash
# Real-Postgres proof for migration 0047 (durable decision review and the
# Hub's reads, slice 04). Same stubbed Supabase, 0044's fixtures.
#
# Usage: eval "$(./local_pg.sh start)"; ./review.sh
#
# What it proves (IMPLEMENTATION-SPEC.md 06, 09 H1 to H7, 15):
#   S03  a proposal is a proposal: the active-decision set is unchanged until Save
#   S11  Keep as note makes an exploration_note that no active-constraint read returns
#   S12  replace and withdraw keep immutable history with reasons; dependencies suggest, never rewrite
#   S16  the Hub's reads carry no email candidate payload, only the count
#   plus: statement and reason required, real dependency ids only, no cycle,
#         conflicts named and blocking without Replace, setMode is not a grant,
#         another owner sees nothing.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=review_test
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

echo "-- forward: stub + chain 0001..0047, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
echo "-- rollback 0047, forward again (idempotent)"
q -f "$here/../rollback/0047_review_and_hub_down.sql" >/dev/null
check "rollback removes the review functions" 0 "$(q -c "select count(*) from pg_proc where proname in ('decision_save','hub_overview','decision_withdraw')")"
q -f "$here/../migrations/0047_review_and_hub.sql" >/dev/null
q -f "$here/../migrations/0047_review_and_hub.sql" >/dev/null
check "forward again is idempotent" 3 "$(q -c "select count(*) from pg_proc where proname in ('decision_save','hub_overview','decision_withdraw')")"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
CONN=50000000-0000-0000-0000-00000000000a
PROJ=10000000-0000-0000-0000-00000000000a
PROJ_B=10000000-0000-0000-0000-00000000000b
TASK=20000000-0000-0000-0000-00000000000a
TASK_B=20000000-0000-0000-0000-00000000000b
DEC=40000000-0000-0000-0000-00000000000a
PROP=d0000000-0000-0000-0000-00000000000a
AUTH=authenticated
SVC=service_role
# The fixture decision is attached to the project, as the Decisions module writes it.
q -c "update item set data = data || '{\"links\":[{\"type\":\"project\",\"id\":\"$PROJ\",\"label\":\"Summer travel\"}]}' where id='$DEC'" >/dev/null
q -c "update decision_version set constraints = '[{\"key\":\"trip_budget_usd\",\"value\":\"2400\"}]' where item_id='$DEC'" >/dev/null
active_before=$(q -c "select count(*) from decision_version where owner_id='$A' and status='active'")

echo "-- the Hub's one read (H1 to H3)"
HUB=$(as_user $A $AUTH "select hub_overview()")
check "AI switch read live" ok "$(echo "$HUB" | jget ai)"
check "connections: the person's, with mode and verified capabilities" "Claude|help_me|connected" "$(echo "$HUB" | py "c=[x for x in d['connections'] if x['id']=='$CONN'][0]; print(c['display_name']+'|'+c['mode']+'|'+c['status'])")"
check "the proposal waits as a proposal" "$PROP|decision|proposed-only" "$(echo "$HUB" | py "p=[x for x in d['proposals'] if x['id']=='$PROP'][0]; print(p['id']+'|'+p['type']+'|proposed-only')")"
check "projects for the picker" "Summer travel" "$(echo "$HUB" | py "print([p['title'] for p in d['projects']][0])")"
check "S16: the email review count only, never a candidate field" "2|" "$(echo "$HUB" | jget email_review_count)|$(echo "$HUB" | grep -o 'Con Edison' | head -1)"
check "B's hub holds none of A's" "0|0" "$(as_user $B $AUTH "select hub_overview()" | py "print(str(sum(1 for c in d['connections'] if c['display_name']=='Claude'))+'|'+str(sum(1 for p in d['proposals'] if p['id']=='$PROP')))")"
check "anon cannot read the hub" 42501 "$(as_user_state $A anon "select hub_overview()")"

echo "-- S03: a proposal stays a proposal until Save"
check "classify to Mentioned is advisory and writes no decision" "mentioned|$active_before" "$(as_user $A $AUTH "select proposal_classify('$PROP',1,'mentioned')" | jget segment)|$(q -c "select count(*) from decision_version where owner_id='$A' and status='active'")"
check "a stale revision cannot classify" SOURCE_CHANGED "$(as_user $A $AUTH "select proposal_classify('$PROP',1,'decided')" | jget error)"
check "back to Decided" decided "$(as_user $A $AUTH "select proposal_classify('$PROP',2,'decided')" | jget segment)"
check "B cannot touch A's proposal" NOT_FOUND "$(as_user $B $AUTH "select proposal_classify('$PROP',3,'decided')" | jget error)"

echo "-- Save decision: statement and reason required, real ids, a receipt"
check "no statement is MISSING_DETAILS" '["statement"]' "$(as_user $A $AUTH "select decision_save('$PROJ','Flights','  ','because')" | jget missing)"
check "no reason is MISSING_DETAILS" '["rationale"]' "$(as_user $A $AUTH "select decision_save('$PROJ','Flights','Fly on the 12th','')" | jget missing)"
check "another owner's project is NOT_FOUND" NOT_FOUND "$(as_user $A $AUTH "select decision_save('$PROJ_B','Flights','Fly on the 12th','Cheaper')" | jget error)"
check "a dependency that is not the owner's is refused" 22023 "$(as_user_state $A $AUTH "select decision_save('$PROJ','Flights','Fly on the 12th','Cheaper','{}','[]','[{\"item_id\":\"$TASK_B\",\"kind\":\"depends_on\"}]')")"
check "...and nothing landed" "$active_before" "$(q -c "select count(*) from decision_version where owner_id='$A' and status='active'")"
S1=$(as_user $A $AUTH "select decision_save('$PROJ','Flights','Fly on the 12th','Cheaper and the roster is final by then','{\"Fly on the 10th\"}','[{\"key\":\"depart\",\"value\":\"2026-07-12\"}]','[{\"item_id\":\"$TASK\",\"kind\":\"depends_on\"}]','{}',null,'$PROP',3)")
D1=$(echo "$S1" | jget destination_id); V1=$(echo "$S1" | jget version_id)
check "saved from the proposal: confirmed, version 1, the exact verb" "confirmed|1|Saved Decision · Flights" "$(echo "$S1" | py "print(d['state']+'|'+str(d['version'])+'|'+d['safe_message'])")"
check "the item is a decision_record the Decisions module can read" "decision_record|Fly on the 12th|Cheaper and the roster is final by then" "$(q -c "select entity_type || '|' || (data->>'decision') || '|' || (data->>'why') from item where id='$D1'")"
check "...attached to the project the way the module writes it" "project|$PROJ" "$(q -c "select (data->'links'->0->>'type') || '|' || (data->'links'->0->>'id') from item where id='$D1'")"
check "the version is active with its constraints and alternatives" "active|depart|Fly on the 10th" "$(q -c "select status || '|' || (constraints->0->>'key') || '|' || alternatives[1] from decision_version where id='$V1'")"
check "the dependency is a real edge carrying the task's revision" "depends_on|current|true" "$(q -c "select kind || '|' || status || '|' || (expected_item_updated_at = (select updated_at from item where id='$TASK')) from decision_dependency where from_version_id='$V1'")"
check "the proposal closed as accepted" accepted "$(q -c "select status from proposal where id='$PROP'")"
check "the agent is credited, the person approved" "agent|$CONN|$A" "$(q -c "select actor_kind || '|' || actor_id || '|' || (authorization_snapshot->>'approved_by') from action where id='$(echo "$S1" | jget action_id)'")"
check "saving the same proposal again replays" "True|$D1" "$(as_user $A $AUTH "select decision_save('$PROJ','Flights','Fly on the 12th','Cheaper','{}','[]','[]','{}',null,'$PROP',3)" | py "print(str(d['replay'])+'|'+d['destination_id'])")"
check "the active set grew by exactly one" $((active_before + 1)) "$(q -c "select count(*) from decision_version where owner_id='$A' and status='active'")"

echo "-- conflicts: named, blocking, and Replace supersedes in one transaction"
C1=$(as_user $A $AUTH "select decision_save('$PROJ','Budget','Cap the trip at \$3,000','Flights went up','{}','[{\"key\":\"trip_budget_usd\",\"value\":\"3000\"}]')")
check "a conflicting constraint is refused and named" "DESTINATION_CHANGED|conflict|Trip budget" "$(echo "$C1" | py "print(d['error']+'|'+d['detail']+'|'+d['conflicts'][0]['title'])")"
check "...with both values" "2400|3000" "$(echo "$C1" | py "c=d['conflicts'][0]; print(c['theirs']+'|'+c['mine'])")"
check "nothing landed" $((active_before + 1)) "$(q -c "select count(*) from decision_version where owner_id='$A' and status='active'")"
OLDV=$(q -c "select id from decision_version where item_id='$DEC' and status='active'")
R1=$(as_user $A $AUTH "select decision_save('$PROJ','Trip budget','Cap the trip at \$3,000','Flights went up','{}','[{\"key\":\"trip_budget_usd\",\"value\":\"3000\"}]','[]','{}',null,null,null,'$DEC')")
V2=$(echo "$R1" | jget version_id)
check "Replace: a new version, the old superseded, one receipt" "confirmed|2|$OLDV|Replaced Decision · Trip budget" "$(echo "$R1" | py "print(d['state']+'|'+str(d['version'])+'|'+d['superseded_version_id']+'|'+d['safe_message'])")"
check "history keeps the earlier statement and reason" "superseded|Cap the trip at \$2,400|That is what is saved" "$(q -c "select status || '|' || statement || '|' || rationale from decision_version where id='$OLDV'")"
check "the new version points back" "$OLDV|active" "$(q -c "select supersedes_version_id || '|' || status from decision_version where id='$V2'")"
check "one active version per decision" 1 "$(q -c "select count(*) from decision_version where item_id='$DEC' and status='active'")"
check "the item the Decisions module reads moved with it" "Cap the trip at \$3,000" "$(q -c "select data->>'decision' from item where id='$DEC'")"
check "the receipt's diff shows old and new" "Cap the trip at \$2,400|Cap the trip at \$3,000" "$(q -c "select (diff->0->>'before') || '|' || (diff->0->>'after') from receipt_event where action_id='$(echo "$R1" | jget action_id)'")"

echo "-- cycles"
C2=$(as_user $A $AUTH "select decision_save('$PROJ','Trip budget','Cap the trip at \$3,100','Round up','{}','[{\"key\":\"trip_budget_usd\",\"value\":\"3100\"}]','[{\"item_id\":\"$D1\",\"kind\":\"depends_on\"},{\"item_id\":\"$TASK\",\"kind\":\"informed_by\"}]','{}',null,null,null,'$DEC')")
check "budget may depend on flights" confirmed "$(echo "$C2" | jget state)"
C3=$(as_user $A $AUTH "select decision_save('$PROJ','Flights','Fly on the 13th','Budget first','{}','[{\"key\":\"depart\",\"value\":\"2026-07-13\"}]','[{\"item_id\":\"$DEC\",\"kind\":\"depends_on\"}]','{}',null,null,null,'$D1')")
check "...but flights may not then depend on budget: a cycle is refused" "INVALID_PAYLOAD|cycle" "$(echo "$C3" | py "print(d['error']+'|'+d['detail'])")"
check "informed_by is not a cycle" confirmed "$(as_user $A $AUTH "select decision_save('$PROJ','Flights','Fly on the 13th','Budget first','{}','[{\"key\":\"depart\",\"value\":\"2026-07-13\"}]','[{\"item_id\":\"$DEC\",\"kind\":\"informed_by\"}]','{}',null,null,null,'$D1')" | jget state)"

echo "-- S12: a dependency that changed suggests, never rewrites"
# The budget (DEC) depends on Flights (D1), and Flights was just replaced: that is a real change to review.
CK0=$(as_user $A $AUTH "select decision_dependencies_check()")
check "a replaced decision is a change its dependants review" 1 "$(echo "$CK0" | jget suggested)"
check "...said in words" "Flights Changed · Review 1 Dependent Decision" "$(q -c "select exact_verb from receipt_event r join action a on a.id=r.action_id where a.kind='dependency_changed' and a.owner_id='$A' order by r.occurred_at desc limit 1")"
check "nothing more to suggest" 0 "$(as_user $A $AUTH "select decision_dependencies_check()" | jget suggested)"
q -c "update item set data = data || '{\"text\":\"Review transcript (moved)\"}' where id='$TASK'" >/dev/null
stmt_before=$(q -c "select statement from decision_version where item_id='$DEC' and status='active'")
CK=$(as_user $A $AUTH "select decision_dependencies_check()")
check "one suggestion for the changed task" 1 "$(echo "$CK" | jget suggested)"
check "it is a constraint_change proposal by the system, in Decided" "constraint_change|system|decided" "$(q -c "select type || '|' || created_by || '|' || (payload->>'segment') from proposal where owner_id='$A' and type='constraint_change' order by created_at desc limit 1")"
check "the dependency is marked changed, the decision untouched" "changed|$stmt_before" "$(q -c "select d.status from decision_dependency d join decision_version v on v.id=d.from_version_id where d.to_item_id='$TASK' and v.status='active' limit 1")|$(q -c "select statement from decision_version where item_id='$DEC' and status='active'")"
check "Activity says so in words" "Review transcript (moved) Changed · Review 1 Dependent Decision" "$(q -c "select exact_verb from receipt_event r join action a on a.id=r.action_id where a.kind='dependency_changed' and a.owner_id='$A' order by r.occurred_at desc limit 1")"
check "the hub marks the decision Needs review" True "$(as_user $A $AUTH "select hub_overview()" | py "print([x['needs_review'] for x in d['decisions'] if x['item_id']=='$DEC'][0])")"
check "running it again adds nothing" 0 "$(as_user $A $AUTH "select decision_dependencies_check()" | jget suggested)"
SUG=$(q -c "select id || '|' || revision from proposal where owner_id='$A' and type='constraint_change' and payload->>'item_id'='$TASK' order by created_at desc limit 1")
check "dismissing the suggestion records the reviewed revision" "dismissed|current" "$(as_user $A $AUTH "select proposal_dismiss('${SUG%%|*}',${SUG##*|})" | jget status)|$(q -c "select d.status from decision_dependency d join decision_version v on v.id=d.from_version_id where d.to_item_id='$TASK' and v.status='active' limit 1")"
q -c "update item set data = data || '{\"text\":\"Review transcript (moved again)\"}' where id='$TASK'" >/dev/null
check "a later change suggests again" 1 "$(as_user $A $AUTH "select decision_dependencies_check()" | jget suggested)"

echo "-- withdraw: a reason, a status, history and downstream kept"
IUA=$(q -c "select updated_at from item where id='$D1'")
VA=$(q -c "select id from decision_version where item_id='$D1' and status='active'")
check "no reason is MISSING_DETAILS" '["reason"]' "$(as_user $A $AUTH "select decision_withdraw('$VA','$IUA','  ')" | jget missing)"
check "a stale item revision is DESTINATION_CHANGED" DESTINATION_CHANGED "$(as_user $A $AUTH "select decision_withdraw('$VA','2020-01-01T00:00:00Z','Plans changed')" | jget error)"
W1=$(as_user $A $AUTH "select decision_withdraw('$VA','$IUA','Plans changed')")
check "withdrawn with the verb" "confirmed|Withdrew Decision · Flights" "$(echo "$W1" | py "print(d['state']+'|'+d['safe_message'])")"
check "the version is withdrawn with its reason; nothing erased" "withdrawn|Plans changed|Fly on the 13th" "$(q -c "select status || '|' || withdrawal_reason || '|' || statement from decision_version where id='$VA'")"
check "the item stays, marked" "Plans changed" "$(q -c "select data->>'withdrawnReason' from item where id='$D1'")"
check "the task it depended on is untouched" 1 "$(q -c "select count(*) from item where id='$TASK'")"
check "withdraw again replays" True "$(as_user $A $AUTH "select decision_withdraw('$VA','$IUA','Plans changed')" | jget replay)"
check "history reads every version with its state" "withdrawn,superseded" "$(as_user $A $AUTH "select decision_history('$D1')" | py "print(','.join(v['status'] for v in d['versions']))")"
check "B cannot read A's history" NOT_FOUND "$(as_user $B $AUTH "select decision_history('$D1')" | jget error)"

echo "-- S11: Keep as note is exploration, not a decision"
K1=$(as_user $A $AUTH "select exploration_keep('$PROJ','Explore a second summer team')")
NOTE=$(echo "$K1" | jget destination_id)
check "kept with the verb" "confirmed|Kept as Note · Explore a second summer team" "$(echo "$K1" | py "print(d['state']+'|'+d['safe_message'])")"
check "it is an exploration_note item attached to the project" "exploration_note|$PROJ" "$(q -c "select entity_type || '|' || (data->>'projectId') from item where id='$NOTE'")"
check "no decision version exists for it" 0 "$(q -c "select count(*) from decision_version where item_id='$NOTE'")"
check "the active-constraint read never returns it" 0 "$(q -c "select count(*) from decision_version v join item i on i.id=v.item_id where i.entity_type='exploration_note'")"
check "the hub lists it under notes, not decisions" "1|0" "$(as_user $A $AUTH "select hub_overview()" | py "print(str(sum(1 for n in d['exploration_notes'] if n['id']=='$NOTE'))+'|'+str(sum(1 for x in d['decisions'] if x['item_id']=='$NOTE')))")"

echo "-- setMode is not a grant; add a manual assistant"
grants_before=$(q -c "select count(*) from scope_grant where agent_id='$CONN'")
M1=$(as_user $A $AUTH "select connection_set_mode('$CONN',(select revision from agent_connection where id='$CONN'),'read_only')")
check "mode set, capabilities say what the ceiling allows" "read_only" "$(echo "$M1" | jget mode)"
check "...propose is unavailable under read only" MODE_CEILING "$(echo "$M1" | py "print([u['reason'] for u in d['unavailable'] if u['capability']=='propose'][0])")"
check "no grant was created by a mode change" "$grants_before" "$(q -c "select count(*) from scope_grant where agent_id='$CONN'")"
check "a stale revision is SOURCE_CHANGED" SOURCE_CHANGED "$(as_user $A $AUTH "select connection_set_mode('$CONN',1,'help_me')" | jget error)"
check "B cannot set A's mode" NOT_FOUND "$(as_user $B $AUTH "select connection_set_mode('$CONN',9,'help_me')" | jget error)"
AD=$(as_user $A $AUTH "select connection_add_manual('ChatGPT')")
check "a manual assistant is manual: no transport, no token" "manual|manual|0" "$(q -c "select status || '|' || transport || '|' || (select count(*) from jarvis_private.agent_credential where connection_id='$(echo "$AD" | jget connection_id)') from agent_connection where id='$(echo "$AD" | jget connection_id)'")"
check "an empty name is MISSING_DETAILS" '["name"]' "$(as_user $A $AUTH "select connection_add_manual('  ')" | jget missing)"

echo "-- a job is the boundary: one per assistant and project, the person's own without one"
J1=$(as_user $A $AUTH "select job_open('$(echo "$AD" | jget connection_id)','$PROJ','Plan the trip')")
check "opened" True "$(echo "$J1" | jget created)"
check "opened again is the same job" "False|$(echo "$J1" | jget job_id)" "$(as_user $A $AUTH "select job_open('$(echo "$AD" | jget connection_id)','$PROJ')" | py "print(str(d['created'])+'|'+d['job_id'])")"
check "the person's own job for a manual export" True "$(as_user $A $AUTH "select job_open(null,'$PROJ','Export')" | jget created)"
check "another owner's project is NOT_FOUND" NOT_FOUND "$(as_user $A $AUTH "select job_open(null,'$PROJ_B')" | jget error)"
check "a revoked or foreign connection is NOT_FOUND" NOT_FOUND "$(as_user $B $AUTH "select job_open('$CONN','$PROJ_B')" | jget error)"
check "the job carries the project, so a preview is scoped to it" 1 "$(as_user $A $AUTH "select context_preview('$(echo "$J1" | jget job_id)')" | py "print(sum(1 for m in d['manifest'] if m['resource_id']=='$PROJ'))")"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "SOME CHECKS FAILED"; exit 1; }
