#!/usr/bin/env bash
# Real-Postgres proof for migration 0048 (the Email cache's writers and
# readers, slice 05). Same stubbed Supabase, 0044's fixtures.
#
# Usage: eval "$(./local_pg.sh start)"; ./email.sh
#
# What it proves (IMPLEMENTATION-SPEC.md 08 E01 to E06, E21, E22, E28; 11):
#   E01  newest first by the provider's receipt time, then by id, across accounts; equal timestamps hold their order between pages
#   E02  a page is 30 rows; a next page continues after the last row; freshness advances only on a good sync
#   E03  the cached search is literal, covers sender, subject, snippet and body, and says it is the cache
#   E04  nothing here hides a row by category: every INBOX row is in All
#   E06  the cache follows the provider's labels; a read is not a receipt
#   E21  one account's failure leaves the other's rows and freshness alone; a disconnected account keeps its cache and drops out of the page
#   E29  archive and trash write one receipt each, idempotent by the route's key, with the provider's answer; read is never a receipt
#   plus: the browser cannot write the cache; another owner reads nothing; the body is stored once and read with its message.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=email_test
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

echo "-- forward: stub + chain 0001..0048, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
echo "-- rollback 0048, forward again (idempotent)"
q -f "$here/../rollback/0048_email_cache_and_provider_down.sql" >/dev/null
check "rollback removes the cache functions and the html column" "0|0" "$(q -c "select count(*) from pg_proc where proname in ('email_inbox','email_sync_apply')")|$(q -c "select count(*) from information_schema.columns where table_name='email_message_body' and column_name='html'")"
q -f "$here/../migrations/0048_email_cache_and_provider.sql" >/dev/null
q -f "$here/../migrations/0048_email_cache_and_provider.sql" >/dev/null
check "forward again is idempotent" 2 "$(q -c "select count(*) from pg_proc where proname in ('email_inbox','email_sync_apply')")"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
ACCT=60000000-0000-0000-0000-00000000000a
AUTH=authenticated
SVC=service_role
msg() { # provider_id date subject from labels
  echo "{\"provider_id\":\"$1\",\"thread_id\":\"t-$1\",\"internal_date\":\"$2\",\"subject\":\"$3\",\"from_address\":\"$4\",\"from_name\":\"$5\",\"snippet\":\"$6\",\"labels\":$7,\"history_id\":\"h1\"}"
}

echo "-- accounts: the server mirrors a connected mailbox; the browser cannot"
UP=$(as_user $A $SVC "select email_account_upsert('$A','Second@Example.test','{gmail.modify}','{\"archive\":true}')")
ACCT2=$(echo "$UP" | jget account_id)
check "an account row, lowercased, connected, with its private credential reference" "second@example.test|connected|google_tokens:second@example.test" "$(q -c "select a.address || '|' || a.state || '|' || c.credential_ref from email_account a join jarvis_private.email_credential c on c.account_id=a.id where a.id='$ACCT2'")"
check "upsert again is the same row" "$ACCT2" "$(as_user $A $SVC "select email_account_upsert('$A','second@example.test')" | jget account_id)"
check "the browser cannot upsert an account" 42501 "$(as_user_state $A $AUTH "select email_account_upsert('$A','x@example.test')")"
check "the browser cannot insert a message row" 42501 "$(as_user_state $A $AUTH "insert into email_message (owner_id, account_id, provider_id, thread_id, internal_date, source_hash) values ('$A','$ACCT','x','x',now(),'x')")"
check "the person reads their accounts with freshness" "2|a@example.test" "$(as_user $A $AUTH "select email_accounts()" | py "print(str(len(d))+'|'+d[0]['address'])")"

echo "-- E01, E02: a sync lands rows; the page is newest first with a stable tiebreak; equal timestamps hold"
ROWS="[$(msg m1 2026-10-03T10:00:00Z 'Your bill is ready' billing@conedison.test 'Con Edison' 'Amount due' '["INBOX","UNREAD"]'),$(msg m2 2026-10-03T10:00:00Z 'Same second' a@x.test 'A' 'tie' '["INBOX"]'),$(msg m3 2026-10-03T10:00:00Z 'Same second too' b@x.test 'B' 'tie' '["INBOX","UNREAD"]'),$(msg m4 2026-10-02T09:00:00Z 'Older' c@x.test 'C' 'old' '["INBOX"]'),$(msg m5 2026-10-01T09:00:00Z 'Archived already' d@x.test 'D' 'gone' '["UNREAD"]'),$(msg m-a1 2026-10-02T14:00:00Z 'Your bill is ready' billing@conedison.test 'Con Edison' 'Amount due 142.30 by Oct 15' '["INBOX"]'),$(msg m-a2 2026-10-02T15:00:00Z 'Transcript' coach@example.test 'Coach Miller' 'Can you review the transcript by Oct 9' '["INBOX","UNREAD"]')]"
SY=$(as_user $A $SVC "select email_sync_apply('$A','$ACCT','$ROWS','{}','hist-100')")
check "seven rows upserted (two of them the fixture's, in place), the cursor and freshness set" "7|hist-100|t" "$(echo "$SY" | jget upserted)|$(q -c "select cursor from email_account where id='$ACCT'")|$(q -c "select last_sync_at is not null from email_account where id='$ACCT'")"
check "the fixture message was updated in place, not duplicated, and wears the provider's labels now" "1|true" "$(q -c "select count(*)::text || '|' || bool_and('INBOX' = any(provider_labels)) from email_message where account_id='$ACCT' and provider_id='m-a1'")"
P1=$(as_user $A $AUTH "select email_inbox(null, null, null, 3)")
check "the first page is newest first and ties break by id descending" "m3,m2,m1" "$(echo "$P1" | py "print(','.join(r['provider_id'] for r in d['rows']))")"
check "the archived row (no INBOX label) is not on the inbox page but is still cached; cached_total counts inbox rows" "6|0|1" "$(echo "$P1" | jget cached_total)|$(echo "$P1" | py "print(sum(1 for r in d['rows'] if r['provider_id']=='m5'))")|$(q -c "select count(*) from email_message where account_id='$ACCT' and provider_id='m5' and deleted_at is null")"
LAST_DATE=$(echo "$P1" | py "print(d['rows'][-1]['internal_date'])"); LAST_ID=$(echo "$P1" | py "print(d['rows'][-1]['provider_id'])")
P2=$(as_user $A $AUTH "select email_inbox(null, '$LAST_DATE', '$LAST_ID', 3)")
check "the next page continues after the last row, nothing repeated, nothing skipped" "m-a2,m-a1,m4" "$(echo "$P2" | py "print(','.join(r['provider_id'] for r in d['rows']))")"
check "read is derived from the labels" "False|True" "$(echo "$P1" | py "print(str([r['read'] for r in d['rows'] if r['provider_id']=='m1'][0])+'|'+str([r['read'] for r in d['rows'] if r['provider_id']=='m2'][0]))")"
check "B sees none of A's rows" 0 "$(as_user $B $AUTH "select email_inbox()" | py "print(sum(1 for r in d['rows'] if r['account']=='a@example.test'))")"

echo "-- E21: two accounts in one page; one failing leaves the other alone; disconnected drops out, keeps its cache"
as_user $A $SVC "select email_sync_apply('$A','$ACCT2','[$(msg n1 2026-10-03T11:00:00Z 'From the second mailbox' e@x.test 'E' 'hi' '["INBOX"]')]','{}','hist-2')" >/dev/null
check "both accounts, newest first across them" "n1|second@example.test" "$(as_user $A $AUTH "select email_inbox(null, null, null, 2)" | py "print(d['rows'][0]['provider_id']+'|'+d['rows'][0]['account'])")"
check "one account only, when asked" "m3" "$(as_user $A $AUTH "select email_inbox('{$ACCT}', null, null, 1)" | py "print(d['rows'][0]['provider_id'])")"
FRESH=$(q -c "select last_sync_at from email_account where id='$ACCT2'")
as_user $A $SVC "select email_sync_failed('$A','$ACCT2','Gmail answered 503')" >/dev/null
check "a failed sync records the error and moves nothing" "Gmail answered 503|$FRESH|connected" "$(q -c "select sync_error || '|' || last_sync_at || '|' || state from email_account where id='$ACCT2'")"
check "...and the other account's page is untouched" "n1" "$(as_user $A $AUTH "select email_inbox(null, null, null, 1)" | py "print(d['rows'][0]['provider_id'])")"
as_user $A $SVC "select email_sync_failed('$A','$ACCT2','Reconnect Gmail', true)" >/dev/null
check "a revoked grant is reauth, and its rows still show" "reauth|n1" "$(q -c "select state from email_account where id='$ACCT2'")|$(as_user $A $AUTH "select email_inbox(null, null, null, 1)" | py "print(d['rows'][0]['provider_id'])")"
as_user $A $SVC "select email_account_state('$A','$ACCT2','disconnected')" >/dev/null
check "a disconnected account leaves the page but keeps its cache" "m3|1" "$(as_user $A $AUTH "select email_inbox(null, null, null, 1)" | py "print(d['rows'][0]['provider_id'])")|$(q -c "select count(*) from email_message where account_id='$ACCT2'")"
as_user $A $SVC "select email_account_upsert('$A','second@example.test')" >/dev/null
check "connecting again brings it back" connected "$(q -c "select state from email_account where id='$ACCT2'")"

echo "-- removals and label changes follow the provider"
as_user $A $SVC "select email_sync_apply('$A','$ACCT','[]','{m4}','hist-101')" >/dev/null
check "a removed id is marked gone and leaves the page" "0|t" "$(as_user $A $AUTH "select email_inbox()" | py "print(sum(1 for r in d['rows'] if r['provider_id']=='m4'))")|$(q -c "select deleted_at is not null from email_message where provider_id='m4'")"
MID=$(q -c "select id from email_message where account_id='$ACCT' and provider_id='m1'")
check "the provider's labels replace the cache's" "INBOX" "$(as_user $A $SVC "select email_labels_set('$A','$MID','{INBOX}')" | py "print(','.join(d['labels']))")"
check "...so the row reads as read now" True "$(as_user $A $AUTH "select email_inbox()" | py "print([r['read'] for r in d['rows'] if r['provider_id']=='m1'][0])")"
check "archive: INBOX gone, the row leaves the page, the cache keeps it" "0|1" "$(as_user $A $SVC "select email_labels_set('$A','$MID','{}')" >/dev/null; as_user $A $AUTH "select email_inbox()" | py "print(sum(1 for r in d['rows'] if r['provider_id']=='m1'))")|$(q -c "select count(*) from email_message where id='$MID' and deleted_at is null")"
as_user $A $SVC "select email_labels_set('$A','$MID','{INBOX,UNREAD}')" >/dev/null
check "no receipt was written for a read or a label mirror" 0 "$(q -c "select count(*) from action where owner_id='$A' and created_at > now() - interval '1 minute' and kind in ('mark_read','mark_unread')")"
check "the browser cannot set labels" 42501 "$(as_user_state $A $AUTH "select email_labels_set('$A','$MID','{INBOX}')")"

echo "-- E29: archive and trash are actions with receipts; a repeated tap is the same receipt; read is not one"
R1=$(as_user $A $SVC "select email_action_record('$A','$MID','archive_mail','Archived · Your bill is ready','archive:$MID:1','{\"labelIds\":[\"UNREAD\"]}')")
AID=$(echo "$R1" | jget action_id)
check "an archive receipt: user actor, email surface, confirmed, provider ack, the account as scope" "archive_mail|user|email|confirmed|provider_ack|a@example.test|Archived · Your bill is ready" "$(q -c "select a.kind || '|' || a.actor_kind || '|' || a.surface || '|' || a.state || '|' || r.assurance || '|' || r.scope_summary || '|' || r.exact_verb from action a join receipt_event r on r.action_id = a.id where a.id='$AID'")"
check "the provider's answer rides on the receipt" '{"labelIds": ["UNREAD"]}' "$(q -c "select provider_ack::text from receipt_event where action_id='$AID'")"
check "the same key again is the same action, marked as a replay" "$AID|true" "$(as_user $A $SVC "select email_action_record('$A','$MID','archive_mail','Archived · Your bill is ready','archive:$MID:1')" | py "print(d['action_id']+'|'+str(d['replay']).lower())")"
check "a trash receipt is its own action" "trash_mail|false" "$(as_user $A $SVC "select email_action_record('$A','$MID','trash_mail','Moved to Trash · Your bill is ready','trash:$MID:1')" | py "print('trash_mail|'+str(d['replay']).lower())")"
check "the receipt names the account and the provider id it acted on" "a@example.test|m1" "$(q -c "select (select address from email_account where id = a.provider_account_id) || '|' || (a.authorization_snapshot ->> 'provider_id') from action a where a.id='$AID'")"
check "a read is refused as a receipt kind" INVALID_PAYLOAD "$(as_user $A $SVC "select email_action_record('$A','$MID','mark_read','Read','read:$MID:1')" | jget error)"
check "B's message id is not A's to record" NOT_FOUND "$(as_user $A $SVC "select email_action_record('$A','70000000-0000-0000-0000-00000000000b','archive_mail','Archived','archive:b:1')" | jget error)"
check "the browser cannot write a receipt" 42501 "$(as_user_state $A $AUTH "select email_action_record('$A','$MID','archive_mail','Archived','archive:$MID:9')")"
check "the person sees both in their Email activity, newest first" "trash_mail,archive_mail" "$(as_user $A $AUTH "select activity_feed(10, null, 'email')" | py "print(','.join(r['kind'] for r in d['rows'] if r['kind'] in ('archive_mail','trash_mail')))")"

echo "-- E05: the body, stored once by the server, read with its message"
check "no body yet" "False" "$(as_user $A $AUTH "select email_message_read('$MID')" | jget has_body)"
as_user $A $SVC "select email_body_store('$A','$MID','Amount due \$142.30 by Oct 15. Pay online.','<p>Amount due <b>\$142.30</b></p><script>alert(1)</script>','[{\"filename\":\"bill.pdf\",\"mime\":\"application/pdf\",\"attachmentId\":\"att1\",\"size\":12345}]')" >/dev/null
RD=$(as_user $A $AUTH "select email_message_read('$MID')")
check "the message with its text, its html as sent, its attachments' metadata and its account" "True|a@example.test|bill.pdf|<p>Amount due <b>\$142.30</b></p><script>alert(1)</script>" "$(echo "$RD" | py "print(str(d['has_body'])+'|'+d['account']+'|'+d['attachments'][0]['filename']+'|'+d['html'])")"
check "the list row says it has a body now" True "$(as_user $A $AUTH "select email_inbox()" | py "print([r['has_body'] for r in d['rows'] if r['provider_id']=='m1'][0])")"
check "storing again replaces, never duplicates" 1 "$(as_user $A $SVC "select email_body_store('$A','$MID','Amount due \$142.30 by Oct 15. Pay online at the portal.','<p>x</p>')" >/dev/null; q -c "select count(*) from email_message_body where message_id='$MID'")"
check "B cannot read A's message" NOT_FOUND "$(as_user $B $AUTH "select email_message_read('$MID')" | jget error)"
check "the browser cannot store a body" 42501 "$(as_user_state $A $AUTH "select email_body_store('$A','$MID','x')")"

echo "-- E03: the cached search is literal and says what it covers"
check "a sender hit, newest first" "m1,m-a1" "$(as_user $A $AUTH "select email_search_cached('conedison')" | py "print(','.join(r['provider_id'] for r in d['rows']))")"
check "a body hit, through the stored text alone" "m1" "$(as_user $A $AUTH "select email_search_cached('Pay online')" | py "print(','.join(r['provider_id'] for r in d['rows']))")"
check "a subject hit across accounts, newest first" "n1,m3,m2" "$(as_user $A $AUTH "select email_search_cached('se')" | py "print(','.join(r['provider_id'] for r in d['rows'][:3]))")"
check "wildcards are literal, not wild" 0 "$(as_user $A $AUTH "select email_search_cached('%')" | py "print(len(d['rows']))")"
check "it says it is the cache, and how wide the window is" "cached|7" "$(as_user $A $AUTH "select email_search_cached('a')" | py "print(d['coverage']+'|'+str(d['window']))")"
check "an empty query is an empty answer, not everything" 0 "$(as_user $A $AUTH "select email_search_cached('  ')" | py "print(len(d['rows']))")"
check "B's search over A's words finds nothing" 0 "$(as_user $B $AUTH "select email_search_cached('conedison')" | py "print(len(d['rows']))")"

echo "-- 00.1: the category question is a row the person owns, offered once and answered once"
RULE='{"sender_exact":"billing@conedison.test","account_id":"60000000-0000-0000-0000-00000000000a","category_id":"cat-bills"}'
OF=$(as_user $A $AUTH "select policy_suggestion_offer('$RULE','{t1,t2,t3}')")
SID=$(echo "$OF" | jget suggestion_id)
check "offered: suggested, with the three taps as evidence" "suggested|3" "$(q -c "select status || '|' || cardinality(evidence_tap_ids) from policy_suggestion where id='$SID'")"
check "offered again while open is the same question" "$SID|true" "$(as_user $A $AUTH "select policy_suggestion_offer('$RULE')" | py "print(d['suggestion_id']+'|'+str(d['replay']).lower())")"
check "a rule that is not an exact sender tag is refused" INVALID_PAYLOAD "$(as_user $A $AUTH "select policy_suggestion_offer('{\"sender_exact\":\"\",\"account_id\":\"x\",\"category_id\":\"y\"}')" | jget error)"
check "Remember accepts it" accepted "$(as_user $A $AUTH "select policy_suggestion_answer('$SID','accepted')" | jget status)"
check "answering twice changes nothing" "accepted|true" "$(as_user $A $AUTH "select policy_suggestion_answer('$SID','dismissed')" | py "print(d['status']+'|'+str(d['replay']).lower())")"
check "B cannot answer A's question" NOT_FOUND "$(as_user $B $AUTH "select policy_suggestion_answer('$SID','dismissed')" | jget error)"

echo "-- E04: nothing is hidden by a category: every INBOX row is in the page"
check "All is every cached inbox row" "$(q -c "select count(*) from email_message m join email_account a on a.id=m.account_id where m.owner_id='$A' and m.deleted_at is null and 'INBOX' = any(m.provider_labels) and a.state <> 'disconnected'")" "$(as_user $A $AUTH "select email_inbox(null, null, null, 100)" | py "print(len(d['rows']))")"

echo "-- S16 holds here too: no candidate is created by a sync"
check "the candidate count is the fixture's" 2 "$(q -c "select count(*) from email_candidate where owner_id='$A'")"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "SOME CHECKS FAILED"; exit 1; }
