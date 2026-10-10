#!/usr/bin/env bash
# Real-Postgres proof for migration 0062 (private by default: the four revokes, a search_path on every
# function, delete_owned over the four user_id tables; Phase 0 design D7, 2026-10-10).
#
# Usage: eval "$(./local_pg.sh start)"; ./posture.sh
#
# What it proves (PHASE0-DESIGN.md section 3, "Proof tests/posture.sh"):
#   before 0062 the browser roles hold Supabase's default grant on email_opens, google_tokens, ai_tokens
#   and feedback (the condition the revoke is proven under) and ten public functions have no search_path
#   after 0062 has_table_privilege is false for anon and authenticated on every verb of the four, a real
#   select as the person answers 42501, service_role keeps every verb and still reads; the sequence is closed
#   the count of public functions without a search_path is 0 (no exclusion: the stray 0055 function is
#   live only and never exists on this chain); the ten carry search_path=public; 0062 creates nothing
#   delete_owned(A) leaves 0 rows for A in ai_budget, ai_budget_reservation, device_token and
#   google_reconnect_attempt and B's rows intact; anon and authenticated cannot execute it
#   readiness carries 0062 and phase0.private true; anon cannot ask
#   rollback restores the 0060 bodies and the ten search_paths and does NOT reopen the four tables; forward
#   again is the same schema; forward with the two 0037 functions absent (the live shape) creates neither
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=posture_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
as_user() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" 2>&1 | tail -1; }
as_user_state() { local out st; if out=$(PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" 2>&1 >/dev/null); then echo ok; return; fi; st=$(echo "$out" | sed -n 's/^ERROR:  \([0-9A-Z]\{5\}\):.*/\1/p' | head -1); echo "${st:-fail}"; }
py() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }
counts() { q -c "select (select count(*) from pg_tables where schemaname='public') || '/' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')"; }
# The derivation query of the 0062 header: public functions whose proconfig has no search_path.
nosp() { q -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')"; }
nosp_list() { q -c "select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')"; }
four_rows() { q -c "select (select count(*) from ai_budget where user_id='$1')||'|'||(select count(*) from ai_budget_reservation where user_id='$1')||'|'||(select count(*) from device_token where user_id='$1')||'|'||(select count(*) from google_reconnect_attempt where user_id='$1')"; }

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
AUTH=authenticated
SVC=service_role
FOUR="array['email_opens','google_tokens','ai_tokens','feedback']"
TEN="'get_subscription_tier','get_user_settings','jarvis_action_provisional_email','jarvis_action_replay','jarvis_address_norm','jarvis_address_ok','jarvis_context_fields','jarvis_draft_fields_bad','jarvis_payload_clean','jarvis_policy_rule_ok'"
TEN_SORTED="get_subscription_tier,get_user_settings,jarvis_action_provisional_email,jarvis_action_replay,jarvis_address_norm,jarvis_address_ok,jarvis_context_fields,jarvis_draft_fields_bad,jarvis_payload_clean,jarvis_policy_rule_ok"

echo "-- forward: stub + chain 0001..0061, fixtures, rows for A and B in the user_id tables, then 0062 twice"
q -f "$here/stub_supabase.sql" >/dev/null
# 0001..0061 only, as the line above says: a later migration applied early (0063 sets one of the ten search_paths)
# would change the "before" this proof is taken against.
for f in $(ls "$here"/../migrations/*.sql | sort | awk -F/ '{ n = substr($NF, 1, 4) + 0; if (n < 62) print }'); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
q -c "insert into ai_budget (user_id) values ('$A'), ('$B')" \
  -c "insert into ai_budget_reservation (user_id, request_id, request_hash, model, price_version, reserved_microusd, state) values ('$A','r-a','h','m','v',1,'reserved'), ('$B','r-b','h','m','v',1,'reserved')" \
  -c "insert into device_token (token, user_id) values (repeat('a', 40), '$A'), (repeat('b', 40), '$B')" \
  -c "insert into google_reconnect_attempt (user_id, email, nonce, expires_at) values ('$A','a@example.test','n', now() + interval '5 minutes'), ('$B','b@example.test','n', now() + interval '5 minutes')" \
  -c "insert into ai_tokens (user_id) values ('$A'), ('$B')" >/dev/null
check "0. before 0062: the browser roles hold the default grant on the four tables and ten functions have no search_path" "true|true|true|10|$TEN_SORTED" \
  "$(q -c "select bool_and(has_table_privilege('authenticated','public.'||t,'select'))::text||'|'||bool_and(has_table_privilege('anon','public.'||t,'select'))::text from unnest($FOUR) t")|$(q -c "select has_sequence_privilege('authenticated','ai_tokens_id_seq','usage')::text")|$(nosp)|$(nosp_list)"
COUNTS0=$(counts)
q -f "$here/../migrations/0062_private_by_default.sql" >/dev/null
COUNTS1=$(counts)
check "1. 0062 forwards twice (idempotent) and creates no table and no function" "ok|$COUNTS1|$COUNTS0" "$(q -f "$here/../migrations/0062_private_by_default.sql" >/dev/null && echo ok)|$(counts)|$COUNTS1"

echo "-- the four tables"
check "2. has_table_privilege is false for anon and authenticated on every verb of the four tables" "" \
  "$(q -c "select t||':'||r from unnest($FOUR) t cross join unnest(array['anon','authenticated']) r where has_table_privilege(r, 'public.'||t, 'select, insert, update, delete') order by 1")"
check "3. has_table_privilege is true for service_role on every verb of the four tables" 4 \
  "$(q -c "select count(*) from unnest($FOUR) t where has_table_privilege('service_role', 'public.'||t, 'select, insert, update, delete')")"
check "4. a real select as A answers 42501 on each of the four, as authenticated and as anon" "42501|42501|42501|42501|42501|42501|42501|42501" \
  "$(as_user_state $A $AUTH "select count(*) from email_opens")|$(as_user_state $A $AUTH "select count(*) from google_tokens")|$(as_user_state $A $AUTH "select count(*) from ai_tokens")|$(as_user_state $A $AUTH "select count(*) from feedback")|$(as_user_state $A anon "select count(*) from email_opens")|$(as_user_state $A anon "select count(*) from google_tokens")|$(as_user_state $A anon "select count(*) from ai_tokens")|$(as_user_state $A anon "select count(*) from feedback")"
check "5. a real insert as A is refused the same way (the routes write with the service key)" "42501|42501" \
  "$(as_user_state $A $AUTH "insert into feedback (id, user_id, text) values (gen_random_uuid(), '$A', 'hi')")|$(as_user_state $A $AUTH "insert into email_opens (track_id, user_id) values (gen_random_uuid(), '$A')")"
check "6. a real select as service_role still answers" "2|0" "$(as_user $A $SVC "select count(*) from ai_tokens")|$(as_user $A $SVC "select count(*) from feedback")"
check "7. ai_tokens's sequence is closed to the browser roles and open to the server" "false|false|true" \
  "$(q -c "select has_sequence_privilege('anon','ai_tokens_id_seq','usage')||'|'||has_sequence_privilege('authenticated','ai_tokens_id_seq','usage')||'|'||has_sequence_privilege('service_role','ai_tokens_id_seq','usage')")"
check "8. row level security stays on for the four, with no policy (0062 adds none)" "4|0" \
  "$(q -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any($FOUR) and c.relrowsecurity")|$(q -c "select count(*) from pg_policies where schemaname='public' and tablename = any($FOUR)")"

echo "-- search_path"
check "9. no public function is without a search_path after 0062 (no exclusion on this chain)" "0|" "$(nosp)|$(nosp_list)"
check "10. the ten carry search_path=public and nothing else changed about them (kind, volatility, owner body)" "10|10" \
  "$(q -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ($TEN) and p.proconfig = array['search_path=public']")|$(q -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ($TEN)")"
check "11. the 0037 functions keep their own posture (authenticated executes, the body is 0037's); 0062 only set the path" "true|true|true" \
  "$(q -c "select has_function_privilege('authenticated','get_subscription_tier()','execute')||'|'||has_function_privilege('authenticated','get_user_settings()','execute')||'|'||(pg_get_functiondef('get_subscription_tier'::regproc) like '%subscription_tier%')")"

echo "-- account deletion"
check "12. before: A and B each hold one row in the four user_id tables" "1|1|1|1|1|1|1|1" "$(four_rows $A)|$(four_rows $B)"
check "13. delete_owned(A) leaves 0 rows for A in the four user_id tables and B's rows intact" "|0|0|0|0|1|1|1|1" "$(as_user $A $SVC "select delete_owned('$A')")|$(four_rows $A)|$(four_rows $B)"
check "14. delete_owned still reaches item, item_change and ai_tokens for A, and B's ai_tokens row stands" "0|0|0|1" \
  "$(q -c "select (select count(*) from item where owner_id='$A')||'|'||(select count(*) from item_change where owner_id='$A')||'|'||(select count(*) from ai_tokens where user_id='$A')||'|'||(select count(*) from ai_tokens where user_id='$B')")"
check "15. anon and authenticated cannot execute delete_owned (the privilege and a real call), and B's rows stand after the attempt" "false|false|42501|42501|1|1|1|1" \
  "$(q -c "select has_function_privilege('anon','delete_owned(uuid)','execute')||'|'||has_function_privilege('authenticated','delete_owned(uuid)','execute')")|$(as_user_state $B $AUTH "select delete_owned('$B')")|$(as_user_state $B anon "select delete_owned('$B')")|$(four_rows $B)"

echo "-- readiness"
check "16. readiness carries migration 0062, phase0.memory, inbox and private true" "0062|True|True|True" \
  "$(as_user $B $AUTH "select substrate_readiness()" | py "p=d['phase0']; print(d['migration']+'|'+str(p['memory'])+'|'+str(p['inbox'])+'|'+str(p['private']))")"
check "17. anon cannot ask readiness" 42501 "$(as_user_state $B anon "select substrate_readiness()")"
check "18. the two functions 0062 defines are revoked from PUBLIC and carry search_path; service_role executes delete_owned, authenticated executes readiness" "0|0|2|true|true" \
  "$(q -c "select count(*) filter (where p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')) || '|' || count(*) filter (where not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')) || '|' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('delete_owned','substrate_readiness')")|$(q -c "select has_function_privilege('service_role','delete_owned(uuid)','execute')||'|'||has_function_privilege('authenticated','substrate_readiness()','execute')")"

echo "-- rollback, then forward again"
q -f "$here/../rollback/0062_private_by_default_down.sql" >/dev/null
check "19. rollback restores the 0060 bodies and the ten search_paths, and does NOT reopen the four tables (the 0060 probe still reads private true)" "f|0060|10|$TEN_SORTED||false|True" \
  "$(q -c "select pg_get_functiondef('delete_owned'::regproc) like '%ai_budget%'")|$(q -c "select substrate_readiness()->>'migration'")|$(nosp)|$(nosp_list)|$(q -c "select t||':'||r from unnest($FOUR) t cross join unnest(array['anon','authenticated']) r where has_table_privilege(r, 'public.'||t, 'select, insert, update, delete') order by 1")|$(q -c "select has_sequence_privilege('authenticated','ai_tokens_id_seq','usage')::text")|$(as_user $B $AUTH "select substrate_readiness()" | py "print(str(d['phase0']['private']))")"
q -f "$here/../migrations/0062_private_by_default.sql" >/dev/null
check "20. forward again after a rollback" "$COUNTS1|0|0062|t" "$(counts)|$(nosp)|$(q -c "select substrate_readiness()->>'migration'")|$(q -c "select pg_get_functiondef('delete_owned'::regproc) like '%google_reconnect_attempt%'")"

echo "-- the live shape: the two 0037 functions absent"
q -f "$here/../rollback/0062_private_by_default_down.sql" >/dev/null
q -c "drop function get_subscription_tier()" -c "drop function get_user_settings()" >/dev/null
COUNTS_LIVE=$(counts)
check "21. with the two 0037 functions absent, 0062 forwards, creates neither, and leaves no function without a search_path" "ok|0|$COUNTS_LIVE|0" \
  "$(q -f "$here/../migrations/0062_private_by_default.sql" >/dev/null && echo ok)|$(q -c "select count(*) from pg_proc where proname in ('get_subscription_tier','get_user_settings')")|$(counts)|$(nosp)"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILURES"; exit 1; }
