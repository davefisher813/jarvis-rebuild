#!/usr/bin/env bash
# Real-Postgres proof for migration 0069 (a paused send can be opened, saved and reviewed again; Email v1 spec
# 2026-10-08 section 9.1).
#
# Usage: eval "$(./local_pg.sh start)"; ./paused_resave.sh
#
# What it proves:
#   a draft stuck 'sending' behind a command that never reached Gmail (outbox failed or cancelled, never dispatched)
#     saves again, reviews again, and a new approval gets a NEW action and a NEW 30-second hold; the old attempt is untouched
#   draft_reopen releases it atomically ('failed', the action kept as history) and the paused list still shows it
#   a dispatched command, an unknown outcome and a held command are NEVER released: save, review and discard refuse
#   the worker's claim settles the draft in the same transaction when it refuses (PROVIDER_AUTH, APPROVAL_EXPIRED)
#   a stuck draft can be discarded; another owner cannot touch it; the browser cannot call the release itself
#   rollback puts the old bodies back (the stuck draft is refused again) and forward runs again
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=paused_resave_test
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

echo "-- forward: stub + chain, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
check "0069 forwards twice (idempotent)" ok "$(q -f "$here/../migrations/0069_email_paused_resave.sql" >/dev/null && echo ok)"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
ACCT_A=60000000-0000-0000-0000-00000000000a
AUTH=authenticated
SVC=service_role
FIELDS='{"to_addresses":["coach@example.test"],"subject":"Re: Transcript","body_text":"On it.","reply_headers":{"in_reply_to":"<m2@example.test>","references":[],"thread_id":"t-a2"},"thread_id":"t-a2"}'
EDITED='{"to_addresses":["coach@example.test"],"subject":"Re: Transcript","body_text":"On it, sending today.","reply_headers":{"in_reply_to":"<m2@example.test>","references":[],"thread_id":"t-a2"},"thread_id":"t-a2"}'

held() { # a new draft, reviewed and approved with the hold: prints "draft_id action_id"
  local s d rv n h x
  s=$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','$FIELDS')")
  d=$(echo "$s" | jget draft_id)
  rv=$(as_user $A $AUTH "select send_review('$d')")
  n=$(echo "$rv" | jget review.review_nonce); h=$(echo "$rv" | jget review.payload_hash); x=$(echo "$rv" | jget review.action_id)
  as_user $A $AUTH "select send_approve_held('$d','$n','$h','k-$1')" >/dev/null
  echo "$d $x"
}
# The defect's shape: the claim wrote the outbox row and the draft stayed 'sending' (the later settle never ran).
stick() { q -c "update outbox_command set state = '$2', error_code = '$3' where action_id = '$1'" >/dev/null; }
draft_state() { q -c "select send_state || '|' || coalesce(sent_action_id::text,'') from email_draft where id='$1'"; }

echo "-- the defect: a stuck draft (PROVIDER_AUTH, never dispatched) saves, reviews and holds again"
read -r D1 X1 <<<"$(held one)"
stick "$X1" failed PROVIDER_AUTH
check "stuck: the draft is still 'sending' behind a failed command" "sending|$X1" "$(draft_state $D1)"
check "it is on the paused list" "1|PROVIDER_AUTH" "$(as_user $A $AUTH "select paused_sends()" | jget count)|$(as_user $A $AUTH "select paused_sends()" | jget drafts.0.paused_reason)"
REV1=$(q -c "select revision from email_draft where id='$D1'")
S1=$(as_user $A $AUTH "select draft_save('$D1','$ACCT_A','$EDITED',$REV1)")
check "saving it is no longer DRAFT_SENT: it is a draft again, the words saved" "draft|On it, sending today." "$(echo "$S1" | jget send_state)|$(q -c "select body_text from email_draft where id='$D1'")"
RV1=$(as_user $A $AUTH "select send_review('$D1')")
X1B=$(echo "$RV1" | jget review.action_id)
check "Review Send makes a NEW action" "true" "$([ -n "$X1B" ] && [ "$X1B" != "$X1" ] && echo true || echo false)"
AP1=$(as_user $A $AUTH "select send_approve_held('$D1','$(echo "$RV1" | jget review.review_nonce)','$(echo "$RV1" | jget review.payload_hash)','k-one-again')")
check "the approval is a fresh hold on the new action" "$X1B|queued|true" "$(echo "$AP1" | jget action_id)|$(echo "$AP1" | jget outbox_state)|$([ -n "$(echo "$AP1" | jget hold_until)" ] && echo true || echo false)"
check "the draft is sending, bound to the new action" "sending|$X1B" "$(draft_state $D1)"
check "the prior attempt is untouched (failed, PROVIDER_AUTH, never dispatched)" "failed|PROVIDER_AUTH|" "$(q -c "select state || '|' || error_code || '|' || coalesce(dispatched_at::text,'') from outbox_command where action_id='$X1'")"

echo "-- opening from the paused list releases it atomically (APPROVAL_EXPIRED, cancelled)"
read -r D2 X2 <<<"$(held two)"
stick "$X2" cancelled APPROVAL_EXPIRED
O2=$(as_user $A $AUTH "select draft_reopen('$D2')")
check "draft_reopen: released, editable, 'failed', the old action kept as history" "True|True|failed|$X2" "$(echo "$O2" | jget released)|$(echo "$O2" | jget editable)|$(echo "$O2" | jget send_state)|$(echo "$O2" | jget sent_action_id)"
check "the words come back with it" "On it." "$(echo "$O2" | jget body_text)"
check "it stays on the paused list until it is saved or reviewed" "APPROVAL_EXPIRED" "$(as_user $A $AUTH "select paused_sends()" | python3 -c "import json,sys; d=json.load(sys.stdin); print(','.join(x['paused_reason'] for x in d['drafts'] if x['id']=='$D2'))")"
check "a second open is the same answer (nothing more to release)" "false|true|failed" "$(as_user $A $AUTH "select draft_reopen('$D2')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d['released']).lower()+'|'+str(d['editable']).lower()+'|'+d['send_state'])")"
check "the revision did not move (the device's revision still saves)" "$(q -c "select revision from email_draft where id='$D2'")" "$(echo "$O2" | jget revision)"

echo "-- Review Send straight from a stuck draft (no save first) works too"
read -r D3 X3 <<<"$(held three)"
stick "$X3" cancelled NOT_APPROVED
RV3=$(as_user $A $AUTH "select send_review('$D3')")
check "send_review releases and reviews" "true" "$([ -n "$(echo "$RV3" | jget review.action_id)" ] && echo true || echo false)"

echo "-- never released: dispatched, unknown, held"
read -r D4 X4 <<<"$(held four)"
q -c "update outbox_command set state = 'failed', error_code = 'GMAIL_400', dispatched_at = now() where action_id = '$X4'" >/dev/null
check "a command that was dispatched stays the send's: save refuses" "DRAFT_SENT" "$(as_user $A $AUTH "select draft_save('$D4','$ACCT_A','$EDITED')" | jget error)"
check "...draft_reopen says not editable and changes nothing" "false|false|sending" "$(as_user $A $AUTH "select draft_reopen('$D4')" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d['released']).lower()+'|'+str(d['editable']).lower()+'|'+d['send_state'])")"
read -r D5 X5 <<<"$(held five)"
q -c "update outbox_command set state = 'outcome_unknown', error_code = 'OUTCOME_UNKNOWN', dispatched_at = now() where action_id = '$X5'" >/dev/null
check "an unknown outcome is never resendable: save, review and discard refuse" "DRAFT_SENT|DRAFT_SENT|DRAFT_SENT" "$(as_user $A $AUTH "select draft_save('$D5','$ACCT_A','$EDITED')" | jget error)|$(as_user $A $AUTH "select send_review('$D5')" | jget error)|$(as_user $A $AUTH "select draft_discard('$D5')" | jget error)"
check "...and it is still 'sending'" "sending|$X5" "$(draft_state $D5)"
read -r D6 X6 <<<"$(held six)"
check "a held command (queued) is not released: save refuses, reopen not editable" "DRAFT_SENT|False" "$(as_user $A $AUTH "select draft_save('$D6','$ACCT_A','$EDITED')" | jget error)|$(as_user $A $AUTH "select draft_reopen('$D6')" | jget editable)"
check "...and the hold is still queued" "queued" "$(q -c "select state from outbox_command where action_id='$X6'")"

echo "-- the claim settles its draft when it refuses"
read -r D7 X7 <<<"$(held seven)"
q -c "update outbox_command set hold_until = now() - interval '1 second', dispatch_deadline = now() + interval '29 seconds' where action_id='$X7'" >/dev/null
q -c "update email_account set state = 'reauth' where id = '$ACCT_A'" >/dev/null
check "PROVIDER_AUTH at claim: the draft is 'failed' in the same transaction, the action kept" "PROVIDER_AUTH|failed|$X7" "$(as_user $A $SVC "select outbox_claim_action('test','$X7')" | jget reason)|$(draft_state $D7)"
q -c "update email_account set state = 'connected' where id = '$ACCT_A'" >/dev/null
read -r D8 X8 <<<"$(held eight)"
q -c "update outbox_command set hold_until = null, dispatch_deadline = null where action_id='$X8'" >/dev/null
q -c "update approval set consumed_at = now() - interval '6 minutes' where action_id='$X8'" >/dev/null
check "APPROVAL_EXPIRED at claim: the draft is 'failed' too" "APPROVAL_EXPIRED|failed|$X8" "$(as_user $A $SVC "select outbox_claim_action('test','$X8')" | jget reason)|$(draft_state $D8)"
check "the worker's later settle (draft_outcome) agrees" "failed" "$(as_user $A $SVC "select draft_outcome('$X8','failed')" | jget send_state)"

echo "-- discard, owners, roles"
read -r D9 X9 <<<"$(held nine)"
stick "$X9" failed PROVIDER_AUTH
check "another owner cannot open it" NOT_FOUND "$(as_user $B $AUTH "select draft_reopen('$D9')" | jget error)"
check "...and opening it did not release it" "sending|$X9" "$(draft_state $D9)"
check "the owner can discard a stuck draft" "True" "$(as_user $A $AUTH "select draft_discard('$D9')" | jget discarded)"
check "the browser cannot call the release itself" 42501 "$(as_user_state $A $AUTH "select jarvis_draft_release_paused('$A','$D9')")"
check "anon cannot reopen" 42501 "$(as_user_state $A anon "select draft_reopen('$D9')")"

echo "-- rollback: the old bodies are back"
read -r D10 X10 <<<"$(held ten)"
stick "$X10" failed PROVIDER_AUTH
q -f "$here/../rollback/0069_email_paused_resave_down.sql" >/dev/null
check "the two new functions are gone" 0 "$(q -c "select count(*) from pg_proc where proname in ('draft_reopen','jarvis_draft_release_paused')")"
check "the old draft_save refuses the stuck draft again (the defect, as it was)" DRAFT_SENT "$(as_user $A $AUTH "select draft_save('$D10','$ACCT_A','$EDITED')" | jget error)"
q -f "$here/../migrations/0069_email_paused_resave.sql" >/dev/null
check "forward again after a rollback, and the stuck draft saves" "draft" "$(as_user $A $AUTH "select draft_save('$D10','$ACCT_A','$EDITED')" | jget send_state)"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILURES"; exit 1; }
