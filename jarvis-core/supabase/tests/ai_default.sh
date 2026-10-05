#!/usr/bin/env bash
# Real-Postgres test for migration 0052 (ai_default_off): a new account is
# stamped ai_allowed = false, an explicit value is kept, an existing account is
# untouched, the provider metadata GoTrue writes survives, the function cannot
# be run by the API roles, and the migration is safe to run twice.
#
# Usage: PGHOST=/tmp/jarvis-pg PGPORT=54329 PGUSER=postgres ./ai_default.sh
# Needs a server where the stub (stub_supabase.sql) is the starting point.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=ai_default_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
q -f "$here/stub_supabase.sql" >/dev/null

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }
ai() { q -c "select coalesce(raw_app_meta_data->>'ai_allowed','(absent)') from auth.users where id='$1'"; }

# An account that exists BEFORE the migration: it must not be touched.
OLD=00000000-0000-0000-0000-0000000000a1
q -c "insert into auth.users (id, email) values ('$OLD', 'old@example.test')" >/dev/null

q -f "$here/../migrations/0052_ai_default_off.sql" >/dev/null

check "an account that existed before is left as it was (absent = allowed)" "(absent)" "$(ai $OLD)"

# 1. A plain sign-up.
NEW=00000000-0000-0000-0000-0000000000b1
q -c "insert into auth.users (id, email) values ('$NEW', 'new@example.test')" >/dev/null
check "a new account starts with ai_allowed false" false "$(ai $NEW)"

# 2. GoTrue writes the provider on the same insert: merged, not replaced.
GT=00000000-0000-0000-0000-0000000000b2
q -c "insert into auth.users (id, email, raw_app_meta_data) values ('$GT', 'gt@example.test', '{\"provider\":\"email\",\"providers\":[\"email\"]}')" >/dev/null
check "the provider metadata survives" email "$(q -c "select raw_app_meta_data->>'provider' from auth.users where id='$GT'")"
check "and the flag is still stamped" false "$(ai $GT)"

# 3. An explicit value is kept (an admin creating an account with AI on).
ON=00000000-0000-0000-0000-0000000000b3
q -c "insert into auth.users (id, email, raw_app_meta_data) values ('$ON', 'on@example.test', '{\"ai_allowed\":true}')" >/dev/null
check "an explicit true is kept" true "$(ai $ON)"
OFF=00000000-0000-0000-0000-0000000000b4
q -c "insert into auth.users (id, email, raw_app_meta_data) values ('$OFF', 'off@example.test', '{\"ai_allowed\":false}')" >/dev/null
check "an explicit false is kept" false "$(ai $OFF)"

# 4. A null metadata column is handled.
NUL=00000000-0000-0000-0000-0000000000b5
q -c "alter table auth.users alter column raw_app_meta_data drop not null" >/dev/null
q -c "insert into auth.users (id, email, raw_app_meta_data) values ('$NUL', 'null@example.test', null)" >/dev/null
check "a null metadata column becomes {ai_allowed:false}" false "$(ai $NUL)"

# 5. The same JSON the proxy reads: only an explicit false blocks, and the new
#    account reads as blocked.
check "the stamped account reads as blocked by the proxy's rule" t "$(q -c "select (raw_app_meta_data->>'ai_allowed') = 'false' from auth.users where id='$NEW'")"

# 6. The API roles cannot run the function.
for role in anon authenticated; do
  check "$role cannot execute the function" f "$(q -c "select has_function_privilege('$role', 'public.ai_default_off()', 'execute')")"
done
check "it is a trigger on auth.users, before insert, per row" 1 "$(q -c "select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='ai_default_off' and not tgisinternal and (tgtype & 2) = 2 and (tgtype & 4) = 4 and (tgtype & 1) = 1")"

# 7. Forward twice changes nothing: one trigger, one function, same behaviour.
q -f "$here/../migrations/0052_ai_default_off.sql" >/dev/null
check "forward twice leaves exactly one trigger" 1 "$(q -c "select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='ai_default_off'")"
AGAIN=00000000-0000-0000-0000-0000000000b6
q -c "insert into auth.users (id, email) values ('$AGAIN', 'again@example.test')" >/dev/null
check "and still stamps" false "$(ai $AGAIN)"

# 8. Rollback removes it and a later sign-up is unstamped again.
q -f "$here/../rollback/0052_ai_default_off_down.sql" >/dev/null
check "rollback removes the trigger" 0 "$(q -c "select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='ai_default_off'")"
check "rollback removes the function" 0 "$(q -c "select count(*) from pg_proc where proname='ai_default_off'")"
LATE=00000000-0000-0000-0000-0000000000b7
q -c "insert into auth.users (id, email) values ('$LATE', 'late@example.test')" >/dev/null
check "after rollback a sign-up is unstamped" "(absent)" "$(ai $LATE)"

psql -qAt -d postgres -c "drop database if exists $DB" >/dev/null
if [ "$fail" = 0 ]; then echo "ALL PASSED"; else echo "SOME FAILED"; exit 1; fi
