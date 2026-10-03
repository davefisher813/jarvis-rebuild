#!/usr/bin/env bash
# Real-Postgres proof for migration 0051 (Waiting doors and the Today reads,
# slice 08). Same stubbed Supabase, 0044's fixtures.
#
# Usage: eval "$(./local_pg.sh start)"; ./waiting.sh
#
# What it proves (IMPLEMENTATION-SPEC.md 08 E12 to E15, 12, 13):
#   E13  Resolve changes that one record and writes one receipt; Reopen reverses it; a second tap is the same answer;
#        a record that moved under the person is refused; another owner cannot touch it; nothing sends
#   12   a follow-up date is tracker metadata: set, shown, cleared, with a receipt, and no task or event is made
#   E12  the source and its thread read back with the real Reply-To; a reply is New Reply, never a closure; the evidence
#        keeps its excerpt and says when its source is gone
#   E15  Today's number: actionable cards per card, in mailboxes still here; dismissed, saved and disconnected drop out;
#        another owner's number is their own; no title or amount in the answer
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=waiting_test
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

echo "-- forward: stub + chain 0001..0051, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
FUNCS="'jarvis_waiting_write','waiting_resolve','waiting_reopen','waiting_follow_up','thread_messages','threads_latest','evidence_read','candidate_review_count'"
echo "-- rollback 0051, forward again (idempotent)"
q -f "$here/../rollback/0051_waiting_and_today_down.sql" >/dev/null
check "rollback removes the eight functions" 0 "$(q -c "select count(*) from pg_proc where proname in ($FUNCS)")"
q -f "$here/../migrations/0051_waiting_and_today.sql" >/dev/null
q -f "$here/../migrations/0051_waiting_and_today.sql" >/dev/null
check "forward again is idempotent" 8 "$(q -c "select count(*) from pg_proc where proname in ($FUNCS)")"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
ACCT_A=60000000-0000-0000-0000-00000000000a
M2=70000000-0000-0000-0000-0000000000a2
AUTH=authenticated
SVC=service_role
EV=$(q -c "select id from source_evidence where owner_id='$A' and message_id='$M2' limit 1")
[ -n "$EV" ] || EV=$(q -c "select id from source_evidence where owner_id='$A' limit 1")
W1=b1000000-0000-0000-0000-00000000000a
q -c "insert into item (id, owner_id, entity_type, data) values ('$W1','$A','waiting', jsonb_build_object('title','Peña''s Transcript','waitingFor','the transcript','counterpartyDisplay','Coach Miller','status','open','startedAt','2026-10-02T15:10:00Z','threadId','t-a2','account','a@example.test','sourceEvidenceId','$EV'))" >/dev/null
TASKS_BEFORE=$(q -c "select count(*) from item where owner_id='$A' and entity_type in ('task','event')")
ITEMS_BEFORE=$(q -c "select count(*) from item where owner_id='$A'")

echo "-- E13: Resolve is one record and one receipt; Reopen reverses it"
UPD0=$(q -c "select updated_at from item where id='$W1'")
R1=$(as_user $A $AUTH "select waiting_resolve('$W1','Arrived by post','k-res-1','$UPD0')")
ACT1=$(echo "$R1" | jget action_id)
check "resolved: the record carries the status, the time and the note" "resolved|Arrived by post|true" "$(q -c "select (data->>'status') || '|' || (data->>'resolutionNote') || '|' || (data ? 'resolvedAt')::text from item where id='$W1'")"
check "one action, the person's, on the email surface, confirmed, pointing at the record" "waiting_resolve|user|email|confirmed|$W1" "$(q -c "select kind || '|' || actor_kind || '|' || surface || '|' || state || '|' || destination_id from action where id='$ACT1'")"
check "the receipt says exactly what happened, with the before and after" "Resolved · Peña's Transcript|verified_jarvis|open|resolved" "$(q -c "select exact_verb || '|' || assurance || '|' || (diff->0->>'before') || '|' || (diff->0->>'after') from receipt_event where action_id='$ACT1' order by sequence limit 1")"
check "the answer names the action and the record's new revision" "confirmed|Resolved · Peña's Transcript" "$(echo "$R1" | py "print(d['state']+'|'+d['safe_message'])")"
check "the Activity feed lists it" 1 "$(as_user $A $AUTH "select activity_feed(50,null,'global')" | grep -c "$ACT1")"
check "a second tap with the same key is the same action" "$ACT1|true" "$(as_user $A $AUTH "select waiting_resolve('$W1','Arrived by post','k-res-1')" | py "print(d['action_id']+'|'+str(d.get('replay')).lower())")"
check "resolving a resolved record is the same answer, no new action" "true|1" "$(as_user $A $AUTH "select waiting_resolve('$W1',null,'k-res-2')" | py "print(str(d.get('replay')).lower())")|$(q -c "select count(*) from action where destination_id='$W1'")"
check "B cannot resolve A's record" NOT_FOUND "$(as_user $B $AUTH "select waiting_reopen('$W1')" | jget error)"
check "anon cannot" 42501 "$(as_user_state $A anon "select waiting_reopen('$W1')")"
check "a task is not a waiting record" NOT_FOUND "$(as_user $A $AUTH "select waiting_resolve('20000000-0000-0000-0000-00000000000a')" | jget error)"
check "a record that moved under the person is refused with its revision" DESTINATION_CHANGED "$(as_user $A $AUTH "select waiting_reopen('$W1','k-stale','$UPD0')" | jget error)"
UPD1=$(q -c "select updated_at from item where id='$W1'")
R2=$(as_user $A $AUTH "select waiting_reopen('$W1','k-reopen-1','$UPD1')")
ACT2=$(echo "$R2" | jget action_id)
check "reopened: open again, the note and the time gone" "open|false|false" "$(q -c "select (data->>'status') || '|' || (data ? 'resolvedAt')::text || '|' || (data ? 'resolutionNote')::text from item where id='$W1'")"
check "its own receipt" "Reopened · Peña's Transcript|resolved|open" "$(q -c "select exact_verb || '|' || (diff->0->>'before') || '|' || (diff->0->>'after') from receipt_event where action_id='$ACT2' order by sequence limit 1")"
check "reopening an open record is the same answer" true "$(as_user $A $AUTH "select waiting_reopen('$W1')" | py "print(str(d.get('replay')).lower())")"
check "no mail left: no send_email action and no outbox row came of any of it" "0|0" "$(q -c "select count(*) from action where owner_id='$A' and kind='send_email'")|$(q -c "select count(*) from outbox_command where owner_id='$A'")"

echo "-- 12: a follow-up date is tracker metadata"
R3=$(as_user $A $AUTH "select waiting_follow_up('$W1','2026-10-10','k-fu-1')")
check "set: the date on the record, the receipt naming it" "2026-10-10|Follow Up Oct 10 · Peña's Transcript" "$(q -c "select data->>'followUpOn' from item where id='$W1'")|$(echo "$R3" | jget safe_message)"
check "no task and no event was made of it" "$TASKS_BEFORE" "$(q -c "select count(*) from item where owner_id='$A' and entity_type in ('task','event')")"
check "the same date again is the same answer" true "$(as_user $A $AUTH "select waiting_follow_up('$W1','2026-10-10')" | py "print(str(d.get('replay')).lower())")"
check "cleared: the date gone, said so" "false|Follow Up Cleared · Peña's Transcript" "$(as_user $A $AUTH "select waiting_follow_up('$W1',null,'k-fu-2')" >/dev/null; q -c "select (data ? 'followUpOn')::text from item where id='$W1'")|$(q -c "select exact_verb from receipt_event where action_id=(select id from action where idempotency_key='k-fu-1' and owner_id='$A') limit 0; select exact_verb from receipt_event r join action a on a.id=r.action_id where a.idempotency_key='k-fu-2' and a.owner_id='$A' order by r.sequence limit 1")"
check "the record count never moved: nothing was created by any door" "$ITEMS_BEFORE" "$(q -c "select count(*) from item where owner_id='$A'")"

echo "-- E12: the thread reads back with the real Reply-To; a reply is New Reply, never a closure"
as_user $A $SVC "select email_body_store('$A','$M2','Can you review the transcript by Oct 9?',null,null,'{\"message_id\":\"<m2@example.test>\",\"references\":[],\"reply_to\":\"desk@school.test\"}')" >/dev/null
T=$(as_user $A $AUTH "select thread_messages('t-a2')")
check "the source message with its sender, its account and the Reply-To the body kept" "1|coach@example.test|a@example.test|desk@school.test|false" "$(echo "$T" | py "print(str(len(d))+'|'+d[0]['from_address']+'|'+d[0]['account']+'|'+d[0]['reply_to']+'|'+str(d[0]['deleted']).lower())")"
check "B reads nothing of A's thread" 0 "$(as_user $B $AUTH "select thread_messages('t-a2')" | py "print(len(d))")"
check "before a reply: the latest in the thread is the source itself" "$M2" "$(as_user $A $AUTH "select threads_latest(array['t-a2','t-none'])" | jget t-a2.message_id)"
MR=71000000-0000-0000-0000-0000000000a9
q -c "insert into email_message (id, owner_id, account_id, provider_id, thread_id, internal_date, from_address, from_name, subject, snippet, source_hash) values ('$MR','$A','$ACCT_A','m-a9','t-a2','2026-10-03T16:00:00Z','coach@example.test','Coach Miller','Re: Transcript','Sent it this morning.','sh-a9')" >/dev/null
L=$(as_user $A $AUTH "select threads_latest(array['t-a2','t-none'])")
check "after a reply: the thread's latest is the reply, from the counterparty, and the unknown thread is absent" "$MR|coach@example.test|2026-10-03T16:00:00|false" "$(echo "$L" | py "t=d['t-a2']; print(t['message_id']+'|'+t['from_address']+'|'+t['internal_date'][:19]+'|'+str('t-none' in d).lower())")"
check "...and the record is still open: a reply never resolves anything" open "$(q -c "select data->>'status' from item where id='$W1'")"
check "the thread now reads two messages, newest first" "2|$MR" "$(as_user $A $AUTH "select thread_messages('t-a2')" | py "print(str(len(d))+'|'+d[0]['id'])")"
check "the evidence keeps its excerpt and is available" "available|t" "$(as_user $A $AUTH "select evidence_read('$EV')" | jget availability)|$(as_user $A $AUTH "select evidence_read('$EV')" | py "print('t' if len(d['excerpt'])>0 else 'f')")"
EVM=$(q -c "select message_id from source_evidence where id='$EV'")
q -c "update email_message set deleted_at = now() where id in ('$M2','$EVM')" >/dev/null
check "a deleted source: the evidence says so and keeps the excerpt; the thread read marks the message deleted" "deleted|true" "$(as_user $A $AUTH "select evidence_read('$EV')" | jget availability)|$(as_user $A $AUTH "select thread_messages('t-a2')" | py "print(str([m for m in d if m['id']=='$M2'][0]['deleted']).lower())")"
check "B cannot read A's evidence" NOT_FOUND "$(as_user $B $AUTH "select evidence_read('$EV')" | jget error)"
q -c "update email_message set deleted_at = null where id in ('$M2','$EVM')" >/dev/null

echo "-- E15: Today's number is cards, per card, in mailboxes still here, and nothing else"
check "A's count is the fixture's two proposed cards" "2|2" "$(as_user $A $AUTH "select candidate_review_count()" | py "print(str(d['count'])+'|'+str(d['messages']))")"
check "the answer carries no title, amount or payload" 0 "$(as_user $A $AUTH "select candidate_review_count()" | grep -c "payload\|amount\|title\|issuer")"
REV=$(q -c "select revision from email_candidate where id='90000000-0000-0000-0000-0000000000a2'")
as_user $A $AUTH "select candidate_dismiss('90000000-0000-0000-0000-0000000000a2',$REV)" >/dev/null
check "a dismissed card drops out" 1 "$(as_user $A $AUTH "select candidate_review_count()" | jget count)"
q -c "update email_message set deleted_at = now() where id='70000000-0000-0000-0000-00000000000a'" >/dev/null
check "a card on a message that is gone drops out" 0 "$(as_user $A $AUTH "select candidate_review_count()" | jget count)"
q -c "update email_message set deleted_at = null where id='70000000-0000-0000-0000-00000000000a'" >/dev/null
q -c "update email_account set state='reauth' where id='$ACCT_A'" >/dev/null
check "a mailbox that needs reconnecting still counts (its cache is here)" 1 "$(as_user $A $AUTH "select candidate_review_count()" | jget count)"
q -c "update email_account set state='disconnected' where id='$ACCT_A'" >/dev/null
check "a disconnected mailbox does not" 0 "$(as_user $A $AUTH "select candidate_review_count()" | jget count)"
q -c "update email_account set state='connected' where id='$ACCT_A'" >/dev/null
check "B's number is B's own" 1 "$(as_user $B $AUTH "select candidate_review_count()" | jget count)"
check "anon has no number" 42501 "$(as_user_state $A anon "select candidate_review_count()")"

if [ "$fail" = 0 ]; then echo "ALL OK"; else echo "SOME FAILED"; exit 1; fi
