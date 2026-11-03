#!/usr/bin/env bash
# Real-Postgres proof for migration 0073 (an event's person is a link, 2026-10-31). PREPARED FOR REVIEW; nothing here touches a
# real project.
#
# Usage: eval "$(./local_pg.sh start)"; ./event_person_link.sh
#
# What it proves:
#   before 0073 an event's personId projects nothing; the backfill projects the event-person pointers that already exist, as
#   operator via backfill_0073, and nothing else; a second run writes nothing; after it, a new event, an edited event and a
#   person taken off all keep item_link right through the trigger; no item row changes and no history row is written by the
#   migration; the registry gains exactly one row; the function stays revoked from PUBLIC; the rollback restores 0060's list
#   and removes only event-person rows; forward again is clean.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=event_person_link_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
as_user() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" >/dev/null; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }
links() { q -c "select coalesce(string_agg(kind||'|'||path||'|'||created_by||'|'||coalesce(via,'')||'|'||coalesce(to_type,''), ' ; ' order by path), '') from item_link where from_item='$1'"; }

A=00000000-0000-0000-0000-00000000000a
AUTH=authenticated
PERSON=30000000-0000-0000-0000-00000000000a
PERSON2=30000000-0000-0000-0000-00000000000b
EV_OLD=40000000-0000-0000-0000-000000000001
EV_NONE=40000000-0000-0000-0000-000000000002
EV_NEW=40000000-0000-0000-0000-000000000003

echo "-- forward to 0072, an event that already names a person, one that names nobody"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort | grep -v '/0073_'); do q -f "$f" >/dev/null; done
q -c "insert into item (id, owner_id, entity_type, data) values ('$PERSON','$A','person','{\"name\":\"Josh Rudd\",\"group\":\"contacts\"}'), ('$PERSON2','$A','person','{\"name\":\"Marco\",\"group\":\"contacts\"}')" >/dev/null
q -c "insert into item (id, owner_id, entity_type, data) values ('$EV_OLD','$A','event','{\"title\":\"Call\",\"date\":\"2026-11-02\",\"start\":\"13:00\",\"personId\":\"$PERSON\"}'), ('$EV_NONE','$A','event','{\"title\":\"Gym\",\"date\":\"2026-11-02\",\"start\":\"18:00\"}')" >/dev/null
check "before 0073 the event's person projects nothing" "" "$(links $EV_OLD)"
items_before=$(q -c "select md5(string_agg(id::text||data::text||updated_at::text, ',' order by id)) from item")
hist_before=$(q -c "select count(*) from item_change")
paths_before=$(q -c "select count(*) from jarvis_link_paths()")

echo "-- 0073, twice"
q -f "$here/../migrations/0073_event_person_link.sql" >/dev/null
check "the backfill projects the pointer that was already there, marked as found" "about|personId|operator|backfill_0073|person" "$(links $EV_OLD)"
check "an event with no person projects nothing" "" "$(links $EV_NONE)"
q -f "$here/../migrations/0073_event_person_link.sql" >/dev/null
check "a second run writes nothing" 1 "$(q -c "select count(*) from item_link where from_item='$EV_OLD'")"
check "no item row changed" "$items_before" "$(q -c "select md5(string_agg(id::text||data::text||updated_at::text, ',' order by id)) from item")"
check "no history row was written by the migration" "$hist_before" "$(q -c "select count(*) from item_change")"
check "the registry gained exactly one row" "$((paths_before + 1))" "$(q -c "select count(*) from jarvis_link_paths()")"
check "the new row is the event's person, kind about" "about" "$(q -c "select kind from jarvis_link_paths() where entity_type='event' and path='personId'")"
check "the registry stays closed to PUBLIC and the browser" f "$(q -c "select has_function_privilege('authenticated', 'jarvis_link_paths()', 'execute')")"

echo "-- the trigger keeps it right from now on"
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$EV_NEW','$A','event','{\"title\":\"Dinner\",\"date\":\"2026-11-05\",\"start\":\"19:00\",\"personId\":\"$PERSON2\"}')"
check "a new event with a person projects it" "about|personId|user||person" "$(links $EV_NEW)"
as_user $A $AUTH "update item set data = data || '{\"personId\":\"$PERSON\"}'::jsonb where id='$EV_NEW'"
check "a changed person moves the link" "$PERSON" "$(q -c "select target from item_link where from_item='$EV_NEW' and path='personId'")"
as_user $A $AUTH "update item set data = data - 'personId' where id='$EV_NEW'"
check "None takes the link off" "" "$(links $EV_NEW)"

echo "-- rollback, then forward again"
q -f "$here/../rollback/0073_event_person_link_down.sql" >/dev/null
check "the rollback restores 0060's list" "$paths_before" "$(q -c "select count(*) from jarvis_link_paths()")"
check "the rollback removes the event-person rows" 0 "$(q -c "select count(*) from item_link where from_type='event' and path='personId'")"
check "and no other link" t "$(q -c "select count(*) = 0 from item_link where from_type='event' and path='personId'")"
q -f "$here/../migrations/0073_event_person_link.sql" >/dev/null
check "forward again projects the existing pointer once more" 1 "$(q -c "select count(*) from item_link where from_item='$EV_OLD' and path='personId'")"

psql -qAt -d postgres -c "drop database if exists $DB" >/dev/null
if [ "$fail" = 0 ]; then echo "ALL PASSED"; else echo "SOME FAILED"; exit 1; fi
