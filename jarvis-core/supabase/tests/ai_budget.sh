#!/usr/bin/env bash
# Real-Postgres test for migration 0043 (ai_spend_budget). Not a mock: it runs
# the actual functions under genuine concurrency (many psql sessions at once).
#
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=postgres ./ai_budget.sh
# Needs a server where roles anon and authenticated exist (a stubbed Supabase
# is enough) and a scratch database this script may drop and recreate.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=ai_budget_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
q() { psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
q -f "$here/../migrations/0043_ai_spend_budget.sql" >/dev/null

fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi
}
U1=00000000-0000-0000-0000-000000000001
U2=00000000-0000-0000-0000-000000000002

# 1. Concurrency: 60 simultaneous reserves of $0.40 against a $5 cap. Exactly
#    12 fit (12 x 0.4 = 4.8; a 13th would be 5.2), never 13.
for i in $(seq 1 60); do
  q -c "select ai_budget_reserve('$U1','c$i','h$i','claude-sonnet-5-5','v1',400000)->>'status'" >/tmp/ab_res_$i.out &
done
wait
reserved=$(cat /tmp/ab_res_*.out | grep -c '^reserved$' || true)
over=$(cat /tmp/ab_res_*.out | grep -c '^over_limit$' || true)
rm -f /tmp/ab_res_*.out
check "60 concurrent reserves admit exactly 12" 12 "$reserved"
check "the other 48 are refused over_limit" 48 "$over"
check "held equals 12 x 400000" 4800000 "$(q -c "select held_microusd from ai_budget where user_id='$U1'")"
check "spent + held never exceeds limit" t "$(q -c "select spent_microusd+held_microusd <= limit_microusd from ai_budget where user_id='$U1'")"

# 2. Multi-user isolation: user 2 is unaffected by user 1 being full.
check "other user still admitted" reserved "$(q -c "select ai_budget_reserve('$U2','x1','hx1','claude-sonnet-5-5','v1',400000)->>'status'")"
check "other user's held is only its own" 400000 "$(q -c "select held_microusd from ai_budget where user_id='$U2'")"

# Two ids that really were admitted (which 12 of the 60 won is a race).
A1=$(q -c "select request_id from ai_budget_reservation where user_id='$U1' order by request_id limit 1")
A2=$(q -c "select request_id from ai_budget_reservation where user_id='$U1' order by request_id desc limit 1")
H1=h${A1#c}
H2=h${A2#c}

# 3. Idempotency and hash mismatch.
check "same id same hash re-finds the hold" reserved "$(q -c "select ai_budget_reserve('$U1','$A1','$H1','claude-sonnet-5-5','v1',400000)->>'status'")"
check "held unchanged by the replay" 4800000 "$(q -c "select held_microusd from ai_budget where user_id='$U1'")"
check "same id different hash refused" hash_mismatch "$(q -c "select ai_budget_reserve('$U1','$A1','OTHER','claude-sonnet-5-5','v1',400000)->>'status'")"

# 4. mark_dispatched: 20 racers, one winner.
q -c "select ai_budget_reserve('$U2','d1','hd1','claude-sonnet-5-5','v1',100000)" >/dev/null
for i in $(seq 1 20); do
  q -c "select ai_budget_mark_dispatched('$U2','d1')" >/tmp/ab_disp_$i.out &
done
wait
check "exactly one dispatcher wins" 1 "$(cat /tmp/ab_disp_*.out | grep -c '^t$' || true)"
rm -f /tmp/ab_disp_*.out
check "a dispatched request id now reads as replay" replay "$(q -c "select ai_budget_reserve('$U2','d1','hd1','claude-sonnet-5-5','v1',100000)->>'status'")"

# 5. Release rules.
check "a dispatched hold is not released by default" dispatched "$(q -c "select ai_budget_release('$U2','d1')->>'status'")"
check "held unchanged after refused release" 500000 "$(q -c "select held_microusd from ai_budget where user_id='$U2'")"
check "an undispatched hold releases" released "$(q -c "select ai_budget_release('$U2','x1')->>'status'")"
check "release twice is harmless" already_released "$(q -c "select ai_budget_release('$U2','x1')->>'status'")"
check "known zero-charge dispatched call releases" released "$(q -c "select ai_budget_release('$U2','d1',true)->>'status'")"
check "held back to zero for user 2" 0 "$(q -c "select held_microusd from ai_budget where user_id='$U2'")"

# 6. Settle: exactly once, actual replaces the hold.
check "settle records actual" settled "$(q -c "select ai_budget_settle('$U1','$A1',123456)->>'status'")"
check "settle twice does not double count" already_settled "$(q -c "select ai_budget_settle('$U1','$A1',123456)->>'status'")"
check "spent is the actual" 123456 "$(q -c "select spent_microusd from ai_budget where user_id='$U1'")"
check "hold released on settle" 4400000 "$(q -c "select held_microusd from ai_budget where user_id='$U1'")"
check "settle after settle cannot be released" settled "$(q -c "select ai_budget_release('$U1','$A1')->>'status'")"

# 7. Overrun: actual above the hold is recorded truthfully and pauses.
check "overrun settles" true "$(q -c "select ai_budget_settle('$U1','$A2',900000)->>'overrun'")"
check "overrun pauses the budget" t "$(q -c "select paused from ai_budget where user_id='$U1'")"
check "spent carries the truth" 1023456 "$(q -c "select spent_microusd from ai_budget where user_id='$U1'")"
check "paused refuses new reserves" paused "$(q -c "select ai_budget_reserve('$U1','p1','hp1','claude-sonnet-5-5','v1',1)->>'status'")"

# 8. set_limit: version check, no reset of spent, pause cleared only when covered.
check "stale version conflicts" version_conflict "$(q -c "select ai_budget_set_limit('$U1',9000000,999)->>'status'")"
v=$(q -c "select version from ai_budget where user_id='$U1'")
check "set_limit ok" ok "$(q -c "select ai_budget_set_limit('$U1',9000000,$v)->>'status'")"
check "changing the cap never resets spent" 1023456 "$(q -c "select spent_microusd from ai_budget where user_id='$U1'")"
check "pause cleared once the limit covers spent+held" f "$(q -c "select paused from ai_budget where user_id='$U1'")"
v=$(q -c "select version from ai_budget where user_id='$U1'")
q -c "select ai_budget_set_limit('$U1',1000,$v)" >/dev/null
check "limit below spent+held leaves no room" over_limit "$(q -c "select ai_budget_reserve('$U1','p2','hp2','claude-sonnet-5-5','v1',1)->>'status'")"
v=$(q -c "select version from ai_budget where user_id='$U1'")
q -c "select ai_budget_set_limit('$U1',0,$v)" >/dev/null
check "zero limit means paid AI off" paused "$(q -c "select ai_budget_reserve('$U1','p3','hp3','claude-sonnet-5-5','v1',1)->>'status'")"

# 9. Reconcile stale: undispatched released, dispatched conservatively settled.
q -c "select ai_budget_reserve('$U2','s1','hs1','claude-sonnet-5-5','v1',200000)" >/dev/null
q -c "select ai_budget_reserve('$U2','s2','hs2','claude-sonnet-5-5','v1',300000)" >/dev/null
q -c "select ai_budget_mark_dispatched('$U2','s2')" >/dev/null
q -c "update ai_budget_reservation set updated_at = now() - interval '2 hours' where user_id='$U2' and request_id in ('s1','s2')" >/dev/null
check "reconcile reports 1 released 1 settled" '{"settled": 1, "released": 1}' "$(q -c "select ai_budget_reconcile_stale(interval '1 hour')")"
check "stale dispatched hold settled at reserved cost" 300000 "$(q -c "select spent_microusd from ai_budget where user_id='$U2'")"
check "no hold left for user 2" 0 "$(q -c "select held_microusd from ai_budget where user_id='$U2'")"

# 10. Lockdown: neither anon nor authenticated can read the tables or call the functions.
for role in anon authenticated; do
  check "$role cannot select ai_budget" f "$(q -c "select has_table_privilege('$role','ai_budget','select')")"
  check "$role cannot select reservations" f "$(q -c "select has_table_privilege('$role','ai_budget_reservation','select')")"
  check "$role cannot reserve" f "$(q -c "select has_function_privilege('$role','ai_budget_reserve(uuid,text,text,text,text,bigint)','execute')")"
  check "$role cannot set the limit" f "$(q -c "select has_function_privilege('$role','ai_budget_set_limit(uuid,bigint,integer)','execute')")"
  check "$role cannot settle" f "$(q -c "select has_function_privilege('$role','ai_budget_settle(uuid,text,bigint)','execute')")"
done
check "RLS is on for the budget" t "$(q -c "select relrowsecurity from pg_class where relname='ai_budget'")"
check "RLS is on for reservations" t "$(q -c "select relrowsecurity from pg_class where relname='ai_budget_reservation'")"

# 11. Default limit is $5.
check "a fresh user starts at 5000000" 5000000 "$(q -c "select (ai_budget_status('00000000-0000-0000-0000-000000000009')->>'limit')::bigint")"

exit $fail
