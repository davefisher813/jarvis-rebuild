#!/usr/bin/env bash
# Real-Postgres proof for migration 0055 (Email connection truth, Email v1
# spec 2026-10-08 section 8, AC36 to AC42). Same stubbed Supabase, 0044's fixtures.
#
# Usage: eval "$(./local_pg.sh start)"; ./email_connection.sh
#
# What it proves:
#   a broken account stays broken: a repeat upsert does not lift reauth_required back to ready
#   a real read (email_account_proved / a complete sync) is what lifts it
#   quota and transient failures only make sync stale, never touch authorization (AC41)
#   a revoked grant is reauth_required, cache kept, still in the inbox; a forgotten one is removed and leaves it
#   sync is catching_up until the declared window is reconciled (AC39), then current with verified_through_at
#   a paused account is never changed by a failure or a proof
#   the old six-argument email_sync_apply still works; the browser cannot call any writer
#   rollback puts the old bodies back and keeps the columns
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=email_connection_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
as_user() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" 2>&1 | tail -1; }
as_user_state() { local out st; if out=$(PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" 2>&1 >/dev/null); then echo ok; return; fi; st=$(echo "$out" | sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' | head -1); echo "${st:-fail}"; }
jget() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d
for k in sys.argv[1].split('.'):
    v=v[int(k)] if isinstance(v,list) else v.get(k)
print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))" "$1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }

echo "-- forward: stub + chain 0001..0055, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
q -f "$here/../migrations/0055_email_connection_truth.sql" >/dev/null
check "0055 forwards twice (idempotent)" ok "$(q -f "$here/../migrations/0055_email_connection_truth.sql" >/dev/null && echo ok)"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
AUTH=authenticated
SVC=service_role
st() { q -c "select auth_state || '|' || state || '|' || sync_state from email_account where id='$1'"; }

ID=$(as_user $A $SVC "select email_account_upsert('$A','Box@Example.test','{}','{}')" | jget account_id)
check "a new account is ready, connected, not started" "ready|connected|not_started" "$(st $ID)"

as_user $A $SVC "select email_account_fail('$A','$ID','reauth','revoked')" >/dev/null
check "a revoked grant is reauth_required (legacy: reauth)" "reauth_required|reauth|failed" "$(st $ID)"
as_user $A $SVC "select email_account_upsert('$A','box@example.test','{}','{}')" >/dev/null
check "a repeat upsert does NOT lift a broken account" "reauth_required|reauth|failed" "$(st $ID)"
check "the reauth account is still in the inbox query's accounts (cache kept)" 1 "$(q -c "select count(*) from email_account where id='$ID' and state <> 'disconnected'")"

as_user $A $SVC "select email_account_fail('$A','$ID','quota','rate limited')" >/dev/null
check "a quota failure while broken leaves authorization alone (still reauth_required)" "reauth_required|reauth|stale" "$(st $ID)"

as_user $A $SVC "select email_account_proved('$A','$ID','{gmail.modify}')" >/dev/null
check "a real authorized read proves the connection" "ready|connected|stale" "$(st $ID)"
check "scopes are stored by the proof" "{gmail.modify}" "$(q -c "select scopes from email_account where id='$ID'")"

as_user $A $SVC "select email_account_fail('$A','$ID','quota','rate limited')" >/dev/null
check "quota on a healthy account: authorization untouched, sync stale (AC41: never reauth)" "ready|connected|stale" "$(st $ID)"
as_user $A $SVC "select email_account_fail('$A','$ID','transient','network')" >/dev/null
check "transient: same" "ready|connected|stale" "$(st $ID)"
as_user $A $SVC "select email_account_fail('$A','$ID','storage','cannot decrypt')" >/dev/null
check "a storage failure is its own authorization value" "storage_error|reauth|failed" "$(st $ID)"
as_user $A $SVC "select email_account_fail('$A','$ID','permission','scope missing')" >/dev/null
check "a missing scope is its own authorization value" "permission_missing|reauth|failed" "$(st $ID)"

echo "-- the older state door keeps both words in step"
as_user $A $SVC "select email_account_state('$A','$ID','reauth','x')" >/dev/null
check "legacy reauth is reauth_required" "reauth_required|reauth" "$(q -c "select auth_state||'|'||state from email_account where id='$ID'")"
as_user $A $SVC "select email_account_state('$A','$ID','connected',null)" >/dev/null
check "a legacy connected does NOT lift a failure" "reauth_required|reauth" "$(q -c "select auth_state||'|'||state from email_account where id='$ID'")"

echo "-- sync honesty (AC39, AC40)"
as_user $A $SVC "select email_account_proved('$A','$ID')" >/dev/null
as_user $A $SVC "select email_sync_commit('$A','$ID','[]'::jsonb,'{}','h1',true,false)" >/dev/null
check "a first page that is not the whole window: catching_up, no verified_through" "ready|connected|catching_up|" "$(q -c "select auth_state||'|'||state||'|'||sync_state||'|'||coalesce(verified_through_at::text,'') from email_account where id='$ID'")"
as_user $A $SVC "select email_sync_commit('$A','$ID','[]'::jsonb,'{}','h2',true,true)" >/dev/null
check "the window reconciled: current with verified_through_at set" "current|true" "$(q -c "select sync_state||'|'||(verified_through_at is not null) from email_account where id='$ID'")"
as_user $A $SVC "select email_sync_apply('$A','$ID','[]'::jsonb,'{}','h3',true)" >/dev/null
check "the old six-argument door still works and never claims current" "catching_up" "$(q -c "select sync_state from email_account where id='$ID'")"

echo "-- forgotten and paused"
as_user $A $SVC "select email_account_mark('$A','BOX@example.test','removed')" >/dev/null
check "a forgotten account is removed (legacy: disconnected)" "removed|disconnected" "$(q -c "select auth_state||'|'||state from email_account where id='$ID'")"
as_user $A $SVC "select email_account_upsert('$A','box@example.test','{}','{}')" >/dev/null
check "connecting it again starts at checking, not ready" "checking|connected" "$(q -c "select auth_state||'|'||state from email_account where id='$ID'")"
q -c "update email_account set auth_state='paused_by_user', paused_at=now() where id='$ID'" >/dev/null
as_user $A $SVC "select email_account_fail('$A','$ID','reauth','x')" >/dev/null
as_user $A $SVC "select email_account_proved('$A','$ID')" >/dev/null
check "a paused account is changed by neither a failure nor a proof" "paused_by_user" "$(q -c "select auth_state from email_account where id='$ID'")"

echo "-- the browser"
for fn in "email_account_fail('$A','$ID','reauth','x')" "email_account_proved('$A','$ID')" "email_account_mark('$A','box@example.test','removed')" "email_sync_commit('$A','$ID','[]'::jsonb,'{}',null,true,true)"; do
  check "the browser cannot call ${fn%%(*}" 42501 "$(as_user_state $A $AUTH "select $fn")"
done
check "email_accounts() reports the new dimensions to the owner" "paused_by_user|catching_up|unverified" "$(as_user $A $AUTH "select (x ->> 'auth_state') || '|' || (x ->> 'sync_state') || '|' || (x ->> 'send_health') from jsonb_array_elements(email_accounts()) x where x ->> 'address' = 'box@example.test'")"
check "another owner's list does not contain it" 0 "$(as_user $B $AUTH "select count(*) from jsonb_array_elements(email_accounts()) x where x ->> 'address' = 'box@example.test'")"

echo "-- rollback: old bodies back, columns kept"
q -f "$here/../rollback/0055_email_connection_truth_down.sql" >/dev/null
check "the five new functions are gone" 0 "$(q -c "select count(*) from pg_proc where proname in ('email_sync_commit','email_account_proved','email_account_fail','email_account_mark','jarvis_legacy_account_state')")"
check "the additive columns stay" 1 "$(q -c "select count(*) from information_schema.columns where table_name='email_account' and column_name='auth_state'")"
check "the old upsert is back and works" connected "$(as_user $A $SVC "select email_account_upsert('$A','again@example.test','{}','{}')" >/dev/null; q -c "select state from email_account where address='again@example.test'")"
q -f "$here/../migrations/0055_email_connection_truth.sql" >/dev/null
check "forward again after a rollback" 1 "$(q -c "select count(*) from pg_proc where proname='email_sync_commit'")"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILURES"; exit 1; }
