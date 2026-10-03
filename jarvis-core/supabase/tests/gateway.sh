#!/usr/bin/env bash
# Real-Postgres proof for migration 0045 (authorization, scoped context and
# the agent gateway, slice 02). Runs on the same stubbed Supabase as
# substrate.sh, with 0044's fixtures, and drives the functions the way the
# gateway (service role, verified token) and the person (session) do.
#
# Usage: eval "$(./local_pg.sh start)"; ./gateway.sh
#
# What it proves (IMPLEMENTATION-SPEC.md sections 04, 05, 15):
#   S02  a read-only agent cannot propose or draft; nothing is stored
#   S04  a Just handle it agent cannot commit or send: no such function exists
#   S05  a project-scoped agent requesting another id gets no title and no count
#   S06  a permitted read returns only manifest fields, after a receipt, under caps
#   S07  revocation moves the epoch and blocks every later disclosure and proposal
#   S20  an unverified capability is refused
#   S21  authority fields in a payload are refused whole
#   S22  an expired or stale package is refused; the hash must match the source
#   S23  the switch is read from current state (profile and admin), every call
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=gateway_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
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

echo "-- forward: stub + chain 0001..0045, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
echo "-- rollback 0045, forward again (idempotent)"
q -f "$here/../rollback/0045_authorization_and_gateway_down.sql" >/dev/null
check "rollback removes the gateway functions" 0 "$(q -c "select count(*) from pg_proc where proname in ('context_issue','proposal_submit','agent_resolve_token')")"
q -f "$here/../migrations/0045_authorization_and_gateway.sql" >/dev/null
q -f "$here/../migrations/0045_authorization_and_gateway.sql" >/dev/null
check "forward again is idempotent" 3 "$(q -c "select count(*) from pg_proc where proname in ('context_issue','proposal_submit','agent_resolve_token')")"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
CONN=50000000-0000-0000-0000-00000000000a
JOB=a0000000-0000-0000-0000-00000000000a
PROJ=10000000-0000-0000-0000-00000000000a
B_TASK=20000000-0000-0000-0000-00000000000b
ACCT=60000000-0000-0000-0000-00000000000a
MSG=70000000-0000-0000-0000-00000000000a
SVC=service_role
# A task and a decision attached to A's project, so the brief has three kinds.
q -c "insert into item (id, owner_id, entity_type, data) values ('20000000-0000-0000-0000-0000000000a9','$A','task','{\"text\":\"Book flights\",\"category\":\"\",\"done\":false,\"projectId\":\"$PROJ\",\"due\":\"2026-10-20\"}')" >/dev/null
q -c "update item set data = data || '{\"links\":[{\"type\":\"project\",\"id\":\"$PROJ\",\"label\":\"Summer travel\"}]}' where id='40000000-0000-0000-0000-00000000000a'" >/dev/null

echo "-- identity: tokens resolve by hash, the token itself is never stored"
check "verify a connection with a token hash" connected "$(as_user $A $SVC "select agent_connection_verify('$A','$CONN','tok-hash-1','{read_context,propose}','sub-a')" | jget status)"
check "the private row holds the hash only" tok-hash-1 "$(q -c "select token_hash from jarvis_private.agent_credential where connection_id='$CONN'")"
check "resolve a known hash" "$CONN" "$(as_user $A $SVC "select agent_resolve_token('tok-hash-1')" | jget connection_id)"
check "an unknown hash resolves to nothing" "" "$(as_user $A $SVC "select agent_resolve_token('nope')")"
check "the browser cannot resolve tokens" 42501 "$(as_user_state $A authenticated "select agent_resolve_token('tok-hash-1')")"
check "the browser cannot verify a connection" 42501 "$(as_user_state $A authenticated "select agent_connection_verify('$A','$CONN','x','{read_context}')")"
check "rate: the bucket admits a call" t "$(as_user $A $SVC "select agent_rate_take('$CONN')")"
check "rate: 60 more in the same minute are refused at the end" f "$(as_user $A $SVC "select bool_and(agent_rate_take('$CONN')) from generate_series(1,60)")"

echo "-- capabilities are what the server verified, under the mode's ceiling"
check "capabilities list read_context and propose" '["read_context", "propose"]' "$(as_user $A $SVC "select agent_capabilities('$A','$CONN')" | jget capabilities)"
check "write_inert_draft is unavailable: unverified" CAPABILITY_UNVERIFIED "$(as_user $A $SVC "select agent_capabilities('$A','$CONN')" | jget unavailable.0.reason)"
q -c "update agent_connection set mode='read_only' where id='$CONN'" >/dev/null
check "read only: propose is unavailable by the mode's ceiling" MODE_CEILING "$(as_user $A $SVC "select agent_capabilities('$A','$CONN')" | python3 -c "import json,sys; d=json.load(sys.stdin); print([u['reason'] for u in d['unavailable'] if u['capability']=='propose'][0])")"
q -c "update agent_connection set mode='help_me' where id='$CONN'" >/dev/null

echo "-- S06: the preview is the project brief and nothing else"
P=$(as_user $A authenticated "select context_preview('$JOB')")
check "the owner's preview holds the project, its task and its decision" 3 "$(echo "$P" | jget record_count)"
check "fields are the allowed ones only" '["due", "status", "title"]' "$(echo "$P" | jget manifest.0.fields)"
check "the preview carries no data, only the manifest" "" "$(echo "$P" | jget data)"
HASH=$(echo "$P" | jget manifest_hash)
check "a requested field outside the allowed set is a redaction, not a leak" '["email"]' "$(as_user $A authenticated "select context_preview('$JOB','{}','{email,title}')" | jget redactions)"
check "the agent's preview says a grant is still needed" True "$(as_user $A $SVC "select context_preview('$JOB','{}','{}',null,'$A','$CONN')" | jget requires_user_grant)"
check "the agent's preview never carries the unauthorized count" "" "$(as_user $A $SVC "select context_preview('$JOB','{}','{}',null,'$A','$CONN')" | jget omitted_counts.unauthorized)"

echo "-- S05: another project's id or another owner's id: counted for the owner, never named, never returned"
PX=$(as_user $A authenticated "select context_preview('$JOB','{$B_TASK,$PROJ}')")
check "the owner sees one record and one unauthorized" 1 "$(echo "$PX" | jget record_count)"
check "...counted" 1 "$(echo "$PX" | jget omitted_counts.unauthorized)"
check "...and B's task id is not in the manifest" "" "$(echo "$PX" | python3 -c "import json,sys; d=json.load(sys.stdin); print(''.join(m['resource_id'] for m in d['manifest'] if m['resource_id']=='$B_TASK'))")"
check "B cannot preview A's job" SCOPE_DENIED "$(as_user $B authenticated "select context_preview('$JOB')" | jget error)"
check "a forged owner on a real connection is denied" SCOPE_DENIED "$(as_user $A $SVC "select context_preview('$JOB','{}','{}',null,'$B','$CONN')" | jget error)"

echo "-- the grant is the exact preview"
check "issue before any grant is denied" SCOPE_DENIED "$(as_user $A $SVC "select context_issue('$JOB','$HASH','{}','{}',null,'$A','$CONN')" | jget error)"
check "a grant with a hash that is not the preview's is stale" STALE_SCOPE "$(as_user $A authenticated "select scope_grant_create('$JOB','0000','once')" | jget error)"
check "B cannot grant on A's job" SCOPE_DENIED "$(as_user $B authenticated "select scope_grant_create('$JOB','$HASH','once')" | jget error)"
check "the browser cannot write a grant row directly" 42501 "$(as_user_state $A authenticated "insert into scope_grant (agent_id, project_id, manifest_hash, approved_by) values ('$CONN','$PROJ','$HASH','$A')")"
G=$(as_user $A authenticated "select scope_grant_create('$JOB','$HASH','once')")
check "the owner grants the exact preview, once" 3 "$(echo "$G" | jget record_count)"
check "a once grant expires" "" "$(q -c "select case when expires_at is null then 'never' else '' end from scope_grant where id='$(echo "$G" | jget grant_id)'")"
check "the agent's preview now needs no grant" False "$(as_user $A $SVC "select context_preview('$JOB','{}','{}',null,'$A','$CONN')" | jget requires_user_grant)"

echo "-- S06: issue writes the disclosure receipt in the same transaction and returns manifest fields only"
R0=$(q -c "select count(*) from receipt_event where owner_id='$A'")
I=$(as_user $A $SVC "select context_issue('$JOB','$HASH','{}','{}',null,'$A','$CONN')")
PKG=$(echo "$I" | jget package_id)
check "a package came back" 36 "${#PKG}"
check "the data holds the project's title and status" '{"title": "Summer travel", "status": "active"}' "$(echo "$I" | jget data.$PROJ)"
check "the data holds no field outside the manifest" "" "$(echo "$I" | python3 -c "import json,sys; d=json.load(sys.stdin); print(''.join(k for v in d['data'].values() for k in v if k not in ('title','status','due','text','done','projectId','decision','why','statement','rationale')))")"
check "one receipt was appended" $((R0+1)) "$(q -c "select count(*) from receipt_event where owner_id='$A'")"
check "and it names the read exactly" "Read 3 records in Summer travel" "$(q -c "select exact_verb from receipt_event where owner_id='$A' order by created_at desc limit 1")"
check "credited to the agent, initiated by the owner" "agent|$A" "$(q -c "select actor_kind||'|'||initiated_by_user_id from receipt_event where owner_id='$A' order by created_at desc limit 1")"
check "the package is active with the connection's epoch" "active|1" "$(q -c "select status||'|'||auth_epoch from context_package where id='$PKG'")"
check "the package is capped at 50 records" t "$(q -c "select record_count <= 50 and content_bytes <= 32768 from context_package where id='$PKG'")"
check "the snapshot store takes ciphertext only from the server" 42501 "$(as_user_state $A authenticated "select context_snapshot_store('$A','$PKG','cipher')")"
check "the server stores the snapshot" t "$(as_user $A $SVC "select context_snapshot_store('$A','$PKG','cipher')")"
check "the browser cannot read the snapshot" 42501 "$(as_user_state $A authenticated "select count(*) from jarvis_private.context_snapshot")"

echo "-- caps: records beyond 50 or 32KB are counted, not silently dropped"
q -c "insert into item (owner_id, entity_type, data) select '$A','task', jsonb_build_object('text','Task '||g,'category','','done',false,'projectId','$PROJ') from generate_series(1,60) g" >/dev/null
PC=$(as_user $A authenticated "select context_preview('$JOB')")
check "50 records kept" 50 "$(echo "$PC" | jget record_count)"
check "13 counted as over the limit" 13 "$(echo "$PC" | jget omitted_counts.over_limit)"
echo "-- S22: the source moved, so the old hash is stale for issue and for grant"
check "issue with the pre-change hash is stale" STALE_SCOPE "$(as_user $A $SVC "select context_issue('$JOB','$HASH','{}','{}',null,'$A','$CONN')" | jget error)"
q -c "delete from item where owner_id='$A' and entity_type='task' and data->>'text' like 'Task %'" >/dev/null

echo "-- S02 / S21: proposals"
check "a proposal lands" proposed "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"Fly on the 12th\",\"rationale\":\"Cheapest\"}','{$PROJ}','k1')" | jget status)"
check "its receipt says what it is, no payload" "Suggested a decision" "$(q -c "select exact_verb from receipt_event where owner_id='$A' order by created_at desc limit 1")"
check "a replay returns the same proposal" True "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"Fly on the 12th\",\"rationale\":\"Cheapest\"}','{$PROJ}','k1')" | jget replay)"
check "the same key with another payload conflicts" IDEMPOTENCY_CONFLICT "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"Other\"}','{}','k1')" | jget error)"
check "approved_by in a payload is refused whole" INVALID_PAYLOAD "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"x\",\"approved_by\":\"$A\"}','{}','k2')" | jget error)"
check "execute=true in a payload is refused whole" INVALID_PAYLOAD "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"x\",\"execute\":true}','{}','k3')" | jget error)"
check "status in a payload is refused whole" INVALID_PAYLOAD "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"x\",\"status\":\"accepted\"}','{}','k4')" | jget error)"
check "evidence from outside the package is refused" INVALID_PAYLOAD "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"x\"}','{$B_TASK}','k5')" | jget error)"
check "nothing was stored for the refusals (the fixture's one plus k1)" 2 "$(q -c "select count(*) from proposal where owner_id='$A' and created_by='agent'")"
check "an email capture on a project package is denied" SCOPE_DENIED "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','email','capture','{\"kind\":\"task\",\"message_id\":\"$MSG\",\"title\":\"x\"}','{}','k6')" | jget error)"
q -c "update agent_connection set mode='read_only' where id='$CONN'" >/dev/null
check "S02: a read-only agent cannot propose" SCOPE_DENIED "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"x\"}','{}','k7')" | jget error)"
check "S02: a read-only agent can still read what it was granted" "$PKG" "$(q -c "select id from context_package where id='$PKG' and status='active'")"
q -c "update agent_connection set mode='just_handle_it' where id='$CONN'" >/dev/null
check "S04: Just handle it has no function that commits or sends" 0 "$(q -c "select count(*) from pg_proc where proname in ('approve_candidate','send_approved','approve_and_execute','substrate_commit')")"
check "S04: Just handle it still cannot write a saved candidate" 23514 "$(as_user_state $A $SVC "insert into email_candidate (owner_id, account_id, message_id, source_hash, extractor_version, kind, origin, agent_id, payload, payload_hash, fingerprint, status, destination_id) values ('$A','$ACCT','$MSG','h','agent:x','bill','agent','$CONN','{}','ph','fp-jhi','saved','20000000-0000-0000-0000-0000000000a9')")"
q -c "update agent_connection set mode='help_me' where id='$CONN'" >/dev/null

echo "-- an Email job: the message in scope, the account in scope, an inert draft"
EJOB=$(q -c "insert into job (owner_id, agent_id, resource_ids, purpose, created_by) values ('$A','$CONN','{$ACCT,$MSG}','Reply to the coach','$A') returning id")
EP=$(as_user $A authenticated "select context_preview('$EJOB')")
check "the email job previews the one message" 1 "$(echo "$EP" | jget record_count)"
EH=$(echo "$EP" | jget manifest_hash)
as_user $A authenticated "select scope_grant_create('$EJOB','$EH','once')" >/dev/null
EI=$(as_user $A $SVC "select context_issue('$EJOB','$EH','{}','{}',null,'$A','$CONN')")
EPKG=$(echo "$EI" | jget package_id)
check "the message's sanitized body is in the data" "Amount due \$142.30 by Oct 15." "$(echo "$EI" | jget data.$MSG.body)"
check "a draft needs the verified capability" CAPABILITY_UNVERIFIED "$(as_user $A $SVC "select draft_submit('$A','$CONN','$EPKG','{\"account_id\":\"$ACCT\",\"to\":[\"coach@example.test\"],\"subject\":\"Re\",\"body_text\":\"On it.\"}')" | jget error)"
as_user $A $SVC "select agent_connection_verify('$A','$CONN','tok-hash-1','{read_context,propose,write_inert_draft}','sub-a')" >/dev/null
D=$(as_user $A $SVC "select draft_submit('$A','$CONN','$EPKG','{\"account_id\":\"$ACCT\",\"to\":[\"coach@example.test\"],\"subject\":\"Re\",\"body_text\":\"On it.\"}')")
DID=$(echo "$D" | jget draft_id)
check "an inert draft lands" 36 "${#DID}"
check "it is a draft, never sending" draft "$(q -c "select send_state from email_draft where id='$(echo "$D" | jget draft_id)'")"
check "its receipt is the inert verb" "Saved reply draft" "$(q -c "select exact_verb from receipt_event where owner_id='$A' order by created_at desc limit 1")"
check "a draft on an account outside the job is denied" SCOPE_DENIED "$(as_user $A $SVC "select draft_submit('$A','$CONN','$EPKG','{\"account_id\":\"60000000-0000-0000-0000-00000000000b\",\"to\":[\"x@example.test\"]}')" | jget error)"
check "a draft with 21 recipients is refused" INVALID_PAYLOAD "$(as_user $A $SVC "select draft_submit('$A','$CONN','$EPKG', jsonb_build_object('account_id','$ACCT','to', (select jsonb_agg('r'||g||'@example.test') from generate_series(1,21) g)))" | jget error)"
EC=$(as_user $A $SVC "select proposal_submit('$A','$CONN','$EPKG','email','capture','{\"kind\":\"task\",\"message_id\":\"$MSG\",\"title\":\"Review the transcript\",\"due_date\":null,\"notes\":\"\"}','{$MSG}','ke1')")
check "an email capture becomes a provisional candidate, origin agent" "agent|proposed" "$(q -c "select origin||'|'||status from email_candidate where id='$(echo "$EC" | jget candidate_id)'")"
check "the proposal itself carries no payload" "" "$(q -c "select coalesce(payload::text,'') from proposal where id='$(echo "$EC" | jget proposal_id)'")"
check "its receipt names no field" "Suggested an email item" "$(q -c "select exact_verb from receipt_event where owner_id='$A' order by created_at desc limit 1")"
check "review.link names the proposal's internal path" "/hub/review/$(q -c "select id from proposal where owner_id='$A' and idempotency_key='k1'")" "$(as_user $A $SVC "select review_link('$A','$CONN','$(q -c "select id from proposal where owner_id='$A' and idempotency_key='k1'")')" | jget path)"
check "review.link for another agent's proposal is denied" SCOPE_DENIED "$(as_user $A $SVC "select review_link('$A','$CONN','d0000000-0000-0000-0000-00000000000b')" | jget error)"
check "an agent can ask after its own action" confirmed "$(as_user $A $SVC "select action_status('$A','$CONN','$(q -c "select id from action where owner_id='$A' and actor_id='$CONN' order by created_at desc limit 1")')" | jget state)"
check "but not after the owner's" SCOPE_DENIED "$(as_user $A $SVC "select action_status('$A','$CONN','e0000000-0000-0000-0000-00000000000a')" | jget error)"

echo "-- S23: the switch is current state, read every call"
q -c "insert into item (owner_id, entity_type, data) values ('$A','profile','{\"ai\":{\"level\":\"off\"}}')" >/dev/null
check "AI off: no preview" AI_DISABLED "$(as_user $A $SVC "select context_preview('$JOB','{}','{}',null,'$A','$CONN')" | jget error)"
check "AI off: no proposal" AI_DISABLED "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"x\"}','{}','k8')" | jget error)"
check "AI off: the owner's own preview still works (manual export)" 3 "$(as_user $A authenticated "select context_preview('$JOB')" | jget record_count)"
q -c "delete from item where owner_id='$A' and entity_type='profile'" >/dev/null
q -c "update auth.users set raw_app_meta_data='{\"ai_allowed\":false}' where id='$A'" >/dev/null
check "admin off: no preview" ADMIN_AI_DISABLED "$(as_user $A $SVC "select context_preview('$JOB','{}','{}',null,'$A','$CONN')" | jget error)"
q -c "update auth.users set raw_app_meta_data='{}' where id='$A'" >/dev/null

echo "-- S22: an expired package is refused"
q -c "update context_package set expires_at = now() - interval '1 second' where id='$PKG'" >/dev/null
check "a proposal on an expired package" PACKAGE_EXPIRED "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$PKG','project','decision','{\"statement\":\"x\"}','{}','k9')" | jget error)"
check "the sweep marks it expired" 1 "$(as_user $A $SVC "select context_packages_sweep()" | jget expired)"

echo "-- manual export and import"
X=$(as_user $A authenticated "select context_issue('$JOB','$(as_user $A authenticated "select context_preview('$JOB')" | jget manifest_hash)')")
check "the owner exports the brief without any agent" 3 "$(echo "$X" | jget manifest | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
check "the export receipt says Exported" "Exported 3 records in Summer travel" "$(q -c "select exact_verb from receipt_event where owner_id='$A' order by created_at desc limit 1")"
check "import: prose lands as Mentioned" mentioned "$(as_user $A authenticated "select proposals_import('$JOB','[{\"statement\":\"Maybe fly on the 12th\"}]','prose')" | jget proposal_ids.0 | xargs -I{} psql -qAt -d $DB -c "select payload->>'classification' from proposal where id='{}'")"
check "import: a JSON item that says decided stays a proposal, not saved" "decided|proposed" "$(as_user $A authenticated "select proposals_import('$JOB','[{\"statement\":\"Fly on the 12th\",\"classification\":\"decided\"}]')" | jget proposal_ids.0 | xargs -I{} psql -qAt -d $DB -c "select (payload->>'classification')||'|'||status from proposal where id='{}'")"
check "import: an authority field refuses the whole file" IMPORT_INVALID "$(as_user $A authenticated "select proposals_import('$JOB','[{\"statement\":\"ok\"},{\"statement\":\"x\",\"approved_by\":\"me\"}]')" | jget error)"
check "import: nothing partial was stored" 0 "$(q -c "select count(*) from proposal where owner_id='$A' and payload->>'statement'='ok'")"
check "import: a file over 256KB is refused" IMPORT_INVALID "$(as_user $A authenticated "select proposals_import('$JOB', (select jsonb_agg(jsonb_build_object('statement', repeat('x', 400))) from generate_series(1,700)))" | jget error)"
check "import: B cannot import into A's job" SCOPE_DENIED "$(as_user $B authenticated "select proposals_import('$JOB','[{\"statement\":\"x\"}]')" | jget error)"

echo "-- S07: revocation"
check "B cannot revoke A's connection" SCOPE_DENIED "$(as_user $B authenticated "select connection_revoke('$CONN')" | jget error)"
RV=$(as_user $A authenticated "select connection_revoke('$CONN')")
check "the epoch moved" 2 "$(echo "$RV" | jget auth_epoch)"
check "the token is gone" 0 "$(q -c "select count(*) from jarvis_private.agent_credential where connection_id='$CONN'")"
check "no snapshot survives" 0 "$(q -c "select count(*) from jarvis_private.context_snapshot s join context_package p on p.id=s.package_id where p.agent_id='$CONN'")"
check "every package is revoked or expired" 0 "$(q -c "select count(*) from context_package where agent_id='$CONN' and status='active'")"
check "every grant is revoked" 0 "$(q -c "select count(*) from scope_grant where agent_id='$CONN' and revoked_at is null")"
check "a proposal on the old package is refused (the connection is gone first)" CONNECTION_REVOKED "$(as_user $A $SVC "select proposal_submit('$A','$CONN','$EPKG','email','capture','{\"kind\":\"task\",\"message_id\":\"$MSG\",\"title\":\"x\"}','{}','k10')" | jget error)"
check "the revoked connection cannot preview" CONNECTION_REVOKED "$(as_user $A $SVC "select context_preview('$JOB','{}','{}',null,'$A','$CONN')" | jget error)"
check "the revoked token no longer resolves" "" "$(as_user $A $SVC "select agent_resolve_token('tok-hash-1')")"
check "the receipt says so" "Revoked access · Claude" "$(q -c "select exact_verb from receipt_event where owner_id='$A' and action_id in (select id from action where kind='revoke_agent')")"
check "revoking twice is harmless" True "$(as_user $A authenticated "select connection_revoke('$CONN')" | jget already)"
check "the drafts the agent left are still the owner's, untouched" draft "$(q -c "select send_state from email_draft where id='$(echo "$D" | jget draft_id)'")"

echo "-- lockdown"
for fn in 'agent_capabilities(uuid,uuid)' 'review_link(uuid,uuid,uuid)' 'proposal_submit(uuid,uuid,uuid,text,text,jsonb,uuid[],text)' 'draft_submit(uuid,uuid,uuid,jsonb)' 'action_status(uuid,uuid,uuid)' 'context_snapshot_store(uuid,uuid,text)' 'context_packages_sweep()' 'jarvis_record(uuid,text,text,uuid,text,text,text,text,text,text,text,uuid[],uuid,uuid)' 'jarvis_ai_switch(uuid)'; do
  check "authenticated cannot call $fn" f "$(q -c "select has_function_privilege('authenticated','$fn','execute')")"
done
for fn in 'context_preview(uuid,uuid[],text[],text,uuid,uuid)' 'scope_grant_create(uuid,text,text,uuid[],text[],text)' 'connection_revoke(uuid)' 'proposals_import(uuid,jsonb,text)'; do
  check "anon cannot call $fn" f "$(q -c "select has_function_privilege('anon','$fn','execute')")"
done
exit $fail
