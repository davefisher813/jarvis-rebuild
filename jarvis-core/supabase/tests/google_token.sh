#!/usr/bin/env bash
# Real-Postgres test for migration 0057 (the Google token lifecycle). Usage:
#   PGHOST=/tmp/jarvis-pg PGPORT=54329 PGUSER=postgres ./google_token.sh
# Holds what the spec states in words: one revocation path that keeps the row
# DEAD and mirrors the mailbox in the same transaction, a single-flight lock
# that two racing workers cannot both win, a result that cannot resurrect a
# revoked grant, a disconnect that leaves no credential behind, and functions
# no browser role can call.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=google_token_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
q -f "$here/stub_supabase.sql" >/dev/null 2>&1
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null 2>&1 || { echo "FAIL applying $f"; exit 1; }; done
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }
U=00000000-0000-0000-0000-0000000000d1
E=dave@gmail.com
q -c "insert into auth.users (id,email) values ('$U','$E')" >/dev/null
tok() { q -c "select $1 from google_tokens where user_id='$U' and email='$E'"; }
acct() { q -c "select $1 from email_account where owner_id='$U' and address='$E'"; }
FUT="now() + interval '1 hour'"

# ---- connect ---------------------------------------------------------------
check "refresh-only keep with nothing stored is refused" NO_STORED_SIGNIN "$(q -c "select (google_signin_keep('$U','$E',null,'acc1',$FUT,null,'gmail.send'))->>'error'")"
q -c "select google_signin_keep('$U','Dave@Gmail.com','v2.r1','v2.a1',$FUT,null,'gmail.send gmail.modify')" >/dev/null
check "connect stores a VALID row under the lowercase address" VALID "$(tok state)"
check "connect mirrors the mailbox as connected in the same call" connected "$(acct state)"
check "connect gives the mailbox its credential reference" 1 "$(q -c "select count(*) from jarvis_private.email_credential where owner_id='$U' and credential_ref='google_tokens:$E'")"
check "the granted scope is recorded from the response" "gmail.send gmail.modify" "$(tok granted_scope)"

# ---- one revocation path ---------------------------------------------------
r="$(q -c "select google_grant_revoked('$U','$E','app','invalid_grant',400,'user_revoked')")"
check "revoke reports it was the first to find it" true "$(echo "$r" | python3 -c 'import sys,json;print(str(json.load(sys.stdin)["first"]).lower())')"
check "the row is marked DEAD" DEAD "$(tok state)"
check "and KEPT for audit: the refresh token ciphertext is still there" v2.r1 "$(tok token_enc)"
check "the cached access token is dropped" t "$(tok "access_enc is null")"
check "the mailbox moved to reauth in the same transaction" reauth "$(acct state)"
check "the failure is recorded with the source and the code" "app|invalid_grant|400" "$(tok "last_auth_error->>'lastAuthErrorSource' || '|' || (last_auth_error->>'lastAuthErrorCode') || '|' || (last_auth_error->>'lastAuthErrorHttpStatus')")"
check "and with the likely cause" user_revoked "$(tok "last_auth_error->>'likelyCause'")"
r2="$(q -c "select google_grant_revoked('$U','$E','email','invalid_grant',400,'user_revoked')")"
check "a second report from the other path is not a new incident" false "$(echo "$r2" | python3 -c 'import sys,json;print(str(json.load(sys.stdin)["first"]).lower())')"
check "and leaves the first incident's metadata alone" app "$(tok "last_auth_error->>'lastAuthErrorSource'")"

# ---- a dead grant stays dead -----------------------------------------------
check "a refresh result cannot resurrect a DEAD row" NOT_VALID "$(q -c "select (google_refresh_record('$U','$E','v2.a2',$FUT,null,null,null))->>'error'")"
check "so it stays DEAD" DEAD "$(tok state)"
check "a DEAD row cannot take the refresh lock" f "$(q -c "select google_refresh_lock('$U','$E',15)")"
check "consent that returned no refresh token cannot revive it" NO_REFRESH_TOKEN "$(q -c "select (google_signin_keep('$U','$E',null,'v2.a3',$FUT,null,null))->>'error'")"
check "and it is still DEAD" DEAD "$(tok state)"
q -c "select google_signin_keep('$U','$E','v2.r2','v2.a4',$FUT,null,'gmail.send')" >/dev/null
check "a new refresh token revives it" VALID "$(tok state)"
check "the old failure metadata is cleared" t "$(tok "last_auth_error is null")"
check "the mailbox is connected again" connected "$(acct state)"

# ---- refresh results -------------------------------------------------------
q -c "update email_account set state='reauth' where owner_id='$U' and address='$E'" >/dev/null
q -c "select google_refresh_record('$U','$E','v2.a5',$FUT,null,null,'gmail.send')" >/dev/null
check "a good refresh keeps the stored refresh token when Google sent none" v2.r2 "$(tok token_enc)"
check "and stores the new access token" v2.a5 "$(tok access_enc)"
check "and brings a reauth mailbox back to connected" connected "$(acct state)"
q -c "select google_refresh_record('$U','$E','v2.a6',$FUT,'v2.r3',null,null)" >/dev/null
check "a rotated refresh token replaces the stored one" v2.r3 "$(tok token_enc)"
check "a granted scope the response omitted is left alone" gmail.send "$(tok granted_scope)"
q -c "select google_refresh_failed('$U','$E')" >/dev/null; q -c "select google_refresh_failed('$U','$E')" >/dev/null
check "transient failures are counted" 2 "$(tok consecutive_failures)"
check "and change no state" VALID "$(tok state)"
q -c "select google_refresh_record('$U','$E','v2.a7',$FUT,null,null,null)" >/dev/null
check "a good refresh clears the count" 0 "$(tok consecutive_failures)"

# ---- the single-flight lock ------------------------------------------------
check "the first caller takes the lock" t "$(q -c "select google_refresh_lock('$U','$E',15)")"
check "the second finds it held" f "$(q -c "select google_refresh_lock('$U','$E',15)")"
q -c "update google_tokens set refresh_lock_until = now() - interval '1 second' where user_id='$U' and email='$E'" >/dev/null
check "an expired lock (a dead worker) can be taken" t "$(q -c "select google_refresh_lock('$U','$E',15)")"
q -c "update google_tokens set refresh_lock_until = null where user_id='$U' and email='$E'" >/dev/null
wins="$(seq 1 12 | xargs -P 12 -I{} psql -qAt -d "$DB" -c "select google_refresh_lock('$U','$E',15)" | grep -c '^t$')"
check "twelve workers racing for the lock produce exactly one winner" 1 "$wins"
q -c "update google_tokens set refresh_lock_until = null where user_id='$U' and email='$E'" >/dev/null
q -c "select google_refresh_record('$U','$E','v2.a8',$FUT,null,null,null)" >/dev/null
check "recording the result releases the lock" t "$(q -c "select google_refresh_lock('$U','$E',15)")"
q -c "select google_refresh_failed('$U','$E')" >/dev/null
check "a failed refresh releases the lock too" t "$(tok "refresh_lock_until is null")"

# ---- disconnect ------------------------------------------------------------
q -c "insert into email_message (owner_id, account_id, provider_id, thread_id, internal_date) select '$U', id, 'm1', 't1', now() from email_account where owner_id='$U' and address='$E'" >/dev/null 2>&1 || true
q -c "select google_signin_forget('$U','$E')" >/dev/null
check "disconnect deletes the token row" 0 "$(q -c "select count(*) from google_tokens where user_id='$U' and email='$E'")"
check "and the credential reference" 0 "$(q -c "select count(*) from jarvis_private.email_credential where owner_id='$U' and credential_ref='google_tokens:$E'")"
check "the mailbox is disconnected, not deleted" disconnected "$(acct state)"
check "so nothing can take a refresh lock for it" f "$(q -c "select google_refresh_lock('$U','$E',15)")"

# ---- who may call these ----------------------------------------------------
for fn in "google_signin_keep(uuid,text,text,text,timestamptz,timestamptz,text)" "google_refresh_record(uuid,text,text,timestamptz,text,timestamptz,text)" "google_refresh_failed(uuid,text)" "google_grant_revoked(uuid,text,text,text,integer,text)" "google_signin_forget(uuid,text)" "google_refresh_lock(uuid,text,integer)"; do
  check "no browser role can call $fn" "f|f|t" "$(q -c "select has_function_privilege('anon','$fn','execute') || '|' || has_function_privilege('authenticated','$fn','execute') || '|' || has_function_privilege('service_role','$fn','execute')" | sed 's/true/t/g;s/false/f/g;s/||/|/g')"
done
if q -c "set role authenticated; select google_grant_revoked('$U','$E','x','x',0,'x')" >/dev/null 2>&1; then echo "FAIL a signed-in user called the revoke path"; fail=1; else echo "ok   a signed-in user cannot call the revoke path"; fi
if q -c "insert into google_tokens (user_id,email,token_enc,state) values ('$U','z@x.test','x','ALIVE')" >/dev/null 2>&1; then echo "FAIL an invalid state was accepted"; fail=1; else echo "ok   only VALID and DEAD can be stored"; fi
check "the table is still service-role only: row security on, and no policy for anyone" "t|0" "$(q -c "select (select relrowsecurity from pg_class where relname='google_tokens')::text || '|' || (select count(*) from pg_policies where tablename='google_tokens')" | sed 's/true/t/')"

# ---- idempotent, and reversible --------------------------------------------
q -f "$here/../migrations/0057_google_token_lifecycle.sql" >/dev/null 2>&1 && echo "ok   the migration applies twice" || { echo "FAIL the migration is not idempotent"; fail=1; }
q -f "$here/../rollback/0057_google_token_lifecycle_down.sql" >/dev/null
check "rollback removes the lifecycle columns" 0 "$(q -c "select count(*) from information_schema.columns where table_name='google_tokens' and column_name in ('state','access_enc','refresh_lock_until','last_auth_error')")"
check "and the functions" 0 "$(q -c "select count(*) from pg_proc where proname in ('google_signin_keep','google_refresh_record','google_refresh_failed','google_grant_revoked','google_signin_forget','google_refresh_lock')")"
check "the refresh-token column survives a rollback" t "$(q -c "select count(*) = 1 from information_schema.columns where table_name='google_tokens' and column_name='token_enc'")"
psql -qAt -d postgres -c "drop database if exists $DB" >/dev/null
if [ "$fail" = 0 ]; then echo "ALL PASSED"; else echo "SOME FAILED"; exit 1; fi
