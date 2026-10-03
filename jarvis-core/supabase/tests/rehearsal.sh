#!/usr/bin/env bash
# MIGRATION REHEARSAL (docs/jarvis-unified, slice 09; IMPLEMENTATION-SPEC.md
# section 17: "migration rollback/forward rehearsal and key leakage
# inspection"). On the throwaway Postgres (local_pg.sh): a fresh install of
# every migration from 0001, the eight substrate migrations rolled back in
# reverse order, forward again, forward twice (idempotent), the leakage
# inspection (no token, secret or credential column outside jarvis_private;
# row level security on every substrate table; no function PUBLIC may run),
# and then every proof in order. Nothing here touches a real project.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=jarvis_rehearsal
ERR="${TMPDIR:-/tmp}/jarvis-rehearsal.$$.err"
export PGCLIENTENCODING=UTF8
if ! psql -qAt -d postgres -c "select 1" >/dev/null 2>&1; then echo "no database at PGHOST=${PGHOST:-unset} PGPORT=${PGPORT:-unset}: start local_pg.sh first"; exit 2; fi
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }
step() { if "$@" >/dev/null 2>"$ERR"; then return 0; else echo "FAIL $*: $(tail -3 "$ERR")"; fail=1; return 1; fi; }

UP=$(ls "$here"/../migrations/*.sql | sort)
SUB_UP=$(ls "$here"/../migrations/00{44,45,46,47,48,49,50,51}_*.sql | sort)
SUB_DOWN=$(ls "$here"/../rollback/00{44,45,46,47,48,49,50,51}_*_down.sql | sort -r)

echo "== fresh install, 0001 to 0051 =="
step q -f "$here/stub_supabase.sql" || { echo "SOME FAILED"; exit 1; }
for f in $UP; do step q -f "$f" || { echo "SOME FAILED"; exit 1; }; done
tables_full=$(q -c "select count(*) from pg_tables where schemaname='public'")
fns_full=$(q -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
check "a fresh install has the substrate's tables" t "$(q -c "select (select count(*) from pg_tables where schemaname='public' and tablename in ('agent_connection','scope_grant','policy_suggestion','job','context_package','proposal','action','receipt_event','approval','email_account','email_message','email_message_body','source_evidence','decision_version','decision_dependency','email_candidate','email_draft','outbox_command'))=18")"
echo "   tables $tables_full, functions $fns_full"

echo "== rollback 0051 to 0044, in reverse =="
for f in $SUB_DOWN; do step q -f "$f" || break; done
check "the substrate's tables are gone after the rollback" 0 "$(q -c "select count(*) from pg_tables where schemaname='public' and tablename in ('action','receipt','approval','email_candidate','email_message','email_draft','context_package','agent_connection')")"
check "the private schema is gone after the rollback" 0 "$(q -c "select count(*) from pg_namespace where nspname='jarvis_private'")"
tables_down=$(q -c "select count(*) from pg_tables where schemaname='public'")
check "the app's older tables all survive the rollback (eighteen fewer, none else)" "$((tables_full - 18))" "$tables_down"
echo "   tables after rollback $tables_down"

echo "== forward again, 0044 to 0051 =="
for f in $SUB_UP; do step q -f "$f" || break; done
check "forward after rollback restores the same table count" "$tables_full" "$(q -c "select count(*) from pg_tables where schemaname='public'")"
check "forward after rollback restores the same function count" "$fns_full" "$(q -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")"

echo "== forward twice (idempotent) =="
for f in $SUB_UP; do step q -f "$f" || break; done
check "a second forward changes nothing" "$tables_full/$fns_full" "$(q -c "select (select count(*) from pg_tables where schemaname='public') || '/' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')")"

echo "== key leakage inspection =="
# The substrate's own tables: no column named like a secret outside jarvis_private. outbox_command.claim_token is a
# worker lease, not a credential, and the table is never granted to a browser role (checked next).
check "no secret, credential, password, key or token column in the substrate's public tables" "" "$(q -c "select table_name||'.'||column_name from information_schema.columns where table_schema='public' and table_name in ('agent_connection','scope_grant','policy_suggestion','job','context_package','proposal','action','receipt_event','approval','email_account','email_message','email_message_body','source_evidence','decision_version','decision_dependency','email_candidate','email_draft','outbox_command') and column_name ~* '(secret|credential|password|api_key|refresh_token|access_token|token_enc|^token$|_token$)' and not (table_name='outbox_command' and column_name='claim_token') order by 1")"
check "no outbox function is executable by a browser role (the lease token has no power there)" "" "$(q -c "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'outbox\\_%' and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')) order by 1")"
# For the record, not a gate: the older app's own columns named like a secret, with their row security and browser grants.
q -c "select 'note ' || c.table_name||'.'||c.column_name || ' rls=' || t.relrowsecurity || ' authenticated_select=' || has_table_privilege('authenticated', 'public.'||c.table_name, 'SELECT') || ' anon_select=' || has_table_privilege('anon', 'public.'||c.table_name, 'SELECT') from information_schema.columns c join pg_class t on t.relname=c.table_name join pg_namespace n on n.oid=t.relnamespace and n.nspname='public' where c.table_schema='public' and c.table_name not in ('agent_connection','scope_grant','policy_suggestion','job','context_package','proposal','action','receipt_event','approval','email_account','email_message','email_message_body','source_evidence','decision_version','decision_dependency','email_candidate','email_draft','outbox_command') and c.column_name ~* '(secret|credential|password|api_key|refresh_token|access_token|token_enc|^token$|_token$)' order by 1"
check "row level security is on for every substrate table" "" "$(q -c "select tablename from pg_tables where schemaname='public' and tablename in ('agent_connection','scope_grant','policy_suggestion','job','context_package','proposal','action','receipt_event','approval','email_account','email_message','email_message_body','source_evidence','decision_version','decision_dependency','email_candidate','email_draft','outbox_command') and tablename in (select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) order by 1")"
check "no public-schema function made by the substrate is executable by PUBLIC" "" "$(q -c "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ~ '^(jarvis_|command_|outbox_|approvals_|capture_|candidate|candidates_|draft_|send_|waiting_|thread|threads_|evidence_|email_|context_|agent_|proposal|decision|receipt|hub_|activity_|reported_external|substrate_)' and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')) order by 1")"
check "the browser roles own nothing in jarvis_private" "" "$(q -c "select nspname from pg_namespace where nspname='jarvis_private' and (has_schema_privilege('authenticated','jarvis_private','USAGE') or has_schema_privilege('anon','jarvis_private','USAGE'))")"

echo "== every proof, in order =="
summary=""
for p in substrate gateway commands review email candidates sends waiting ai_budget; do
  [ -f "$here/$p.sh" ] || continue
  out=$("$here/$p.sh" 2>&1); st=$?
  oks=$(printf '%s\n' "$out" | grep -c '^ok ')
  fails=$(printf '%s\n' "$out" | grep -c '^FAIL ')
  last=$(printf '%s\n' "$out" | tail -1)
  summary+="$p.sh: exit $st, $oks ok, $fails failed, $last"$'\n'
  if [ "$st" != 0 ]; then fail=1; printf '%s\n' "$out" | grep '^FAIL' | head -5; fi
done
printf '%s' "$summary"
rm -f "$ERR"
if [ "$fail" = 0 ]; then echo "ALL OK"; else echo "SOME FAILED"; exit 1; fi
