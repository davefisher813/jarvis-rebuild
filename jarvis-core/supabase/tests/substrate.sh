#!/usr/bin/env bash
# Real-Postgres proof for migration 0044 (the unified substrate, slice 01).
# Not a mock: the whole migration chain runs on a stubbed Supabase (see
# stub_supabase.sql), then the checks below run as the browser roles would,
# with auth.uid() set the way PostgREST sets it.
#
# Usage: eval "$(./local_pg.sh start)"; ./substrate.sh
# Needs a server this script may create and drop a scratch database on.
#
# What it proves:
#   1. the chain 0001..0044 applies forward on an empty database
#   2. rollback -> forward again leaves the same schema (rehearsal)
#   3. cross-user SELECT/INSERT/UPDATE/DELETE are denied on every table
#   4. a composite reference to another owner's row is refused
#   5. unique keys reject duplicates (action, candidate, message, receipt)
#   6. the browser cannot mark a candidate saved, write a receipt or an
#      approval, grant a capability, or set a bill candidate's destination to
#      a task
#   7. a candidate never appears in an item query (it is not an item)
#   8. old readers still work: item_apply_patch and the item policies behave
#      as before 0044
#   9. readiness answers from the registry; an unregistered kind reads as
#      unavailable, never as success
#  10. the private schema is unreachable from browser roles
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=substrate_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
# Run SQL as a browser session for one user, the way PostgREST does: the role
# is set and the JWT claims sit in request.jwt.claims for the session.
as_user() { # uid role sql -> the last line of output (a value, or the error)
  PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" \
    -c "set role $2" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" \
    -c "$3" 2>&1 | tail -1
}
# Same, but answers 'ok' or the five-character SQLSTATE of the failure.
as_user_state() { # uid role sql
  local out st
  if out=$(PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
      -c "set role $2" \
      -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" \
      -c "$3" 2>&1 >/dev/null); then
    echo ok; return
  fi
  st=$(echo "$out" | sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' | head -1)
  echo "${st:-fail}"
}
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi
}

echo "-- forward: stub + chain 0001..0044"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
schema_after_forward=$(q -c "select string_agg(table_schema||'.'||table_name||':'||column_name||':'||data_type, ',' order by table_schema, table_name, ordinal_position) from information_schema.columns where table_schema in ('public','jarvis_private')")

echo "-- rollback, then forward again"
q -f "$here/../rollback/0044_jarvis_unified_substrate_down.sql" >/dev/null
check "rollback removes the substrate tables" 0 "$(q -c "select count(*) from information_schema.tables where table_name in ('action','email_candidate','receipt_event','agent_connection')")"
check "rollback leaves item alone" 1 "$(q -c "select count(*) from information_schema.tables where table_name = 'item'")"
q -f "$here/../migrations/0044_jarvis_unified_substrate.sql" >/dev/null
check "forward again is idempotent (second run)" ok "$(q -f "$here/../migrations/0044_jarvis_unified_substrate.sql" >/dev/null 2>&1 && echo ok)"
schema_after_again=$(q -c "select string_agg(table_schema||'.'||table_name||':'||column_name||':'||data_type, ',' order by table_schema, table_name, ordinal_position) from information_schema.columns where table_schema in ('public','jarvis_private')")
check "schema identical after rollback and forward" "$schema_after_forward" "$schema_after_again"

echo "-- fixtures (test only)"
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b

echo "-- RLS: every substrate table is on, and the browser sees only its own rows"
for t in agent_connection scope_grant policy_suggestion job context_package proposal action receipt_event approval email_account email_message email_message_body source_evidence decision_version decision_dependency email_candidate email_draft; do
  check "rls on $t" t "$(q -c "select relrowsecurity from pg_class where relname='$t' and relnamespace='public'::regnamespace")"
  total=$(q -c "select count(*) from $t")
  a_sees=$(as_user $A authenticated "select count(*) from $t")
  b_sees=$(as_user $B authenticated "select count(*) from $t")
  a_mine=$(q -c "select count(*) from $t where owner_id='$A'")
  b_mine=$(q -c "select count(*) from $t where owner_id='$B'")
  check "$t: A reads only A's rows ($a_mine of $total)" "$a_mine" "$a_sees"
  check "$t: B reads only B's rows ($b_mine of $total)" "$b_mine" "$b_sees"
  check "$t: anon reads nothing" 42501 "$(as_user_state $A anon "select count(*) from $t")"
done

echo "-- cross-user writes are denied"
B_CONN=$(q -c "select id from agent_connection where owner_id='$B' limit 1")
B_CAND=$(q -c "select id from email_candidate where owner_id='$B' limit 1")
B_DRAFT=$(q -c "select id from email_draft where owner_id='$B' limit 1")
B_ACCT=$(q -c "select id from email_account where owner_id='$B' limit 1")
B_MSG=$(q -c "select id from email_message where owner_id='$B' limit 1")
check "A cannot update B's connection" 0 "$(as_user $A authenticated "with u as (update agent_connection set display_name='x' where id='$B_CONN' returning 1) select count(*) from u")"
check "A cannot delete B's candidate" 0 "$(as_user $A authenticated "with d as (delete from email_candidate where id='$B_CAND' returning 1) select count(*) from d")"
check "A cannot update B's draft" 0 "$(as_user $A authenticated "with u as (update email_draft set subject='x' where id='$B_DRAFT' returning 1) select count(*) from u")"
check "A cannot insert a row owned by B" 42501 "$(as_user_state $A authenticated "insert into agent_connection (owner_id, provider_key, display_name) values ('$B','manual','x')")"
check "A cannot insert a candidate on B's account (composite key)" 23503 "$(as_user_state $A authenticated "insert into email_candidate (account_id, message_id, source_hash, extractor_version, kind, origin, payload, payload_hash, fingerprint) values ('$B_ACCT','$B_MSG','h','v1','task','manual','{}','ph','fp-x')")"
check "A cannot insert a draft on B's account (composite key)" 23503 "$(as_user_state $A authenticated "insert into email_draft (account_id) values ('$B_ACCT')")"

echo "-- composite references: same owner only"
A_ACCT=$(q -c "select id from email_account where owner_id='$A' limit 1")
A_MSG=$(q -c "select id from email_message where owner_id='$A' limit 1")
A_TASK=$(q -c "select id from item where owner_id='$A' and entity_type='task' limit 1")
B_TASK=$(q -c "select id from item where owner_id='$B' and entity_type='task' limit 1")
A_CONN=$(q -c "select id from agent_connection where owner_id='$A' limit 1")
check "server cannot point A's candidate at B's message" 23503 "$(as_user_state $A service_role "insert into email_candidate (owner_id, account_id, message_id, source_hash, extractor_version, kind, payload, payload_hash, fingerprint) values ('$A','$A_ACCT','$B_MSG','h','v1','task','{}','ph','fp-cross')")"
check "server cannot grant A's agent B's project" 23503 "$(as_user_state $A service_role "insert into scope_grant (owner_id, agent_id, project_id, manifest_hash, approved_by) values ('$A','$A_CONN','$B_TASK','m','$A')")"
check "server cannot link A's action to B's item" 23503 "$(as_user_state $A service_role "insert into action (owner_id, kind, actor_kind, initiated_by_user_id, verb, surface, payload_hash, idempotency_key, destination_id) values ('$A','capture_task','user','$A','Added x','email','ph','idem-cross','$B_TASK')")"
check "server cannot attach B's job to A's agent" 23503 "$(as_user_state $A service_role "insert into job (owner_id, agent_id, project_id, purpose, created_by) values ('$B','$A_CONN','$B_TASK','x','$B')")"

echo "-- unique keys"
A_ACT=$(q -c "select id from action where owner_id='$A' limit 1")
A_IDEM=$(q -c "select idempotency_key from action where id='$A_ACT'")
check "second action with the same idempotency key is refused" 23505 "$(as_user_state $A service_role "insert into action (owner_id, kind, actor_kind, initiated_by_user_id, verb, surface, payload_hash, idempotency_key) values ('$A','capture_task','user','$A','Added x','email','ph','$A_IDEM')")"
check "second receipt with the same sequence is refused" 23505 "$(as_user_state $A service_role "insert into receipt_event (owner_id, action_id, sequence, state, exact_verb, actor_kind, assurance) values ('$A','$A_ACT',1,'confirmed','x','user','verified_jarvis')")"
A_CAND_FP=$(q -c "select fingerprint from email_candidate where owner_id='$A' and kind='bill' limit 1")
A_CAND_MSG=$(q -c "select message_id from email_candidate where owner_id='$A' and kind='bill' limit 1")
check "second candidate with the same fingerprint is refused" 23505 "$(as_user_state $A service_role "insert into email_candidate (owner_id, account_id, message_id, source_hash, extractor_version, kind, payload, payload_hash, fingerprint) values ('$A','$A_ACCT','$A_CAND_MSG','h','v1','bill','{}','ph','$A_CAND_FP')")"
A_PROV=$(q -c "select provider_id from email_message where id='$A_MSG'")
check "second message with the same provider id is refused" 23505 "$(as_user_state $A service_role "insert into email_message (owner_id, account_id, provider_id, thread_id, internal_date, source_hash) values ('$A','$A_ACCT','$A_PROV','t',now(),'h')")"
check "a wildcard scope grant is refused" 23514 "$(as_user_state $A service_role "insert into scope_grant (owner_id, agent_id, project_id, fields, manifest_hash, approved_by) values ('$A','$A_CONN','$A_TASK','{*}','m','$A')")"
check "an empty scope grant is refused" 23514 "$(as_user_state $A service_role "insert into scope_grant (owner_id, agent_id, manifest_hash, approved_by) values ('$A','$A_CONN','m','$A')")"
check "an execute capability does not exist" 23514 "$(as_user_state $A service_role "insert into agent_connection (owner_id, provider_key, display_name, verified_capabilities) values ('$A','x','x','{execute}')")"

echo "-- the browser's ceiling"
A_CAND=$(q -c "select id from email_candidate where owner_id='$A' and kind='bill' and status='proposed' limit 1")
check "browser can edit its own candidate payload" 1 "$(as_user $A authenticated "with u as (update email_candidate set payload = payload || '{\"issuer\":\"Edited\"}' where id='$A_CAND' returning 1) select count(*) from u")"
check "that edit moved the revision" 2 "$(q -c "select revision from email_candidate where id='$A_CAND'")"
check "browser can dismiss its own candidate" 1 "$(as_user $A authenticated "with u as (update email_candidate set status='dismissed' where id='$A_CAND' returning 1) select count(*) from u")"
check "browser can restore it" 1 "$(as_user $A authenticated "with u as (update email_candidate set status='proposed' where id='$A_CAND' returning 1) select count(*) from u")"
A_BILL_ITEM0=$(q -c "select id from item where owner_id='$A' and entity_type='money_bill' limit 1")
check "browser cannot mark a candidate saved" 42501 "$(as_user_state $A authenticated "update email_candidate set status='saved', destination_id='$A_BILL_ITEM0' where id='$A_CAND'")"
check "browser cannot set a destination" 42501 "$(as_user_state $A authenticated "update email_candidate set destination_id='$A_BILL_ITEM0' where id='$A_CAND'")"
check "browser cannot save a bill as a task either (kind wall)" 23514 "$(as_user_state $A authenticated "update email_candidate set status='saved', destination_id='$A_TASK' where id='$A_CAND'")"
check "browser cannot plant a rule candidate" 42501 "$(as_user_state $A authenticated "insert into email_candidate (account_id, message_id, source_hash, extractor_version, kind, origin, payload, payload_hash, fingerprint) values ('$A_ACCT','$A_MSG','h','v1','task','rule','{}','ph','fp-rule')")"
check "browser can capture manually" ok "$(as_user_state $A authenticated "insert into email_candidate (account_id, message_id, source_hash, extractor_version, kind, origin, payload, payload_hash, fingerprint) values ('$A_ACCT','$A_MSG','h','v1','task','manual','{\"title\":\"Call back\"}','ph','fp-manual')")"
check "browser cannot write a receipt" 42501 "$(as_user_state $A authenticated "insert into receipt_event (action_id, sequence, state, exact_verb, actor_kind, assurance) values ('$A_ACT',9,'confirmed','x','user','verified_jarvis')")"
check "browser cannot write an approval" 42501 "$(as_user_state $A authenticated "insert into approval (action_id, payload_hash, source_revision, expires_at, nonce) values ('$A_ACT','ph',1,now()+interval '5 minutes','n-browser')")"
check "browser cannot write an action" 42501 "$(as_user_state $A authenticated "insert into action (kind, actor_kind, initiated_by_user_id, verb, surface, payload_hash, idempotency_key) values ('capture_task','user','$A','x','email','ph','idem-browser')")"
check "browser cannot grant itself a capability" 42501 "$(as_user_state $A authenticated "update agent_connection set verified_capabilities='{read_context}' where id='$A_CONN'")"
check "browser cannot move an auth epoch" 42501 "$(as_user_state $A authenticated "update agent_connection set auth_epoch=2 where id='$A_CONN'")"
check "browser cannot connect a verified agent" 42501 "$(as_user_state $A authenticated "insert into agent_connection (provider_key, display_name, status, transport) values ('claude','Claude','connected','https')")"
check "browser can add a manual connection" ok "$(as_user_state $A authenticated "insert into agent_connection (provider_key, display_name) values ('manual','Pasted context')")"
check "browser can change its mode" 1 "$(as_user $A authenticated "with u as (update agent_connection set mode='help_me' where id='$A_CONN' returning 1) select count(*) from u")"
check "browser cannot write a scope grant" 42501 "$(as_user_state $A authenticated "insert into scope_grant (agent_id, project_id, manifest_hash, approved_by) values ('$A_CONN','$A_TASK','m','$A')")"
check "browser cannot write a context package" 42501 "$(as_user_state $A authenticated "insert into context_package (job_id, expires_at, auth_epoch, package_hash) select id, now()+interval '15 minutes', 1, 'h' from job where owner_id='$A' limit 1")"
check "browser cannot write a decision version" 42501 "$(as_user_state $A authenticated "insert into decision_version (item_id, version, title, statement, rationale, committed_by) values ('$A_TASK',1,'t','s','r','$A')")"
check "browser cannot read the private schema" 42501 "$(as_user_state $A authenticated "select count(*) from jarvis_private.email_credential")"
check "browser cannot read a credential through the account row" 0 "$(q -c "select count(*) from information_schema.columns where table_schema='public' and table_name='email_account' and column_name like '%credential%'")"
check "no token column in any public substrate table" 0 "$(q -c "select count(*) from information_schema.columns where table_schema='public' and table_name in ('agent_connection','email_account','email_message','email_draft','email_candidate','context_package') and (column_name like '%token%' or column_name like '%secret%')")"
check "browser can save a draft" ok "$(as_user_state $A authenticated "insert into email_draft (account_id, subject) values ('$A_ACCT','hello')")"
check "browser cannot mark a draft sent" 42501 "$(as_user_state $A authenticated "update email_draft set send_state='sent' where owner_id='$A' and subject='hello'")"

echo "-- destination kind is asserted in the database"
A_BILL_CAND=$(q -c "select id from email_candidate where owner_id='$A' and kind='bill' limit 1")
A_BILL_ITEM=$(q -c "select id from item where owner_id='$A' and entity_type='money_bill' limit 1")
check "server cannot save a bill candidate as a task" 23514 "$(as_user_state $A service_role "update email_candidate set status='saved', destination_id='$A_TASK' where id='$A_BILL_CAND'")"
check "server can save a bill candidate as a money_bill" ok "$(as_user_state $A service_role "update email_candidate set status='saved', destination_id='$A_BILL_ITEM' where id='$A_BILL_CAND'")"
check "browser cannot edit a saved candidate" 0 "$(as_user $A authenticated "with u as (update email_candidate set payload='{}' where id='$A_BILL_CAND' returning 1) select count(*) from u")"
check "browser cannot delete a saved candidate" 0 "$(as_user $A authenticated "with d as (delete from email_candidate where id='$A_BILL_CAND' returning 1) select count(*) from d")"
check "deleting the destination item leaves the candidate with a null destination" ok "$(as_user_state $A service_role "delete from item where id='$A_BILL_ITEM'")"
check "...and the candidate stays saved with no destination (Item removed)" 1 "$(q -c "select count(*) from email_candidate where id='$A_BILL_CAND' and status='saved' and destination_id is null")"
check "a provisional candidate can never carry a destination" 23514 "$(as_user_state $A service_role "update email_candidate set status='proposed', destination_id='$A_TASK' where id='$A_CAND'")"

echo "-- receipts are append-only"
check "server cannot rewrite a receipt's verb" 42501 "$(as_user_state $A service_role "update receipt_event set exact_verb='changed' where action_id='$A_ACT' and sequence=1")"
check "server can erase a receipt's payload (tombstone)" ok "$(as_user_state $A service_role "update receipt_event set diff='[]', scope_summary='', evidence_refs='{}', erased_at=now() where action_id='$A_ACT' and sequence=1")"
check "browser cannot delete a receipt" 42501 "$(as_user_state $A authenticated "delete from receipt_event where action_id='$A_ACT'")"

echo "-- candidates never enter item queries"
check "no candidate kind is an entity type" 0 "$(q -c "select count(*) from entity_type where key in ('email_candidate','candidate','email_message','email_draft')")"
check "item knows nothing about candidates" 0 "$(q -c "select count(*) from information_schema.columns where table_name='item' and column_name like '%candidate%'")"
check "A's item list is the same size it was before the substrate" "$(q -c "select count(*) from item where owner_id='$A'")" "$(as_user $A authenticated "select count(*) from item")"

echo "-- old readers still work"
check "item_apply_patch still merges for the owner" t "$(as_user $A authenticated "select item_apply_patch('$A_TASK', '{\"text\":\"renamed\"}')")"
check "item_apply_patch still refuses the other owner" f "$(as_user $B authenticated "select item_apply_patch('$A_TASK', '{\"text\":\"hacked\"}')")"
check "B still cannot read A's item" 0 "$(as_user $B authenticated "select count(*) from item where id='$A_TASK'")"
check "a decision item cascades its versions on delete" ok "$(as_user_state $A service_role "with v as (select item_id from decision_version where owner_id='$A' limit 1) delete from item where id in (select item_id from v)")"
check "no orphan versions" 0 "$(q -c "select count(*) from decision_version v where not exists (select 1 from item i where i.id=v.item_id)")"

echo "-- readiness"
check "readiness lists the registered kinds" '["decision_record", "event", "exploration_note", "money_bill", "money_receipt", "task", "waiting"]' "$(as_user $A authenticated "select substrate_readiness()->'registered'")"
check "anon cannot ask readiness" 42501 "$(as_user_state $A anon "select substrate_readiness()")"
q -c "delete from entity_type where key='waiting'" >/dev/null
check "an unregistered kind drops out of readiness (never success)" f "$(as_user $A authenticated "select substrate_readiness()->'registered' ? 'waiting'")"
q -c "insert into entity_type (key) values ('waiting')" >/dev/null

echo "-- account deletion reaches the new tables"
check "delete_owned is service_role only" f "$(q -c "select has_function_privilege('authenticated','delete_owned(uuid)','execute')")"
q -c "select delete_owned('$B')" >/dev/null
check "B has no substrate rows left" 0 "$(q -c "select (select count(*) from action where owner_id='$B') + (select count(*) from email_candidate where owner_id='$B') + (select count(*) from receipt_event where owner_id='$B') + (select count(*) from agent_connection where owner_id='$B') + (select count(*) from jarvis_private.email_credential where owner_id='$B') + (select count(*) from item where owner_id='$B')")"
check "A's rows are untouched by B's deletion" "$(q -c "select count(*) from email_candidate where owner_id='$A'")" "$(as_user $A authenticated "select count(*) from email_candidate")"

echo "-- function lockdown"
for fn in 'jarvis_protect_columns()' 'jarvis_receipt_append_only()' 'jarvis_candidate_destination_kind()' 'jarvis_touch_revision()' 'jarvis_dependency_no_self_edge()'; do
  check "authenticated cannot call $fn" f "$(q -c "select has_function_privilege('authenticated','$fn','execute')")"
done

exit $fail
