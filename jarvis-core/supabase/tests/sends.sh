#!/usr/bin/env bash
# Real-Postgres proof for migration 0050 (compose, replies and the exact send,
# slice 07). Same stubbed Supabase, 0044's fixtures.
#
# Usage: eval "$(./local_pg.sh start)"; ./sends.sh
#
# What it proves (IMPLEMENTATION-SPEC.md 07.3, 08 E16 to E19, 11; API-AND-VALIDATION.md Send):
#   E17  the cached body keeps the headers a reply needs, and the message read carries them
#   E16  a draft saves with the revision the device last saw; a different one is a conflict with both copies, never a silent overwrite;
#        a draft's fields are checked; another owner reads nothing; discard returns the copy
#   E18  the review is built from the row (Bcc in the snapshot and the hash, the From identity the account's, every address checked and
#        normalised, no header breaks, attachments owned and hashed, empty subject and body as warnings); the tap consumes the review once;
#        a second tap is the same action; an edit after the review is REVIEW_CHANGED; a second review cannot send a sent draft; an expired
#        approval is refused and the draft stays a draft; a wrong hash is refused
#   07.3 the worker's path: claim, dispatch, settle, the draft marked sent with the provider's id; a failure before dispatch frees the draft;
#        an unknown outcome blocks it until reconciled with evidence
#   E19  the list: drafts and failed sends newest saved first; sends newest first with the action's state
#   S16  nothing here writes an item; the browser cannot call the worker's function
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=sends_test
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

echo "-- forward: stub + chain 0001..0050, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
FUNCS="'draft_save','draft_get','draft_list','draft_discard','send_review','send_approve','draft_outcome','outbox_claim_action'"
echo "-- rollback 0050, forward again (idempotent)"
q -f "$here/../rollback/0050_compose_and_send_down.sql" >/dev/null
check "rollback removes the eight functions and the headers column" "0|0" "$(q -c "select count(*) from pg_proc where proname in ($FUNCS)")|$(q -c "select count(*) from information_schema.columns where table_name='email_message_body' and column_name='reply_headers'")"
check "rollback leaves one body store, the five-argument one" "1|5" "$(q -c "select count(*) || '|' || string_agg(pronargs::text, ',') from pg_proc where proname='email_body_store'")"
q -f "$here/../migrations/0050_compose_and_send.sql" >/dev/null
q -f "$here/../migrations/0050_compose_and_send.sql" >/dev/null
check "forward again is idempotent: eight functions, one body store with six arguments" "8|1|6" "$(q -c "select count(*) from pg_proc where proname in ($FUNCS)")|$(q -c "select count(*) || '|' || string_agg(pronargs::text, ',') from pg_proc where proname='email_body_store'")"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
ACCT_A=60000000-0000-0000-0000-00000000000a
ACCT_B=60000000-0000-0000-0000-00000000000b
M1=70000000-0000-0000-0000-00000000000a
D0=f2000000-0000-0000-0000-00000000000a
AUTH=authenticated
SVC=service_role
ITEMS_BEFORE=$(q -c "select count(*) from item where owner_id='$A'")

echo "-- E17: the body keeps the reply headers; the read carries them"
as_user $A $SVC "select email_body_store('$A','$M1','Amount due 142.30','<p>x</p>','[]','{\"message_id\":\"<m1@conedison.test>\",\"references\":[\"<m0@conedison.test>\"],\"reply_to\":\"billing@conedison.test\"}')" >/dev/null
check "the read carries the message id, the references and the reply-to" "<m1@conedison.test>|1|billing@conedison.test" "$(as_user $A $AUTH "select email_message_read('$M1')" | py "h=d['reply_headers']; print(h['message_id']+'|'+str(len(h['references']))+'|'+h['reply_to'])")"
as_user $A $SVC "select email_body_store('$A','$M1','Amount due 142.30 (again)')" >/dev/null
check "storing the body again without headers keeps the headers it had" "<m1@conedison.test>" "$(as_user $A $AUTH "select email_message_read('$M1')" | jget reply_headers.message_id)"
check "the browser cannot store a body" 42501 "$(as_user_state $A $AUTH "select email_body_store('$A','$M1','x')")"

echo "-- E16: drafts save by revision; a conflict returns both copies; the fields are checked"
S1=$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"to_addresses\":[\"Coach@Example.TEST\"],\"subject\":\"Re: Transcript\",\"body_text\":\"On it.\",\"thread_id\":\"t-a2\",\"reply_headers\":{\"in_reply_to\":\"<m2@example.test>\",\"references\":[\"<m2@example.test>\"],\"thread_id\":\"t-a2\"}}')")
D1=$(echo "$S1" | jget draft_id)
check "a new draft: revision 1, a draft" "1|draft" "$(echo "$S1" | py "print(str(d['revision'])+'|'+d['send_state'])")"
S2=$(as_user $A $AUTH "select draft_save('$D1','$ACCT_A','{\"to_addresses\":[\"Coach@Example.TEST\"],\"bcc_addresses\":[\"me@example.test\"],\"subject\":\"Re: Transcript\",\"body_text\":\"On it. Sending tonight.\",\"thread_id\":\"t-a2\",\"reply_headers\":{\"in_reply_to\":\"<m2@example.test>\",\"references\":[\"<m2@example.test>\"],\"thread_id\":\"t-a2\"}}',1)")
check "saving at the revision the device saw: revision 2" 2 "$(echo "$S2" | jget revision)"
S3=$(as_user $A $AUTH "select draft_save('$D1','$ACCT_A','{\"to_addresses\":[\"Coach@Example.TEST\"],\"subject\":\"Re: Transcript\",\"body_text\":\"Older words from another phone.\"}',1)")
check "saving at a revision that moved on is a conflict carrying the server's copy" "DRAFT_CONFLICT|2|On it. Sending tonight." "$(echo "$S3" | py "print(d['error']+'|'+str(d['revision'])+'|'+d['draft']['body_text'])")"
check "...and the server's copy is untouched" "On it. Sending tonight." "$(q -c "select body_text from email_draft where id='$D1'")"
check "a save with no revision is a plain save (Use Newer Draft re-reads; Keep This Draft saves at the new revision)" 3 "$(as_user $A $AUTH "select draft_save('$D1','$ACCT_A','{\"to_addresses\":[\"Coach@Example.TEST\"],\"bcc_addresses\":[\"me@example.test\"],\"subject\":\"Re: Transcript\",\"body_text\":\"On it. Sending tonight.\",\"thread_id\":\"t-a2\",\"reply_headers\":{\"in_reply_to\":\"<m2@example.test>\",\"references\":[\"<m2@example.test>\"],\"thread_id\":\"t-a2\"}}')" | jget revision)"
check "a subject with a header break is refused" "INVALID_PAYLOAD|subject" "$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"to_addresses\":[],\"subject\":\"Hi\\r\\nBcc: x@y.test\"}')" | py "print(d['error']+'|'+d['detail'])")"
check "an address with a header break is refused" "INVALID_PAYLOAD|to_addresses" "$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"to_addresses\":[\"a@b.test\\nCc: c@d.test\"]}')" | py "print(d['error']+'|'+d['detail'])")"
check "an attachment ref with a bad hash is refused" "INVALID_PAYLOAD|attachment_refs" "$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"attachment_refs\":[{\"storage_id\":\"$A/d/f.pdf\",\"filename\":\"f.pdf\",\"size_bytes\":10,\"sha256\":\"nope\"}]}')" | py "print(d['error']+'|'+d['detail'])")"
check "a body over the review's limit is refused at the save, with the field named" "INVALID_PAYLOAD|body_text" "$(as_user $A $AUTH "select draft_save(null,'$ACCT_A',jsonb_build_object('body_text', repeat('x', 60001)))" | py "print(d['error']+'|'+d['detail'])")"
check "another owner's account is not a home for a draft" PROVIDER_AUTH "$(as_user $A $AUTH "select draft_save(null,'$ACCT_B','{\"to_addresses\":[]}')" | jget error)"
check "B cannot read A's draft" NOT_FOUND "$(as_user $B $AUTH "select draft_get('$D1')" | jget error)"
check "B cannot save over A's draft" NOT_FOUND "$(as_user $B $AUTH "select draft_save('$D1','$ACCT_B','{\"subject\":\"mine now\"}')" | jget error)"
check "anon cannot save a draft" 42501 "$(as_user_state $A anon "select draft_save(null,'$ACCT_A','{}')")"
check "A reads the draft back with its account and its revision" "a@example.test|3|me@example.test" "$(as_user $A $AUTH "select draft_get('$D1')" | py "print(d['account']+'|'+str(d['revision'])+'|'+d['bcc_addresses'][0])")"
S4=$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"to_addresses\":[\"x@example.test\"],\"subject\":\"Scratch\"}')")
D4=$(echo "$S4" | jget draft_id)
check "the list has the fixture's draft and the two new ones, newest saved first" "$D4|$D1" "$(as_user $A $AUTH "select draft_list()" | py "print(d['drafts'][0]['id']+'|'+d['drafts'][1]['id'])")"
R=$(as_user $A $AUTH "select draft_discard('$D4')")
check "discard returns the copy and the row is gone" "true|Scratch|0" "$(echo "$R" | py "print(str(d['discarded']).lower()+'|'+d['draft']['subject'])")|$(q -c "select count(*) from email_draft where id='$D4'")"

echo "-- E18: the review is built from the row; the tap consumes it once"
RV1=$(as_user $A $AUTH "select send_review('$D1',3)")
H1=$(echo "$RV1" | jget review.payload_hash)
N1=$(echo "$RV1" | jget review.review_nonce)
check "the review: a 64-char hash, a nonce, an expiry, the outbox row reviewed" "64|reviewed" "$(echo "$RV1" | py "print(len(d['review']['payload_hash']))")|$(q -c "select state from outbox_command where action_id='$(echo "$RV1" | jget review.action_id)'")"
check "the snapshot: the From identity is the account's, the domain lowercased, Bcc inside, the draft revision bound" "a@example.test|Coach@example.test|me@example.test|3" "$(echo "$RV1" | py "e=d['exact']; print(e['from_identity']+'|'+e['to'][0]+'|'+e['bcc'][0]+'|'+str(e['draft_revision']))")"
check "the snapshot carries the reply headers and a deterministic client message id" "<m2@example.test>|t-a2|<$D1.3@jarvis.local>" "$(echo "$RV1" | py "e=d['exact']; print(e['reply_headers']['in_reply_to']+'|'+e['reply_headers']['thread_id']+'|'+e['client_message_id'])")"
check "the verb is the receipt's exact line, counting Bcc" "Sent Reply to Coach@example.test and 1 More" "$(echo "$RV1" | jget verb)"
check "no warnings when subject and body are there" 0 "$(echo "$RV1" | py "print(len(d['warnings']))")"
check "a review at a revision that moved on is a conflict" DRAFT_CONFLICT "$(as_user $A $AUTH "select send_review('$D1',2)" | jget error)"
RV1B=$(as_user $A $AUTH "select send_review('$D1',3)")
check "the same draft reviewed again has the same hash and a new nonce" "same|new" "$([ "$(echo "$RV1B" | jget review.payload_hash)" = "$H1" ] && echo same || echo different)|$([ "$(echo "$RV1B" | jget review.review_nonce)" != "$N1" ] && echo new || echo same)"
S5=$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"to_addresses\":[\"not an address\"],\"subject\":\"x\",\"body_text\":\"y\"}')")
D5=$(echo "$S5" | jget draft_id)
check "an address that is not one refuses the review and names the line" "INVALID_PAYLOAD|to" "$(as_user $A $AUTH "select send_review('$D5')" | py "print(d['error']+'|'+d['detail'])")"
as_user $A $AUTH "select draft_save('$D5','$ACCT_A','{\"to_addresses\":[],\"cc_addresses\":[\"cc@example.test\"],\"subject\":\"x\",\"body_text\":\"y\"}')" >/dev/null
check "Cc alone is not a recipient: To is required" "MISSING_DETAILS|to" "$(as_user $A $AUTH "select send_review('$D5')" | py "print(d['error']+'|'+d['missing'][0])")"
as_user $A $AUTH "select draft_save('$D5','$ACCT_A','{\"to_addresses\":[\"to@example.test\"],\"subject\":\"\",\"body_text\":\"\"}')" >/dev/null
check "empty subject and empty body are warnings on the review, not text the server makes up" "empty_subject,empty_body||" "$(as_user $A $AUTH "select send_review('$D5')" | py "print(','.join(d['warnings'])+'|'+d['exact']['subject']+'|'+d['exact']['body_text'])")"
as_user $A $AUTH "select draft_save('$D5','$ACCT_A','{\"to_addresses\":[\"to@example.test\"],\"subject\":\"Hi\",\"body_text\":\"y\",\"attachment_refs\":[{\"storage_id\":\"$B/d/f.pdf\",\"filename\":\"f.pdf\",\"size_bytes\":10,\"sha256\":\"$(printf 'a%.0s' $(seq 1 64))\",\"mime_type\":\"application/pdf\"}]}')" >/dev/null
check "an attachment under another owner's folder is refused" "INVALID_PAYLOAD|attachment" "$(as_user $A $AUTH "select send_review('$D5')" | py "print(d['error']+'|'+d['detail'])")"
check "a path that starts in the owner's folder but folds out of it (\"..\") is refused at save" "INVALID_PAYLOAD|attachment_refs" "$(as_user $A $AUTH "select draft_save('$D5','$ACCT_A','{\"to_addresses\":[\"to@example.test\"],\"subject\":\"Hi\",\"body_text\":\"y\",\"attachment_refs\":[{\"storage_id\":\"$A/../$B/d/f.pdf\",\"filename\":\"f.pdf\",\"size_bytes\":10,\"sha256\":\"$(printf 'a%.0s' $(seq 1 64))\",\"mime_type\":\"application/pdf\"}]}')" | py "print(d['error']+'|'+d['detail'])")"
as_user $A $AUTH "select draft_save('$D5','$ACCT_A','{\"to_addresses\":[\"to@example.test\"],\"subject\":\"Hi\",\"body_text\":\"y\",\"attachment_refs\":[{\"storage_id\":\"$A/d/f.pdf\",\"filename\":\"f.pdf\",\"size_bytes\":10}]}')" >/dev/null
check "an attachment still uploading (no hash yet) is refused: the review waits for every attachment" "INVALID_PAYLOAD|attachment" "$(as_user $A $AUTH "select send_review('$D5')" | py "print(d['error']+'|'+d['detail'])")"
as_user $A $AUTH "select draft_save('$D5','$ACCT_A','{\"to_addresses\":[\"to@example.test\"],\"subject\":\"Hi\",\"body_text\":\"y\",\"attachment_refs\":[{\"storage_id\":\"$A/d/f.pdf\",\"filename\":\"f.pdf\",\"size_bytes\":15000000,\"sha256\":\"$(printf 'a%.0s' $(seq 1 64))\"},{\"storage_id\":\"$A/d/g.pdf\",\"filename\":\"g.pdf\",\"size_bytes\":6000000,\"sha256\":\"$(printf 'b%.0s' $(seq 1 64))\"}]}')" >/dev/null
check "attachments over 20 MB together are refused" "INVALID_PAYLOAD|attachments_size" "$(as_user $A $AUTH "select send_review('$D5')" | py "print(d['error']+'|'+d['detail'])")"
as_user $A $AUTH "select draft_save('$D5','$ACCT_A','{\"to_addresses\":[\"to@example.test\"],\"subject\":\"Hi\",\"body_text\":\"y\",\"attachment_refs\":[{\"storage_id\":\"$A/d/f.pdf\",\"filename\":\"f.pdf\",\"size_bytes\":1500,\"sha256\":\"$(printf 'a%.0s' $(seq 1 64))\",\"mime_type\":\"application/pdf\"}]}')" >/dev/null
check "an owned, hashed attachment rides in the snapshot with its hash" "f.pdf|1500" "$(as_user $A $AUTH "select send_review('$D5')" | py "a=d['exact']['attachments'][0]; print(a['filename']+'|'+str(a['size_bytes']))")"
check "a header break planted past the save is caught at the review" "INVALID_PAYLOAD|subject" "$(q -c "update email_draft set subject = E'Hi\\nBcc: z@example.test' where id='$D5'" >/dev/null; as_user $A $AUTH "select send_review('$D5')" | py "print(d['error']+'|'+d['detail'])")"
q -c "update email_draft set subject = 'Hi' where id='$D5'" >/dev/null
check "B cannot review A's draft" NOT_FOUND "$(as_user $B $AUTH "select send_review('$D1')" | jget error)"
check "a review names a connected account only" PROVIDER_AUTH "$(q -c "update email_account set state='reauth' where id='$ACCT_A'" >/dev/null; as_user $A $AUTH "select send_review('$D1')" | jget error)"
q -c "update email_account set state='connected' where id='$ACCT_A'" >/dev/null

echo "-- E18: the tap"
check "a wrong hash is refused before anything is consumed" REVIEW_CHANGED "$(as_user $A $AUTH "select send_approve('$D1','$N1','deadbeef','k-wrong')" | jget error)"
check "another draft's nonce is refused" "REVIEW_CHANGED|draft" "$(as_user $A $AUTH "select send_approve('$D5','$N1','$H1','k-other')" | py "print(d['error']+'|'+d['detail'])")"
check "B cannot tap A's review" NOT_FOUND "$(as_user $B $AUTH "select send_approve('$D1','$N1','$H1','k-b')" | jget error)"
AP1=$(as_user $A $AUTH "select send_approve('$D1','$N1','$H1','k-1')")
ACT1=$(echo "$AP1" | jget action_id)
check "the tap: approved, the outbox queued, the draft sending with its action" "approved|queued|sending|$ACT1" "$(echo "$AP1" | jget state)|$(q -c "select state from outbox_command where action_id='$ACT1'")|$(q -c "select send_state || '|' || sent_action_id from email_draft where id='$D1'")"
check "the tap leaves the revision where the review bound it (the dispatch compares the two)" "$(echo "$RV1" | py "print(d['exact']['draft_revision'])")" "$(q -c "select revision from email_draft where id='$D1'")"
check "a second tap on the same review is the same action, replayed" "$ACT1|true" "$(as_user $A $AUTH "select send_approve('$D1','$N1','$H1','k-2')" | py "print(d['action_id']+'|'+str(d.get('replay')).lower())")"
check "the other review of the same draft cannot send it again" "DRAFT_SENT|sending" "$(as_user $A $AUTH "select send_approve('$D1','$(echo "$RV1B" | jget review.review_nonce)','$H1','k-3')" | py "print(d['error']+'|'+d['send_state'])")"
check "a sending draft is not the browser's to edit, review or discard" "DRAFT_SENT|DRAFT_SENT|DRAFT_SENT" "$(as_user $A $AUTH "select draft_save('$D1','$ACCT_A','{\"subject\":\"late edit\"}')" | jget error)|$(as_user $A $AUTH "select send_review('$D1')" | jget error)|$(as_user $A $AUTH "select draft_discard('$D1')" | jget error)"
check "exactly one action was approved for the draft" 1 "$(q -c "select count(*) from action where owner_id='$A' and kind='send_email' and state='approved'")"

echo "-- E18: an edit after the review invalidates it; an expired approval is refused"
RV5=$(as_user $A $AUTH "select send_review('$D5')")
as_user $A $AUTH "select draft_save('$D5','$ACCT_A','{\"to_addresses\":[\"to@example.test\",\"second@example.test\"],\"subject\":\"Hi\",\"body_text\":\"y\"}')" >/dev/null
check "a recipient added after the review: the tap is refused, the draft stays a draft" "REVIEW_CHANGED|revision|draft" "$(as_user $A $AUTH "select send_approve('$D5','$(echo "$RV5" | jget review.review_nonce)','$(echo "$RV5" | jget review.payload_hash)','k-5')" | py "print(d['error']+'|'+d['detail'])")|$(q -c "select send_state from email_draft where id='$D5'")"
RV5B=$(as_user $A $AUTH "select send_review('$D5')")
q -c "update approval set granted_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes' where nonce='$(echo "$RV5B" | jget review.review_nonce)'" >/dev/null
check "an expired approval: refused, the draft stays a draft, the review cancelled" "APPROVAL_EXPIRED|draft|cancelled" "$(as_user $A $AUTH "select send_approve('$D5','$(echo "$RV5B" | jget review.review_nonce)','$(echo "$RV5B" | jget review.payload_hash)','k-6')" | jget error)|$(q -c "select send_state from email_draft where id='$D5'")|$(q -c "select state from outbox_command where action_id='$(echo "$RV5B" | jget review.action_id)'")"
check "an unknown nonce is not found" NOT_FOUND "$(as_user $A $AUTH "select send_approve('$D5','no-such-nonce','x','k-7')" | jget error)"

echo "-- 07.3: the worker's path; sent with the provider's id"
check "the browser cannot claim" 42501 "$(as_user_state $A $AUTH "select outbox_claim_action('w-x','$ACT1')")"
check "a claim for an action that is not queued is nothing" "" "$(as_user $A $SVC "select outbox_claim_action('w-1','$D1')")"
CL=$(as_user $A $SVC "select outbox_claim_action('w-1','$ACT1')")
OB1=$(echo "$CL" | jget outbox_id)
check "the same action cannot be claimed twice while the lease holds" "" "$(as_user $A $SVC "select outbox_claim_action('w-2','$ACT1')")"
check "the worker claims the queued send with the snapshot it will send" "$ACT1|send_email|$D1|me@example.test" "$(echo "$CL" | py "print(d['action_id']+'|'+d['kind']+'|'+d['payload']['draft_id']+'|'+d['payload']['bcc'][0])")"
TOK=$(echo "$CL" | jget claim_token)
check "the one-way mark" t "$(as_user $A $SVC "select outbox_dispatched('$OB1','$TOK')")"
check "the provider's answer settles it confirmed with a provider_ack receipt" "confirmed" "$(as_user $A $SVC "select outbox_settle('$OB1','$TOK','confirmed','Sent Reply to Coach@example.test and 1 More','{\"provider\":\"gmail\",\"message_id\":\"gm-77\",\"thread_id\":\"t-a2\",\"accepted_at\":\"2026-10-03T16:00:00Z\"}')" | jget state)"
check "the browser cannot mark a draft's outcome" 42501 "$(as_user_state $A $AUTH "select draft_outcome('$ACT1','confirmed','gm-77')")"
check "the draft is sent, with the provider's id" "sent|gm-77" "$(as_user $A $SVC "select draft_outcome('$ACT1','confirmed','gm-77')" | jget send_state)|$(q -c "select provider_message_id from email_draft where id='$D1'")"
check "settling the send leaves the revision alone (a settled send is not a conflict on the device)" "$(echo "$RV1" | py "print(d['exact']['draft_revision'])")" "$(q -c "select revision from email_draft where id='$D1'")"
check "the sent list carries it first with the action's state and the provider's answer" "$D1|sent|confirmed|gm-77" "$(as_user $A $AUTH "select draft_list()" | py "s=d['sent'][0]; print(s['id']+'|'+s['send_state']+'|'+s['action_state']+'|'+s['provider_ack']['message_id'])")"
check "a sent draft stays sent: no edit, no review, no discard, no second outcome" "DRAFT_SENT|DRAFT_SENT|DRAFT_SENT|INVALID_PAYLOAD" "$(as_user $A $AUTH "select draft_save('$D1','$ACCT_A','{\"subject\":\"x\"}')" | jget error)|$(as_user $A $AUTH "select send_review('$D1')" | jget error)|$(as_user $A $AUTH "select draft_discard('$D1')" | jget error)|$(as_user $A $SVC "select draft_outcome('$ACT1','failed')" | jget error)"
check "the tap replays after the send too, never a second send" "$ACT1|true|sent" "$(as_user $A $AUTH "select send_approve('$D1','$N1','$H1','k-8')" | py "print(d['action_id']+'|'+str(d.get('replay')).lower()+'|'+d['send_state'])")"

echo "-- 07.3: a failure before dispatch frees the draft; an unknown outcome blocks it until evidence"
S6=$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"to_addresses\":[\"fail@example.test\"],\"subject\":\"Will fail\",\"body_text\":\"y\"}')")
D6=$(echo "$S6" | jget draft_id)
RV6=$(as_user $A $AUTH "select send_review('$D6')")
AP6=$(as_user $A $AUTH "select send_approve('$D6','$(echo "$RV6" | jget review.review_nonce)','$(echo "$RV6" | jget review.payload_hash)','k-9')")
ACT6=$(echo "$AP6" | jget action_id)
CL6=$(as_user $A $SVC "select outbox_claim_action('w-1','$ACT6')")
check "the worker claims the next send" "$ACT6" "$(echo "$CL6" | jget action_id)"
check "refused before the provider call: failed, with the code" failed "$(as_user $A $SVC "select outbox_settle('$(echo "$CL6" | jget outbox_id)','$(echo "$CL6" | jget claim_token)','failed','Not Sent · Gmail Refused the Address','null','INVALID_RECIPIENT')" | jget state)"
check "the draft is failed, listed among the drafts with Review Again a tap away" "failed|failed" "$(as_user $A $SVC "select draft_outcome('$ACT6','failed')" | jget send_state)|$(as_user $A $AUTH "select draft_list()" | py "print([x['send_state'] for x in d['drafts'] if x['id']=='$D6'][0])")"
check "a failed draft reviews again as it is, and a save makes it a draft again" "ok|draft|" "$(as_user $A $AUTH "select send_review('$D6')" | py "print('ok' if 'review' in d else d.get('error'))")|$(as_user $A $AUTH "select draft_save('$D6','$ACCT_A','{\"to_addresses\":[\"fixed@example.test\"],\"subject\":\"Will fail\",\"body_text\":\"y\"}')" | jget send_state)|$(q -c "select coalesce(sent_action_id::text,'') from email_draft where id='$D6'")"
S7=$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"to_addresses\":[\"slow@example.test\"],\"subject\":\"Timeout\",\"body_text\":\"y\"}')")
D7=$(echo "$S7" | jget draft_id)
RV7=$(as_user $A $AUTH "select send_review('$D7')")
AP7=$(as_user $A $AUTH "select send_approve('$D7','$(echo "$RV7" | jget review.review_nonce)','$(echo "$RV7" | jget review.payload_hash)','k-10')")
ACT7=$(echo "$AP7" | jget action_id)
CL7=$(as_user $A $SVC "select outbox_claim_action('w-1','$ACT7')")
OB7=$(echo "$CL7" | jget outbox_id)
as_user $A $SVC "select outbox_dispatched('$OB7','$(echo "$CL7" | jget claim_token)')" >/dev/null
check "a timeout after dispatch is an unknown outcome" outcome_unknown "$(as_user $A $SVC "select outbox_settle('$OB7','$(echo "$CL7" | jget claim_token)','outcome_unknown','Send Status Unknown · Check Gmail Before Trying Again')" | jget state)"
check "the draft is unknown: no edit, no review (OUTCOME_UNKNOWN), no discard" "unknown|DRAFT_SENT|OUTCOME_UNKNOWN|DRAFT_SENT" "$(as_user $A $SVC "select draft_outcome('$ACT7','outcome_unknown')" | jget send_state)|$(as_user $A $AUTH "select draft_save('$D7','$ACCT_A','{\"subject\":\"x\"}')" | jget error)|$(as_user $A $AUTH "select send_review('$D7')" | jget error)|$(as_user $A $AUTH "select draft_discard('$D7')" | jget error)"
check "the worker never claims an unknown command again" "" "$(as_user $A $SVC "select outbox_claim('w-1')")"
check "absence of a search hit is not evidence: reconcile needs a provider id" INVALID_PAYLOAD "$(as_user $A $SVC "select outbox_reconcile('$OB7','confirmed','Sent to slow@example.test','{}')" | jget error)"
check "evidence settles it: confirmed, then the draft sent with the id" "confirmed|sent|gm-88" "$(as_user $A $SVC "select outbox_reconcile('$OB7','confirmed','Sent to slow@example.test','{\"provider_message_id\":\"gm-88\",\"provider\":\"gmail\"}')" | jget state)|$(as_user $A $SVC "select draft_outcome('$ACT7','confirmed','gm-88')" | jget send_state)|$(q -c "select provider_message_id from email_draft where id='$D7'")"

echo "-- slice 09 (the pre-merge review): cancelling a send that never left frees the draft"
S8=$(as_user $A $AUTH "select draft_save(null,'$ACCT_A','{\"to_addresses\":[\"to@example.test\"],\"subject\":\"Cancel me\",\"body_text\":\"z\"}')")
D8=$(echo "$S8" | jget draft_id)
RV8=$(as_user $A $AUTH "select send_review('$D8')")
AP8=$(as_user $A $AUTH "select send_approve('$D8','$(echo "$RV8" | jget review.review_nonce)','$(echo "$RV8" | jget review.payload_hash)','k-c1')")
ACT8=$(echo "$AP8" | jget action_id)
check "approved and sending, the command queued" "sending|queued" "$(q -c "select send_state from email_draft where id='$D8'")|$(q -c "select state from outbox_command where action_id='$ACT8'")"
check "Edit after the tap, before anything left: the command cancelled and the draft a draft again" "cancelled|cancelled|draft|" "$(as_user $A $AUTH "select command_cancel('$ACT8')" | jget state)|$(q -c "select state from outbox_command where action_id='$ACT8'")|$(q -c "select send_state || '|' || coalesce(sent_action_id::text, '') from email_draft where id='$D8'")"
check "the freed draft saves and reviews again" "$D8|review" "$(as_user $A $AUTH "select draft_save('$D8','$ACCT_A','{\"to_addresses\":[\"to@example.test\"],\"subject\":\"Cancel me, edited\",\"body_text\":\"z\"}')" | jget draft_id)|$(as_user $A $AUTH "select send_review('$D8')" | py "print('review' if d.get('review') else d.get('error'))")"
check "the cancelled action stays cancelled, in the receipts" "cancelled|1" "$(q -c "select state from action where id='$ACT8'")|$(q -c "select count(*) from receipt_event where action_id='$ACT8' and state='cancelled'")"

echo "-- S16: nothing here writes an item"
check "no item was written by any draft, review, tap or outcome" "$ITEMS_BEFORE" "$(q -c "select count(*) from item where owner_id='$A'")"
check "every receipt on the sends is the person's, on the email surface" "0" "$(q -c "select count(*) from action a where a.owner_id='$A' and a.kind='send_email' and (a.actor_kind <> 'user' or a.surface <> 'email')")"

if [ "$fail" = 0 ]; then echo "ALL OK"; else echo "SOME FAILED"; exit 1; fi
