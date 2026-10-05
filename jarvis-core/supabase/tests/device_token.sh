#!/usr/bin/env bash
# Real-Postgres test for migration 0054 (device_token). Usage:
#   PGHOST=/tmp/jarvis-pg PGPORT=54329 PGUSER=postgres ./device_token.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=device_token_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
q -f "$here/stub_supabase.sql" >/dev/null
q -f "$here/../migrations/0054_device_token.sql" >/dev/null
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }
U1=00000000-0000-0000-0000-0000000000c1; U2=00000000-0000-0000-0000-0000000000c2
q -c "insert into auth.users (id,email) values ('$U1','a@x.test'),('$U2','b@x.test')" >/dev/null
TOK=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
as_user() { local u="$1"; shift; q -c "set role authenticated; select set_config('request.jwt.claim.sub','$u',false); $*"; }

as_user $U1 "select public.register_device_token('$TOK','development','b1')" >/dev/null
check "a signed-in user registers a token" "$U1" "$(q -c "select user_id from device_token where token='$TOK'")"
check "the environment is kept" development "$(q -c "select environment from device_token where token='$TOK'")"

as_user $U2 "select public.register_device_token('$TOK','production','b2')" >/dev/null
check "the same phone signed in as another account moves the token" "$U2" "$(q -c "select user_id from device_token where token='$TOK'")"
check "and there is still exactly one row for it" 1 "$(q -c "select count(*) from device_token where token='$TOK'")"

as_user $U1 "select public.unregister_device_token('$TOK')" >/dev/null
check "an account cannot remove another account's token" 1 "$(q -c "select count(*) from device_token where token='$TOK'")"
as_user $U2 "select public.unregister_device_token('$TOK')" >/dev/null
check "the owner removes it" 0 "$(q -c "select count(*) from device_token where token='$TOK'")"

check "anon cannot register" f "$(q -c "select has_function_privilege('anon','public.register_device_token(text,text,text)','execute')")"
check "authenticated has no table access" f "$(q -c "select has_table_privilege('authenticated','device_token','select') or has_table_privilege('authenticated','device_token','insert')")"
if as_user "" "select public.register_device_token('$TOK')" >/dev/null 2>&1; then echo "FAIL a call with no user succeeded"; fail=1; else echo "ok   a call with no signed-in user is refused"; fi
if as_user $U1 "select public.register_device_token('short')" >/dev/null 2>&1; then echo "FAIL a short token was accepted"; fail=1; else echo "ok   a token that cannot be real is refused"; fi

as_user $U1 "select public.register_device_token('$TOK')" >/dev/null
q -c "delete from auth.users where id='$U1'" >/dev/null
check "deleting the account deletes its tokens" 0 "$(q -c "select count(*) from device_token where token='$TOK'")"

q -f "$here/../rollback/0054_device_token_down.sql" >/dev/null
check "rollback removes the table" 0 "$(q -c "select count(*) from pg_tables where tablename='device_token'")"
psql -qAt -d postgres -c "drop database if exists $DB" >/dev/null
if [ "$fail" = 0 ]; then echo "ALL PASSED"; else echo "SOME FAILED"; exit 1; fi
