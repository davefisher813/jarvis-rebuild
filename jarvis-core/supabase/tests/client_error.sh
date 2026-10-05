#!/usr/bin/env bash
# Real-Postgres test for migration 0053 (client_error): the table has the
# columns and constraints the receiver relies on, the API roles can neither
# read nor write it (privileges revoked AND no policy), service_role can do
# both, the two indexes exist, the migration is safe to run twice, and the
# rollback removes it.
#
# Usage: PGHOST=/tmp/jarvis-pg PGPORT=54329 PGUSER=postgres ./client_error.sh
# Needs a server where the stub (stub_supabase.sql) is the starting point.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=client_error_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
q -f "$here/stub_supabase.sql" >/dev/null

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }
# Run one statement as a role; prints "denied" when Postgres refuses it.
as_role() {
  local role="$1" sql="$2" out
  if out="$(PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "set role $role; $sql" 2>&1)"; then
    echo "$out" | tail -n 1
  else
    echo denied
  fi
}

q -f "$here/../migrations/0053_client_error.sql" >/dev/null

# 1. Shape.
check "the table exists" 1 "$(q -c "select count(*) from pg_tables where schemaname='public' and tablename='client_error'")"
check "it has the eleven columns" "build,context,created_at,fingerprint,id,message,name,path,platform,stack,user_agent" \
  "$(q -c "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='client_error'")"
check "id is an identity column" ALWAYS "$(q -c "select identity_generation from information_schema.columns where table_name='client_error' and column_name='id'")"
check "fingerprint is not null" NO "$(q -c "select is_nullable from information_schema.columns where table_name='client_error' and column_name='fingerprint'")"
check "context is jsonb" jsonb "$(q -c "select data_type from information_schema.columns where table_name='client_error' and column_name='context'")"
check "created_at defaults to now" t "$(q -c "select column_default like 'now()%' from information_schema.columns where table_name='client_error' and column_name='created_at'")"
check "RLS is on" t "$(q -c "select relrowsecurity from pg_class where oid='public.client_error'::regclass")"
check "and there are no policies" 0 "$(q -c "select count(*) from pg_policies where tablename='client_error'")"
check "index on created_at desc" 1 "$(q -c "select count(*) from pg_indexes where tablename='client_error' and indexdef like '%(created_at DESC)%'")"
check "index on fingerprint, created_at desc" 1 "$(q -c "select count(*) from pg_indexes where tablename='client_error' and indexdef like '%(fingerprint, created_at DESC)%'")"

# 2. The platform check.
q -c "insert into client_error (platform, fingerprint) values ('web','f1'), ('ios','f1'), ('other','f2'), (null,'f3')" >/dev/null
check "web, ios, other and null are accepted" 4 "$(q -c "select count(*) from client_error")"
check "any other platform is refused" denied "$(as_role postgres "insert into client_error (platform, fingerprint) values ('android','f9')")"
check "a row with no fingerprint is refused" denied "$(as_role postgres "insert into client_error (platform) values ('web')")"
q -c "delete from client_error" >/dev/null

# 3. The API roles can neither read nor write, and the refusal is a privilege
#    refusal, not just an empty result.
for role in anon authenticated; do
  check "$role cannot select" denied "$(as_role $role "select count(*) from client_error")"
  check "$role cannot insert" denied "$(as_role $role "insert into client_error (fingerprint) values ('x')")"
  check "$role cannot delete" denied "$(as_role $role "delete from client_error")"
  check "$role holds no table privilege" f "$(q -c "select has_table_privilege('$role', 'public.client_error', 'select,insert,update,delete')")"
done

# 4. Row security alone must also hold: even if a grant came back, with no
#    policy a non-bypass role sees and writes nothing.
q -c "insert into client_error (fingerprint) values ('seen-by-service')" >/dev/null
q -c "grant select, insert on public.client_error to authenticated" >/dev/null
q -c "grant usage on sequence public.client_error_id_seq to authenticated" >/dev/null
check "with a grant restored, RLS still hides every row" 0 "$(as_role authenticated "select count(*) from client_error")"
check "and still refuses an insert" denied "$(as_role authenticated "insert into client_error (fingerprint) values ('y')")"
q -c "revoke all on public.client_error from authenticated" >/dev/null
q -c "revoke all on sequence public.client_error_id_seq from authenticated" >/dev/null
q -c "delete from client_error" >/dev/null

# 5. service_role can write and read it (it bypasses RLS and keeps its grant).
check "service_role can insert" INSERT "$(as_role service_role "insert into client_error (build, platform, name, message, fingerprint, context) values ('b1','ios','TypeError','x is undefined','fp1','{\"kind\":\"window.error\"}') returning 'INSERT'")"
check "service_role can read it back" "fp1|ios" "$(as_role service_role "select fingerprint || '|' || platform from client_error")"
check "service_role can delete old rows" 0 "$(as_role service_role "with d as (delete from client_error where created_at < now() - interval '30 days' returning 1) select count(*) from d")"
q -c "update client_error set created_at = now() - interval '31 days'" >/dev/null
check "retention's delete removes a 31 day old row" 1 "$(as_role service_role "with d as (delete from client_error where created_at < now() - interval '30 days' returning 1) select count(*) from d")"

# 6. Forward twice changes nothing.
q -c "insert into client_error (fingerprint) values ('keep')" >/dev/null
q -f "$here/../migrations/0053_client_error.sql" >/dev/null
check "forward twice keeps the rows" 1 "$(q -c "select count(*) from client_error")"
check "forward twice leaves the key and two indexes" 3 "$(q -c "select count(*) from pg_indexes where tablename='client_error'")"
check "and the revokes still hold" f "$(q -c "select has_table_privilege('anon', 'public.client_error', 'select')")"

# 7. Rollback removes it.
q -f "$here/../rollback/0053_client_error_down.sql" >/dev/null
check "rollback removes the table" 0 "$(q -c "select count(*) from pg_tables where schemaname='public' and tablename='client_error'")"
q -f "$here/../rollback/0053_client_error_down.sql" >/dev/null
check "rollback twice is a no-op" 0 "$(q -c "select count(*) from pg_tables where schemaname='public' and tablename='client_error'")"
q -f "$here/../migrations/0053_client_error.sql" >/dev/null
check "and forward again works after a rollback" 1 "$(q -c "select count(*) from pg_tables where schemaname='public' and tablename='client_error'")"

psql -qAt -d postgres -c "drop database if exists $DB" >/dev/null
if [ "$fail" = 0 ]; then echo "ALL PASSED"; else echo "SOME FAILED"; exit 1; fi
