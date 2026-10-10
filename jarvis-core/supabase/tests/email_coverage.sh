#!/usr/bin/env bash
# Real-Postgres proof for migration 0065 (the coverage crawl, Email v1 spec 2026-10-08 sections 8.1
# and 8.3; AC39, AC40).
#
# Usage: eval "$(./local_pg.sh start)"; ./email_coverage.sh
#
# What it proves:
#   a crawl start is catching_up with a 90-day window, a new epoch and the history checkpoint it was given
#   a crawl page commits its rows and its progress together, and moves neither freshness nor the cursor
#   a page for an old epoch, a wrong token, or a label already listed is refused whole (nothing written)
#   a repeated id (in two labels, or a retried page) is one row, never two
#   completion is refused until every label is listed; then the cursor, freshness and verified_through_at move and the crawl closes
#   a restart keeps every cached row; checked only marks current a mailbox verified before, with no crawl open
#   the browser cannot call any of it; email_accounts() carries the three sync facts
#   against a production-shaped table (the columns already there, a check constraint, a 'catching_up' default) it forwards twice
#   rollback removes the functions and the working columns and keeps the three production columns
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=email_coverage_test
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

echo "-- forward: stub + the whole chain, fixtures; 0065 again (idempotent)"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
check "0065 forwards twice" ok "$(q -f "$here/../migrations/0065_email_sync_coverage.sql" >/dev/null && echo ok)"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
ACCT=60000000-0000-0000-0000-00000000000a
AUTH=authenticated
SVC=service_role
msg() { echo "{\"provider_id\":\"$1\",\"thread_id\":\"t-$1\",\"internal_date\":\"$2\",\"subject\":\"$3\",\"from_address\":\"x@y.test\",\"from_name\":\"X\",\"snippet\":\"s\",\"labels\":$4}"; }
state() { q -c "select sync_state || '|' || coalesce(cursor,'') || '|' || (last_sync_at is not null)::text || '|' || (verified_through_at is not null)::text || '|' || (coverage_crawl is not null)::text from email_account where id='$ACCT'"; }

q -c "update email_account set cursor = 'h-old', last_sync_at = null, verified_through_at = null, coverage_crawl = null where id='$ACCT'" >/dev/null
BEFORE=$(q -c "select count(*) from email_message where account_id='$ACCT' and deleted_at is null")

echo "-- begin: catching up, a 90-day window, a new epoch, the checkpoint kept"
BG=$(as_user $A $SVC "select email_coverage_begin('$A','$ACCT','h500')")
EPOCH=$(echo "$BG" | jget sync_epoch)
check "catching_up, epoch 1, checkpoint h500, labels in order" "catching_up|1|h500|[\"INBOX\", \"SENT\"]" "$(echo "$BG" | jget sync_state)|$EPOCH|$(echo "$BG" | jget crawl.history_id)|$(echo "$BG" | jget crawl.order)"
check "the window starts 90 days back" t "$(q -c "select abs(extract(epoch from (coverage_start - (now() - interval '90 days')))) < 5 from email_account where id='$ACCT'")"
check "begin moves neither freshness nor the cursor" "catching_up|h-old|false|false|true" "$(state)"
check "the browser cannot begin a crawl" 42501 "$(as_user_state $A $AUTH "select email_coverage_begin('$A','$ACCT','h1')")"
check "another owner's account is not found" NOT_FOUND "$(as_user $B $SVC "select email_coverage_begin('$B','$ACCT','h1')" | jget error)"
check "a label outside Inbox and Sent is refused" INVALID_PAYLOAD "$(as_user $A $SVC "select email_coverage_begin('$A','$ACCT','h1', array['SPAM'])" | jget error)"

echo "-- pages: rows and progress together, freshness untouched"
P1="[$(msg c1 2026-10-03T10:00:00Z 'One' '["INBOX"]'),$(msg c2 2026-10-02T10:00:00Z 'Two' '["INBOX","SENT"]')]"
R1=$(as_user $A $SVC "select email_coverage_page('$A','$ACCT',$EPOCH,'INBOX',null,'tok2','$P1')")
check "page one: two rows, INBOX next is tok2, not done, listed 2" "2|tok2|False|2" "$(echo "$R1" | jget upserted)|$(echo "$R1" | jget state.crawl.labels.INBOX.next)|$(echo "$R1" | jget state.crawl.labels.INBOX.done)|$(echo "$R1" | jget state.crawl.labels.INBOX.listed)"
check "a crawl page moves neither freshness nor the cursor" "catching_up|h-old|false|false|true" "$(state)"
check "the same page again (the token it was listed with is no longer awaited) is refused whole" "STALE_PAGE|2" "$(as_user $A $SVC "select email_coverage_page('$A','$ACCT',$EPOCH,'INBOX',null,'tok2','[$(msg zz 2026-10-01T10:00:00Z 'Ghost' '["INBOX"]')]')" | jget error)|$(q -c "select count(*) from email_message where account_id='$ACCT' and provider_id in ('c1','c2','zz')")"
check "a page for an older epoch is refused" STALE_PAGE "$(as_user $A $SVC "select email_coverage_page('$A','$ACCT',$((EPOCH-1)),'INBOX','tok2',null,'[]')" | jget error)"
check "completion before every label is listed is refused" NOT_LISTED "$(as_user $A $SVC "select email_coverage_complete('$A','$ACCT',$EPOCH,'[]','{}','h600')" | jget error)"
R2=$(as_user $A $SVC "select email_coverage_page('$A','$ACCT',$EPOCH,'INBOX','tok2',null,'[$(msg c3 2026-09-20T10:00:00Z 'Three' '["INBOX"]')]')")
check "the last INBOX page closes the label" "True|3" "$(echo "$R2" | jget state.crawl.labels.INBOX.done)|$(echo "$R2" | jget state.crawl.labels.INBOX.listed)"
check "a page for a label already listed is refused" STALE_PAGE "$(as_user $A $SVC "select email_coverage_page('$A','$ACCT',$EPOCH,'INBOX',null,null,'[]')" | jget error)"
R3=$(as_user $A $SVC "select email_coverage_page('$A','$ACCT',$EPOCH,'SENT',null,null,'[$(msg c2 2026-10-02T10:00:00Z 'Two' '["INBOX","SENT"]'),$(msg s1 2026-10-01T10:00:00Z 'Sent one' '["SENT"]')]')")
check "SENT listed; the id seen in both labels is one row" "True|1" "$(echo "$R3" | jget state.crawl.labels.SENT.done)|$(q -c "select count(*) from email_message where account_id='$ACCT' and provider_id='c2'")"
check "still not current after every page: reconciliation has not run" "catching_up|h-old|false|false|true" "$(state)"

echo "-- complete: the reconciled changes, then current"
check "completion for an older epoch is refused" STALE_PAGE "$(as_user $A $SVC "select email_coverage_complete('$A','$ACCT',$((EPOCH-1)),'[]','{}','h600')" | jget error)"
check "completion without a cursor is refused" INVALID_PAYLOAD "$(as_user $A $SVC "select email_coverage_complete('$A','$ACCT',$EPOCH,'[]','{}','')" | jget error)"
C=$(as_user $A $SVC "select email_coverage_complete('$A','$ACCT',$EPOCH,'[$(msg c4 2026-10-03T14:00:00Z 'Arrived mid-crawl' '["INBOX"]')]','{c3}','h600')")
check "complete: current, cursor h600, freshness and verified stamped, crawl closed" "current|h600|true|true|false" "$(state)"
check "the change since the checkpoint landed and the deleted id left" "1|0" "$(q -c "select count(*) from email_message where account_id='$ACCT' and provider_id='c4' and deleted_at is null")|$(q -c "select count(*) from email_message where account_id='$ACCT' and provider_id='c3' and deleted_at is null")"
check "the answer carries last_sync_at" t "$(echo "$C" | python3 -c "import json,sys; print('t' if json.load(sys.stdin).get('last_sync_at') else 'f')")"
check "nothing cached before the crawl was lost" "$BEFORE" "$(q -c "select count(*) from email_message where account_id='$ACCT' and deleted_at is null and provider_id not in ('c1','c2','c4','s1')")"

echo "-- checked: only a verified mailbox with no crawl open"
check "a cut-off refresh is catching up and keeps verified_through_at" "catching_up|t" "$(as_user $A $SVC "select email_coverage_checked('$A','$ACCT',$EPOCH,false)" | jget state.sync_state)|$(q -c "select (verified_through_at is not null) from email_account where id='$ACCT'")"
check "a complete refresh is current" current "$(as_user $A $SVC "select email_coverage_checked('$A','$ACCT',$EPOCH,true)" | jget state.sync_state)"
BG2=$(as_user $A $SVC "select email_coverage_begin('$A','$ACCT','h700')")
EPOCH2=$(echo "$BG2" | jget sync_epoch)
check "a restart (history expired) is catching up with a new epoch, and every cached row stays" "catching_up|2|$((BEFORE + 4))" "$(echo "$BG2" | jget sync_state)|$EPOCH2|$(q -c "select count(*) from email_message where account_id='$ACCT' and deleted_at is null")"
check "checked cannot mark current while a crawl is open" STALE_PAGE "$(as_user $A $SVC "select email_coverage_checked('$A','$ACCT',$EPOCH2,true)" | jget error)"
q -c "update email_account set coverage_crawl = null, verified_through_at = null where id='$ACCT'" >/dev/null
check "checked cannot mark current a mailbox never verified" NOT_LISTED "$(as_user $A $SVC "select email_coverage_checked('$A','$ACCT',$EPOCH2,true)" | jget error)"
for fn in "email_coverage_state('$A','$ACCT')" "email_coverage_page('$A','$ACCT',1,'INBOX',null,null,'[]')" "email_coverage_complete('$A','$ACCT',1,'[]','{}','h1')" "email_coverage_checked('$A','$ACCT',1,true)"; do
  check "the browser cannot call ${fn%%(*}" 42501 "$(as_user_state $A $AUTH "select $fn")"
done
check "email_accounts() carries sync_state, verified_through_at and coverage_start" "catching_up|True" "$(as_user $A $AUTH "select email_accounts()" | python3 -c "import json,sys; d=[x for x in json.load(sys.stdin) if x['id']=='$ACCT'][0]; print(d['sync_state'] + '|' + str('verified_through_at' in d and 'coverage_start' in d))")"

echo "-- rollback, then forward again"
q -f "$here/../rollback/0065_email_sync_coverage_down.sql" >/dev/null
check "rollback removes the functions and the working columns, keeps the production columns" "0|0|3" "$(q -c "select count(*) from pg_proc where proname like 'email_coverage_%'")|$(q -c "select count(*) from information_schema.columns where table_name='email_account' and column_name in ('sync_epoch','coverage_crawl')")|$(q -c "select count(*) from information_schema.columns where table_name='email_account' and column_name in ('sync_state','coverage_start','verified_through_at')")"
check "email_accounts() is 0063's again" f "$(q -c "select prosrc like '%sync_state%' from pg_proc where proname='email_accounts'")"
q -f "$here/../migrations/0065_email_sync_coverage.sql" >/dev/null
check "forward again" 5 "$(q -c "select count(*) from pg_proc where proname like 'email_coverage_%'")"

echo "-- a production-shaped table: the columns already there, a check constraint, a 'catching_up' default"
DB2=email_coverage_prod_shape
psql -qAt -d postgres -c "drop database if exists $DB2" -c "create database $DB2 encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q2() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB2" "$@"; }
q2 -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort | grep -v 0065_); do q2 -f "$f" >/dev/null; done
q2 -c "alter table email_account add column sync_state text default 'catching_up' check (sync_state in ('not_started','syncing','current','catching_up','stale','failed','paused')), add column coverage_start timestamptz, add column verified_through_at timestamptz, add column auth_state text, add column paused_at timestamptz" >/dev/null
q2 -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
q2 -f "$here/../migrations/0065_email_sync_coverage.sql" >/dev/null
q2 -f "$here/../migrations/0065_email_sync_coverage.sql" >/dev/null
check "0065 forwards twice over the production shape and leaves its default alone" "catching_up" "$(q2 -c "select column_default from information_schema.columns where table_name='email_account' and column_name='sync_state'" | sed "s/'::text//; s/'//")"
PB=$(PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB2" -c "set role $SVC" -c "select set_config('request.jwt.claims', '{\"sub\":\"$A\",\"role\":\"$SVC\"}', false)" -c "select email_coverage_begin('$A','$ACCT','h1')" -c "select email_coverage_page('$A','$ACCT',1,'INBOX',null,null,'[]')" -c "select email_coverage_page('$A','$ACCT',1,'SENT',null,null,'[]')" -c "select email_coverage_complete('$A','$ACCT',1,'[]','{}','h2')" 2>&1 | tail -1)
check "the production check constraint accepts what the functions write" current "$(echo "$PB" | jget state.sync_state)"

psql -qAt -d postgres -c "drop database if exists $DB2" >/dev/null
[ "$fail" = 0 ] && echo "ALL OK" || { echo "SOME CHECKS FAILED"; exit 1; }
