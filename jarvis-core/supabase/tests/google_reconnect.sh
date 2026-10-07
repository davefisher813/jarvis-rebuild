#!/usr/bin/env bash
# Real-Postgres test for migration 0058 (the reconnect attempt record). Usage:
#   PGHOST=/tmp/jarvis-pg PGPORT=54329 PGUSER=postgres ./google_reconnect.sh
# Holds: one OPEN attempt per account, a ten-minute ceiling on its life, only
# known states, a table no browser role can read, and a rollback that is clean.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=google_reconnect_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
qe() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" "$@" 2>&1 | head -1; }
q -f "$here/stub_supabase.sql" >/dev/null 2>&1
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null 2>&1 || { echo "FAIL applying $f"; exit 1; }; done
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }
U=00000000-0000-0000-0000-0000000000e1
E=dave@gmail.com
ins() { q -c "insert into google_reconnect_attempt (user_id,email,nonce,expires_at) values ('$U','$E','n$1',now() + interval '$2') returning status"; }

check "an attempt starts as started" started "$(ins 1 '10 minutes')"
check "a second OPEN attempt for the same account is refused" 1 "$(qe -c "insert into google_reconnect_attempt (user_id,email,nonce,expires_at) values ('$U','$E','n2',now() + interval '5 minutes')" | grep -c 'google_reconnect_one_open_idx')"
q -c "update google_reconnect_attempt set status='superseded' where user_id='$U' and email='$E' and status='started'" >/dev/null
check "once superseded, a fresh attempt for the same account is allowed" started "$(ins 3 '10 minutes')"
check "a different account is independent" started "$(q -c "insert into google_reconnect_attempt (user_id,email,nonce,expires_at) values ('$U','dave@bffsa.org','n4',now() + interval '10 minutes') returning status")"
check "an attempt may not live longer than ten minutes" 1 "$(qe -c "insert into google_reconnect_attempt (user_id,email,nonce,expires_at) values ('$U','x@gmail.com','n5',now() + interval '11 minutes')" | grep -c 'google_reconnect_ttl')"
check "the address is stored lowercase only" 1 "$(qe -c "insert into google_reconnect_attempt (user_id,email,nonce,expires_at) values ('$U','Dave@Gmail.com','n6',now() + interval '1 minute')" | grep -c 'violates check constraint')"
check "an unknown status is refused" 1 "$(qe -c "update google_reconnect_attempt set status='green' where user_id='$U' and email='$E'" | grep -c 'violates check constraint')"
q -c "update google_reconnect_attempt set status='verified', completed_at=now(), outcome='{\"propagation\":{\"app\":\"ok\"}}' where user_id='$U' and email='$E' and status='started'" >/dev/null
check "a verified attempt closes the slot for the next incident" started "$(ins 7 '10 minutes')"

check "no browser role can read it" 0 "$(q -c "select count(*) from information_schema.role_table_grants where table_name='google_reconnect_attempt' and grantee in ('anon','authenticated','public')")"
check "row security is on with no policy" "t|0" "$(q -c "select relrowsecurity from pg_class where relname='google_reconnect_attempt'")|$(q -c "select count(*) from pg_policies where tablename='google_reconnect_attempt'")"

q -f "$here/../migrations/0058_google_reconnect_attempt.sql" >/dev/null 2>&1 && echo "ok   the migration is idempotent" || { echo "FAIL the migration is not idempotent"; fail=1; }
q -f "$here/../rollback/0058_google_reconnect_attempt_down.sql" >/dev/null
check "rollback removes the table" 0 "$(q -c "select count(*) from information_schema.tables where table_name='google_reconnect_attempt'")"
psql -qAt -d postgres -c "drop database if exists $DB" >/dev/null
if [ "$fail" = 0 ]; then echo "ALL PASSED"; else echo "SOME FAILED"; exit 1; fi
