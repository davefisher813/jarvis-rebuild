#!/usr/bin/env bash
# Real-Postgres proof for migration 0060 (memory: item_change, item_link, the item
# trigger and item_why; Phase 0 design D1, D2 and D9, 2026-10-10).
#
# Usage: eval "$(./local_pg.sh start)"; ./memory.sh
#
# What it proves (the 39 checks of PHASE0-DESIGN.md section 3, 49 as run; the last three of the
# history and links sections are the review fixes of 2026-10-10, named in the 0060 header):
#   every write to item leaves one history row with the changed keys, the values under the four
#   closed rules, the capture moment and the origin the DATABASE derived (user, function with the
#   door's name, server, operator); an empty diff writes no row; JSON null and absence are one value
#   deleting an item erases every value in its history and leaves the facts; history is append only,
#   the owner's alone, erasable by the owner and prunable by the server without losing the first row
#   item_link is a projection of the JSONB pointers: kinds from the registry, the author from the
#   row's own Source stamp, a kept target beside a resolved one, healed by a recreate, never written
#   by the browser; the backfill marked what it found
#   a non finite p_client_at is refused by both patch doors, a far future one is stamped at most five
#   minutes past now, a past one exactly; a change of entity_type alone writes a history row and
#   recomputes the links for the new kind
#   item_why answers typed, rule, function, unknown, and is the owner's alone
#   readiness carries 0060; delete_owned reaches both tables; the write cost ratio is under 3.0;
#   every new function is revoked from PUBLIC with a search_path; rollback restores the five bodies
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=memory_test
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
counts() { q -c "select (select count(*) from pg_tables where schemaname='public') || '/' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')"; }
hist() { q -c "select op||'|'||origin||'|'||coalesce(via,'')||'|'||changed_keys::text||'|'||(before is null)||'|'||(after is null) from item_change where item_id='$1' order by at, id"; }
links() { q -c "select string_agg(kind||'|'||path||'|'||created_by||'|'||coalesce(via,'')||'|'||coalesce(to_type,'')||'|'||(to_item is null), ' ; ' order by kind, path, target) from item_link where from_item='$1'"; }

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
C=00000000-0000-0000-0000-00000000000c
AUTH=authenticated
SVC=service_role
PROJ_A=10000000-0000-0000-0000-00000000000a
PROJ_B=10000000-0000-0000-0000-00000000000b
TASK_A=20000000-0000-0000-0000-00000000000a
ACCT=60000000-0000-0000-0000-00000000000a
MSG_TASK=70000000-0000-0000-0000-0000000000a2
C_TASK=90000000-0000-0000-0000-0000000000a2
C_WRAP=90000000-0000-0000-0000-0000000000a9
PRE_LINKED=d0000000-0000-0000-0000-000000000001
PRE_DANGLING=d0000000-0000-0000-0000-000000000002
MISSING=d0000000-0000-0000-0000-00000000dead
TASK_PREP='{"destination_kind":"task","data":{"text":"Review transcript","category":"","done":false,"due":"2026-10-09"},"exact_effect":"Added to Tasks · Review transcript","display_summary":"Review transcript · Due Oct 9","module_version":"tasks-2026-10-02"}'

echo "-- forward: stub + chain 0001..0059, fixtures, two rows that predate 0060, then 0060 twice"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort | grep -v '/006[012]_'); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
q -c "insert into item (id, owner_id, entity_type, data) values ('$PRE_LINKED','$A','task','{\"text\":\"Book the flights\",\"category\":\"\",\"done\":false,\"projectId\":\"$PROJ_A\"}'), ('$PRE_DANGLING','$A','task','{\"text\":\"Pack\",\"category\":\"\",\"done\":false,\"projectId\":\"$MISSING\"}')" >/dev/null
q -f "$here/../migrations/0060_memory.sql" >/dev/null
COUNTS1=$(counts)
check "0060 forwards twice (idempotent)" "ok|$COUNTS1|1" "$(q -f "$here/../migrations/0060_memory.sql" >/dev/null && echo ok)|$(counts)|$(q -c "select count(*) from pg_proc where proname='item_apply_patch'")"

echo "-- history: what a write leaves behind"
T1=e1000000-0000-0000-0000-000000000001
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$T1','$A','task','{\"text\":\"Call the dentist\",\"category\":\"\",\"done\":false,\"due\":null}')" >/dev/null
check "a browser insert writes one row: op insert, origin user, via null, every non null key in changed_keys, before null, client_at = created_at" "1|insert|user||{category,done,text}|true|true" \
  "$(q -c "select count(*) from item_change where item_id='$T1'")|$(q -c "select c.op||'|'||c.origin||'|'||coalesce(c.via,'')||'|'||c.changed_keys::text||'|'||(c.before is null)||'|'||(c.client_at = i.created_at) from item_change c join item i on i.id=c.item_id where c.item_id='$T1'")"
check "the browser patch merged (the old reader still answers true)" t "$(as_user $A $AUTH "select item_apply_patch('$T1','{\"text\":\"Call the dentist today\"}')")"
check "a browser patch records only the changed key with before and after, and reads origin user through the invoker function" 'update|user|{text}|{"text": "Call the dentist"}|{"text": "Call the dentist today"}' \
  "$(q -c "select op||'|'||origin||'|'||changed_keys::text||'|'||before::text||'|'||after::text from item_change where item_id='$T1' and op='update'")"
as_user $A $AUTH "select item_apply_patch('$T1','{\"due\":\"2026-10-12\"}')" >/dev/null
as_user $A $AUTH "select item_apply_patch('$T1','{\"due\":null}')" >/dev/null
N_BEFORE=$(q -c "select count(*) from item_change where item_id='$T1'")
as_user $A $AUTH "select item_apply_patch('$T1','{\"due\":null}')" >/dev/null
check "a cleared key reads as null, not absent, and an explicit JSON null is not a change" "1|null|$N_BEFORE|f" \
  "$(q -c "select count(*) from item_change where item_id='$T1' and after ? 'due' and jsonb_typeof(after -> 'due') = 'null'")|$(q -c "select jsonb_typeof(after -> 'due') from item_change where item_id='$T1' and changed_keys = '{due}' order by at desc limit 1")|$(q -c "select count(*) from item_change where item_id='$T1'")|$(q -c "select 'due' = any(changed_keys) from item_change where item_id='$T1' and op='insert'")"
U_BEFORE=$(q -c "select updated_at from item where id='$T1'")
as_user $A $AUTH "select item_apply_patch('$T1','{\"text\":\"Call the dentist today\"}')" >/dev/null
check "an empty diff writes no row (updated_at moves, item_change does not)" "t|$N_BEFORE" "$(q -c "select updated_at > '$U_BEFORE' from item where id='$T1'")|$(q -c "select count(*) from item_change where item_id='$T1'")"
check "item_apply_patch_if_older stamps client_at from p_client_at (inside the five minute clamp); a stale patch writes no row" "stale|$N_BEFORE|applied|t" \
  "$(as_user $A $AUTH "select item_apply_patch_if_older('$T1','{\"text\":\"older name\"}', now() - interval '1 day')")|$(q -c "select count(*) from item_change where item_id='$T1'")|$(as_user $A $AUTH "select item_apply_patch_if_older('$T1','{\"text\":\"newer name\"}', now() + interval '4 minutes')")|$(q -c "select client_at - at between interval '3 minutes 50 seconds' and interval '4 minutes 10 seconds' from item_change where item_id='$T1' order by at desc, id desc limit 1")"
as_user $A $AUTH "select item_apply_patch('$T1','{\"text\":\"from the queue\"}','2026-10-10T06:00:00Z')" >/dev/null
as_user $A $AUTH "select item_apply_patch('$T1','{\"text\":\"live\"}')" >/dev/null
check "item_apply_patch with a third argument stamps client_at; with two arguments client_at = at" "2026-10-10 06:00:00+00|t" \
  "$(q -c "select client_at from item_change where item_id='$T1' and after->>'text'='from the queue'")|$(q -c "select client_at = at from item_change where item_id='$T1' and after->>'text'='live'")"
T3=e1000000-0000-0000-0000-000000000003
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$T3','$A','task','{\"text\":\"Clock\",\"category\":\"\",\"done\":false}')" >/dev/null
N_T3=$(q -c "select count(*) from item_change where item_id='$T3'")
check "a non finite p_client_at is refused by both doors (false, stale) and nothing is written" "f|stale|$N_T3|Clock" \
  "$(as_user $A $AUTH "select item_apply_patch('$T3','{\"text\":\"never\"}','infinity')")|$(as_user $A $AUTH "select item_apply_patch_if_older('$T3','{\"text\":\"never\"}','-infinity')")|$(q -c "select count(*) from item_change where item_id='$T3'")|$(q -c "select data->>'text' from item where id='$T3'")"
as_user $A $AUTH "select item_apply_patch('$T3','{\"text\":\"far\"}','2999-01-01T00:00:00Z')" >/dev/null
as_user $A $AUTH "select item_apply_patch_if_older('$T3','{\"text\":\"farther\"}','2999-01-01T00:00:00Z')" >/dev/null
as_user $A $AUTH "select item_apply_patch('$T3','{\"text\":\"then\"}','2026-01-05T10:00:00Z')" >/dev/null
check "a far future p_client_at is stamped at most five minutes past now through either door; a past one is stored exactly" "t|t|2026-01-05 10:00:00+00" \
  "$(q -c "select client_at - at between interval '4 minutes 50 seconds' and interval '5 minutes' from item_change where item_id='$T3' and after->>'text'='far'")|$(q -c "select client_at - at between interval '4 minutes 50 seconds' and interval '5 minutes' from item_change where item_id='$T3' and after->>'text'='farther'")|$(q -c "select client_at from item_change where item_id='$T3' and after->>'text'='then'")"
T2=e1000000-0000-0000-0000-000000000002
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data, created_at) values ('$T2','$A','task','{\"text\":\"Stretch\",\"category\":\"\",\"done\":false}', now() - interval '1 hour')" >/dev/null
check "an insert with an explicit created_at (a replayed offline create) reads client_at = created_at before at" "true|true" "$(q -c "select (c.client_at = i.created_at)||'|'||(c.client_at < c.at) from item_change c join item i on i.id=c.item_id where c.item_id='$T2'")"

echo "-- origin: the database's word, not the caller's"
R8=$(as_user $A $AUTH "select capture_approve('$C_TASK',1,'ph-a2','k-mem','$TASK_PREP')")
EMAIL_TASK=$(echo "$R8" | jget destination_id)
check "a write from capture_approve reads origin function via capture_approve" "insert|function|capture_approve" "$(q -c "select op||'|'||origin||'|'||via from item_change where item_id='$EMAIL_TASK'")"
q -c "insert into email_candidate (id, owner_id, account_id, message_id, source_hash, extractor_version, kind, origin, payload, payload_hash, fingerprint, status) values ('$C_WRAP','$A','$ACCT','$MSG_TASK','sh-a2','rules-1','task','rule','{\"kind\":\"task\",\"title\":\"Review transcript\",\"due_date\":\"2026-10-09\",\"notes\":\"\"}','ph-w','fp-a-task-w','proposed')" >/dev/null
q -c "create function memory_wrap(p_c uuid, p_h text, p_k text, p_p jsonb) returns jsonb language plpgsql security definer set search_path = public as \$w\$ begin return capture_approve(p_c, 1, p_h, p_k, p_p); end \$w\$" >/dev/null
WRAPPED=$(as_user $A $AUTH "select memory_wrap('$C_WRAP','ph-w','k-wrap','$TASK_PREP')" | jget destination_id)
check "a definer wrapper around capture_approve still reads via capture_approve (the innermost frame)" "function|capture_approve" "$(q -c "select origin||'|'||via from item_change where item_id='$WRAPPED'")"
q -c "drop function memory_wrap(uuid, text, text, jsonb)" >/dev/null
T9=e1000000-0000-0000-0000-000000000009
as_user $A $SVC "insert into item (id, owner_id, entity_type, data) values ('$T9','$A','task','{\"text\":\"Server wrote this\",\"category\":\"\",\"done\":false}')" >/dev/null
check "a service role write reads origin server" "server|" "$(q -c "select origin||'|'||coalesce(via,'') from item_change where item_id='$T9'")"
T10=e1000000-0000-0000-0000-000000000010
q -c "insert into item (id, owner_id, entity_type, data) values ('$T10','$A','task','{\"text\":\"Hand edit\",\"category\":\"\",\"done\":false,\"runLen\":12,\"bestRun\":12}')" >/dev/null
check "an operator write reads origin operator" "operator|" "$(q -c "select origin||'|'||coalesce(via,'') from item_change where item_id='$T10'")"

echo "-- the four value rules"
q -c "update item set data = data || '{\"runLen\": 1}' where id='$T10'" >/dev/null
check "the streak vocabulary never reaches before or after" "{runLen}|false|false|false" "$(q -c "select changed_keys::text||'|'||(before ? 'runLen')||'|'||(after ? 'runLen')||'|'||((select after ? 'bestRun' from item_change where item_id='$T10' and op='insert')) from item_change where item_id='$T10' and op='update'")"
N1=e1000000-0000-0000-0000-000000000011
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$N1','$A','note','{\"title\":\"Plan\",\"blocks\":[{\"type\":\"p\",\"text\":\"a long body\"}],\"category\":\"\"}')" >/dev/null
check "a note body is recorded as omitted bulk" 'bulk|true|"Plan"' "$(q -c "select (after->'blocks'->>'_omitted')||'|'||(jsonb_typeof(after->'blocks'->'bytes')='number')||'|'||(after->'title')::text from item_change where item_id='$N1'")"
H1=e1000000-0000-0000-0000-000000000012
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$H1','$A','health_meal','{\"at\":\"2026-10-10T08:00:00Z\",\"what\":\"eggs\"}')" >/dev/null
as_user $A $AUTH "select item_apply_patch('$H1','{\"what\":\"oats\"}')" >/dev/null
check "a health kind keeps keys and never values" "{at,what}|true|true ; {what}|true|true" "$(q -c "select string_agg(changed_keys::text||'|'||(before is null)||'|'||(after is null), ' ; ' order by at, id) from item_change where item_id='$H1'")"

echo "-- deletion erases the values and keeps the facts"
as_user $A $AUTH "delete from item where id='$T1'" >/dev/null
check "deleting an item erases every value for it and writes a delete row with keys and no values" "0|0|1|{category,done,text}|0" \
  "$(q -c "select count(*) from item_change where item_id='$T1' and (before is not null or after is not null)")|$(q -c "select count(*) from item_change where item_id='$T1' and op <> 'delete' and erased_at is null")|$(q -c "select count(*) from item_change where item_id='$T1' and op='delete'")|$(q -c "select changed_keys::text from item_change where item_id='$T1' and op='delete'")|$(q -c "select count(*) from item where id='$T1'")"
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$T1','$A','task','{\"text\":\"Call the dentist\",\"category\":\"\",\"done\":false}')" >/dev/null
check "a recreate under the same id writes a fresh insert row and item_why answers from it" "insert|false|typed" "$(as_user $A $AUTH "select item_why('$T1')" | py "print(d['changes'][0]['op']+'|'+str(d['changes'][0]['erased']).lower()+'|'+d['answer'])")"

echo "-- history is the owner's, append only, erasable, prunable"
check "B reads none of A's history" 0 "$(as_user $B $AUTH "select count(*) from item_change where owner_id='$A'")"
ROW10=$(q -c "select id from item_change where item_id='$T10' and op='update'")
check "the browser cannot insert, update or delete item_change" "42501|42501|42501" "$(as_user_state $A $AUTH "insert into item_change (owner_id, item_id, entity_type, op, changed_keys, revision, origin) values ('$A','$T10','task','update','{x}',now(),'user')")|$(as_user_state $A $AUTH "update item_change set after = '{}' where id='$ROW10'")|$(as_user_state $A $AUTH "delete from item_change where id='$ROW10'")"
check "the server may only erase" "42501|ok|t" "$(as_user_state $A $SVC "update item_change set after = '{}' where id='$ROW10'")|$(as_user_state $A $SVC "update item_change set after = null, erased_at = now() where id='$ROW10'")|$(q -c "select erased_at is not null and after is null from item_change where id='$ROW10'")"
check "history_erase blanks the words and keeps the facts" "2|{}|t|t|insert|operator|0" \
  "$(as_user $A $AUTH "select history_erase('$T10')" | jget erased_rows)|$(q -c "select string_agg(distinct changed_keys::text, ',') from item_change where item_id='$T10'")|$(q -c "select bool_and(before is null and after is null and erased_at is not null) from item_change where item_id='$T10'")|$(q -c "select count(*) = 2 from item_change where item_id='$T10'")|$(q -c "select op from item_change where item_id='$T10' order by at, id limit 1")|$(q -c "select origin from item_change where item_id='$T10' order by at, id limit 1")|$(as_user $B $AUTH "select history_erase('$T10')" | jget erased_rows)"

echo "-- links: a projection of the pointers, with the author on the row's own stamp"
P1=e2000000-0000-0000-0000-000000000001
P2=e2000000-0000-0000-0000-000000000002
EV1=e2000000-0000-0000-0000-000000000003
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$P1','$A','person','{\"name\":\"Mike\",\"categoryIds\":[]}'), ('$P2','$A','person','{\"name\":\"Sam\",\"categoryIds\":[]}'), ('$EV1','$A','event','{\"title\":\"Practice\",\"date\":\"2026-10-11\",\"start\":\"09:00\",\"category\":\"\"}')" >/dev/null
TL1=e3000000-0000-0000-0000-000000000001
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$TL1','$A','task','{\"text\":\"Call Mike\",\"category\":\"\",\"done\":false,\"personId\":\"$P1\"}')" >/dev/null
check "a task with personId projects one about link with created_by user and the person's type" "about|personId|user||person|false" "$(links $TL1)"
TL2=e3000000-0000-0000-0000-000000000002
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$TL2','$A','task','{\"text\":\"Need to follow up with Mike about summer roster\",\"category\":\"\",\"done\":false,\"personId\":\"$P1\",\"source\":{\"type\":\"paste\",\"ts\":1760000000000,\"inferred\":[\"personId\"]}}')" >/dev/null
check "a task whose source says personId was inferred projects created_by rule" "about|personId|rule||person|false" "$(links $TL2)"
as_user $A $AUTH "select item_apply_patch('$TL2','{\"personId\":\"$P2\"}')" >/dev/null
check "a browser correction of an inferred link reads user" "about|personId|user||person|false|$P2" "$(links $TL2)|$(q -c "select target from item_link where from_item='$TL2'")"
NC=e3000000-0000-0000-0000-000000000003
D0=e3000000-0000-0000-0000-000000000004
D1=e3000000-0000-0000-0000-000000000005
TL3=e3000000-0000-0000-0000-000000000006
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$NC','$A','note','{\"title\":\"Roster\",\"category\":\"\",\"connections\":[{\"kind\":\"person\",\"targetId\":\"$P1\"},{\"kind\":\"event\",\"targetId\":\"$EV1\"}]}'), ('$TL3','$A','task','{\"text\":\"Book\",\"category\":\"\",\"done\":false,\"projectId\":\"$PROJ_A\"}'), ('$D0','$A','decision_record','{\"decision\":\"Cap at 2400\"}'), ('$D1','$A','decision_record','{\"decision\":\"Cap at 2600\",\"supersedesId\":\"$D0\"}')" >/dev/null
as_user $A $AUTH "select item_apply_patch('$D0','{\"supersededById\":\"$D1\"}')" >/dev/null
check "a note connection to a person is about, another kind is mentions, a project id is in, a supersedes is replaces and replaced_by" "about:person mentions:event|in:project|replaces:decision_record|replaced_by:decision_record" \
  "$(q -c "select string_agg(kind||':'||to_type, ' ' order by kind) from item_link where from_item='$NC'")|$(q -c "select kind||':'||to_type from item_link where from_item='$TL3'")|$(q -c "select kind||':'||to_type from item_link where from_item='$D1'")|$(q -c "select kind||':'||to_type from item_link where from_item='$D0'")"
TL4=e3000000-0000-0000-0000-000000000007
N2=e3000000-0000-0000-0000-000000000008
TLS=e3000000-0000-0000-0000-000000000009
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$TL4','$A','task','{\"text\":\"Run\",\"category\":\"$P1\",\"extraCategories\":[\"$P2\"],\"done\":false}'), ('$N2','$A','note','{\"title\":\"Found\",\"category\":\"\",\"found\":[{\"targetId\":\"$P1\"}]}')" >/dev/null
check "category and found paths project nothing; a self pointer saves the item and projects no link" "0|ok|1|0" "$(q -c "select count(*) from item_link where from_item in ('$TL4','$N2')")|$(as_user_state $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$TLS','$A','task','{\"text\":\"Me\",\"category\":\"\",\"done\":false,\"eventId\":\"$TLS\"}')")|$(q -c "select count(*) from item where id='$TLS'")|$(q -c "select count(*) from item_link where from_item='$TLS'")"
as_user $A $AUTH "delete from item where id='$P2'" >/dev/null
GONE=$(q -c "select (to_item is null)||'|'||target||'|'||coalesce(to_type,'') from item_link where from_item='$TL2'")
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$P2','$A','person','{\"name\":\"Sam\",\"categoryIds\":[]}')" >/dev/null
check "deleting the target nulls to_item and keeps target; recreating it under the same id heals it" "true|$P2|person|$P2|person" "$GONE|$(q -c "select to_item||'|'||to_type from item_link where from_item='$TL2'")"
as_user $A $AUTH "delete from item where id='$TL1'" >/dev/null
AFTER_DEL=$(q -c "select count(*) from item_link where from_item='$TL1'")
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$TL1','$A','task','{\"text\":\"Call Mike\",\"category\":\"\",\"done\":false,\"personId\":\"$P1\"}')" >/dev/null
check "deleting the source cascades its outbound links; recreating it recreates them" "0|about|personId|user||person|false" "$AFTER_DEL|$(links $TL1)"
TLB=e3000000-0000-0000-0000-00000000000b
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$TLB','$A','task','{\"text\":\"Peek\",\"category\":\"\",\"done\":false,\"projectId\":\"$PROJ_B\"}')" >/dev/null
check "a pointer at another owner's row lands with to_item null and B reads nothing" "true|$PROJ_B|$(q -c "select count(*) from item_link where owner_id='$B'")" "$(q -c "select (to_item is null)||'|'||target from item_link where from_item='$TLB'")|$(as_user $B $AUTH "select count(*) from item_link")"
LINK1=$(q -c "select id from item_link where from_item='$TL1'")
check "the browser cannot write item_link, nor run the backfill" "42501|42501|42501|42501" "$(as_user_state $A $AUTH "insert into item_link (owner_id, from_item, from_type, target, kind, path, created_by) values ('$A','$TL1','task','$P2','about','personId','user')")|$(as_user_state $A $AUTH "update item_link set kind='mentions' where id='$LINK1'")|$(as_user_state $A $AUTH "delete from item_link where id='$LINK1'")|$(as_user_state $A $AUTH "select jarvis_link_project_all()")"
check "the backfill marked what it found" "in|projectId|operator|backfill_0060|project|false|true|$MISSING|0" "$(links $PRE_LINKED)|$(q -c "select (to_item is null)||'|'||target from item_link where from_item='$PRE_DANGLING'")|$(q -c "select jarvis_link_project_all()")"

TLE=e3000000-0000-0000-0000-00000000000e
as_user $A $AUTH "insert into item (id, owner_id, entity_type, data) values ('$TLE','$A','task','{\"text\":\"Becomes an event\",\"category\":\"\",\"done\":false,\"projectId\":\"$PROJ_A\",\"personId\":\"$P1\"}')" >/dev/null
BEFORE_E=$(q -c "select string_agg(kind||'|'||path||'|'||from_type, ' ; ' order by path) from item_link where from_item='$TLE'")
as_user $A $AUTH "update item set entity_type = 'event' where id='$TLE'" >/dev/null
check "a change of entity_type alone writes a history row with the two type words and recomputes the links for the new kind (from_type follows, a path the new kind lacks goes)" \
  "about|personId|task ; in|projectId|task|2|update|user|{entity_type}|{\"entity_type\": \"task\"}|{\"entity_type\": \"event\"}|in|projectId|event" \
  "$BEFORE_E|$(q -c "select count(*) from item_change where item_id='$TLE'")|$(q -c "select op||'|'||origin||'|'||changed_keys::text||'|'||before::text||'|'||after::text from item_change where item_id='$TLE' order by at desc, id desc limit 1")|$(q -c "select string_agg(kind||'|'||path||'|'||from_type, ' ; ' order by path) from item_link where from_item='$TLE'")"

echo "-- item_why"
check "item_why answers typed for a hand written task" "typed|user|insert" "$(as_user $A $AUTH "select item_why('$TL1')" | py "print(d['answer']+'|'+d['first']['origin']+'|'+d['first']['op'])")"
check "item_why answers rule for the inferred Mike task and names the link" "rule|about|person|$P2|False" "$(as_user $A $AUTH "select item_why('$TL2')" | py "l=d['links_out'][0]; print(d['answer']+'|'+l['kind']+'|'+l['to_type']+'|'+l['to_item']+'|'+str(l['gone']))")"
check "item_why answers function via capture_approve for the email task and carries its action, receipt and evidence" "function|capture_approve|1|capture_task|1|confirmed|verified_jarvis|1|email" \
  "$(as_user $A $AUTH "select item_why('$EMAIL_TASK')" | py "a=d['actions']; r=a[0]['receipts']; e=d['evidence']; print('|'.join([d['answer'], d['first']['via'], str(len(a)), a[0]['kind'], str(len(r)), r[0]['state'], r[0]['assurance'], str(len(e)), e[0]['type']]))")"
check "item_why answers unknown for a row with no change row" "unknown|None|0" "$(as_user $A $AUTH "select item_why('$TASK_A')" | py "print(d['answer']+'|'+str(d['first'])+'|'+str(len(d['changes'])))")"
check "item_why is the owner's alone" "|42501" "$(as_user $B $AUTH "select item_why('$TL1')")|$(as_user_state $A anon "select item_why('$TL1')")"

echo "-- retention, readiness, account deletion"
check "item_change_prune is service only" 42501 "$(as_user_state $A $AUTH "select item_change_prune(interval '0 seconds')")"
ITEMS_WITH_HISTORY=$(q -c "select count(distinct item_id) from item_change")
PRUNED=$(as_user $A $SVC "select item_change_prune(interval '0 seconds')")
check "item_change_prune keeps each item's first row" "t|$ITEMS_WITH_HISTORY|0" "$(test "$PRUNED" -gt 0 && echo t)|$(q -c "select count(distinct item_id) from item_change")|$(q -c "select count(*) from (select item_id from item_change group by item_id having count(*) > 1) x")"
check "readiness carries migration 0060, phase0.memory true, inbox false, private false" "0060|True|False|False" "$(as_user $A $AUTH "select substrate_readiness()" | py "p=d['phase0']; print(d['migration']+'|'+str(p['memory'])+'|'+str(p['inbox'])+'|'+str(p['private']))")"
CP=e4000000-0000-0000-0000-000000000001
CT=e4000000-0000-0000-0000-000000000002
q -c "insert into item (id, owner_id, entity_type, data) values ('$CP','$C','project','{\"title\":\"C project\",\"status\":\"active\"}'), ('$CT','$C','task','{\"text\":\"C task\",\"category\":\"\",\"done\":false,\"projectId\":\"$CP\"}')" >/dev/null
A_HIST=$(q -c "select count(*) from item_change where owner_id='$A'")
check "delete_owned reaches both tables, last" "2|1|0|0|0|$A_HIST" "$(q -c "select count(*) from item_change where owner_id='$C'")|$(q -c "select count(*) from item_link where owner_id='$C'")|$(as_user $A $SVC "select delete_owned('$C')" >/dev/null; q -c "select count(*) from item where owner_id='$C'")|$(q -c "select count(*) from item_change where owner_id='$C'")|$(q -c "select count(*) from item_link where owner_id='$C'")|$(q -c "select count(*) from item_change where owner_id='$A'")"

echo "-- write cost: 1,000 patches with and without the trigger"
BENCH=e5000000-0000-0000-0000-000000000001
q -c "insert into item (id, owner_id, entity_type, data) values ('$BENCH','$A','task','{\"text\":\"bench\",\"category\":\"\",\"done\":false,\"personId\":\"$P1\"}')" >/dev/null
q -c "create function memory_bench(p_id uuid, p_n integer) returns double precision language plpgsql as \$b\$ declare t0 timestamptz; i integer; begin t0 := clock_timestamp(); for i in 1..p_n loop perform item_apply_patch(p_id, jsonb_build_object('text', 'bench ' || i)); end loop; return extract(epoch from clock_timestamp() - t0); end \$b\$" >/dev/null
q -c "alter table item disable trigger item_memory" -c "select memory_bench('$BENCH', 300)" >/dev/null
WITHOUT=$(q -c "select least(memory_bench('$BENCH', 1000), memory_bench('$BENCH', 1000))")
q -c "alter table item enable trigger item_memory" -c "select memory_bench('$BENCH', 300)" >/dev/null
WITH=$(q -c "select least(memory_bench('$BENCH', 1000), memory_bench('$BENCH', 1000))")
RATIO=$(python3 -c "print(round($WITH / $WITHOUT, 2))")
echo "note write cost ratio $RATIO (1,000 patches: ${WITH}s with the trigger, ${WITHOUT}s without)"
check "write cost: the ratio with the trigger is under 3.0" t "$(python3 -c "print('t' if $RATIO < 3.0 else 'f')")"
q -c "drop function memory_bench(uuid, integer)" >/dev/null

echo "-- posture"
NEW_FNS="'jarvis_link_paths','jarvis_links_of','jarvis_link_project_all','jarvis_item_memory','jarvis_item_change_append_only','history_erase','item_change_prune','item_why','item_apply_patch','item_apply_patch_if_older','set_monotonic_updated_at','substrate_readiness','delete_owned'"
check "every new function is revoked from PUBLIC, carries search_path, and no browser role executes item_change_prune, jarvis_item_memory or jarvis_link_project_all" "0|0|13|false|false|false|false|false|false" \
  "$(q -c "select count(*) filter (where p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE')) || '|' || count(*) filter (where not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')) || '|' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ($NEW_FNS)")|$(q -c "select has_function_privilege('authenticated','item_change_prune(interval)','execute')||'|'||has_function_privilege('anon','item_change_prune(interval)','execute')||'|'||has_function_privilege('authenticated','jarvis_item_memory()','execute')||'|'||has_function_privilege('anon','jarvis_item_memory()','execute')||'|'||has_function_privilege('authenticated','jarvis_link_project_all()','execute')||'|'||has_function_privilege('anon','jarvis_link_project_all()','execute')")"

echo "-- rollback, then forward again"
q -f "$here/../rollback/0060_memory_down.sql" >/dev/null
check "rollback drops the two tables, the trigger and the eight functions and restores the five bodies" "0|0|0|p_id uuid, p_patch jsonb|f|0044|f" \
  "$(q -c "select count(*) from pg_tables where schemaname='public' and tablename in ('item_change','item_link')")|$(q -c "select count(*) from pg_trigger where tgrelid='item'::regclass and tgname='item_memory'")|$(q -c "select count(*) from pg_proc where proname in ('item_why','item_change_prune','history_erase','jarvis_item_change_append_only','jarvis_item_memory','jarvis_link_project_all','jarvis_links_of','jarvis_link_paths')")|$(q -c "select pg_get_function_identity_arguments('item_apply_patch'::regproc)")|$(q -c "select pg_get_functiondef('item_apply_patch_if_older'::regproc) like '%jarvis.client_at%'")|$(q -c "select substrate_readiness()->>'migration'")|$(q -c "select pg_get_functiondef('delete_owned'::regproc) like '%item_change%'")"
check "the old patch function still merges after the rollback" t "$(as_user $A $AUTH "select item_apply_patch('$TL1','{\"text\":\"after rollback\"}')")"
q -f "$here/../migrations/0060_memory.sql" >/dev/null
check "forward again after a rollback" "$COUNTS1|t" "$(counts)|$(q -c "select count(*) > 0 from item_link where created_by='operator' and via='backfill_0060'")"

[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILURES"; exit 1; }
