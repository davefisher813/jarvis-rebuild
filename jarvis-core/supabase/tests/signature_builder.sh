#!/usr/bin/env bash
# Real-Postgres proof for migration 0072 (the email signature builder; issue 113, Dave 2026-10-13: "Upload a pic. It auto
# scales. Enter your info and it creates a perfect signature.").
#
# Usage: eval "$(./local_pg.sh start)"; ./signature_builder.sh
#
# What it proves:
#   email_signature_build_set saves the six info fields (blank ones simply absent), composes the lines in a fixed order,
#     keeps ONE picture reference, bumps the signature revision, and refuses a stale revision with the current state
#   it refuses what could do harm: an unknown field, a non-text value, a control character, a field over its length, an
#     empty signature, a picture outside the owner's own folder, a ".." or empty path segment, a picture nobody uploaded,
#     a type that is not PNG or JPEG, a bad hash, a size or dimension out of range (a thin logo is fine), another owner's account, a caller who
#     is not the owner, and no caller at all
#   email_signature_set (the plain editor) puts the account back to plain text and removes the picture
#   email_accounts() carries the three new keys
#   send_review adds the picture to the reviewed snapshot ONLY while the draft still ends with the account's current block
#     and was made against its current signature revision; edit the block, move the revision, or use plain text: no picture
#   the reference is part of what the review stored (the payload the hash binds)
#   rollback puts the old bodies back (no picture rides, the builder door is gone) and forward runs again
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB=signature_builder_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0" >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
as_user() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -c "set role $2" -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', false)" -c "$3" 2>&1 | tail -1; }
as_anon() { PGOPTIONS="-c client_min_messages=warning" psql -qAt -d "$DB" -c "set role anon" -c "$1" 2>&1 | tail -1; }
jget() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d
for k in sys.argv[1].split('.'):
    v=v[int(k)] if isinstance(v,list) else v.get(k)
print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))" "$1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi; }
flat() { tr '\n' '|'; }

echo "-- forward: stub + chain, fixtures"
q -f "$here/stub_supabase.sql" >/dev/null
for f in $(ls "$here"/../migrations/*.sql | sort); do q -f "$f" >/dev/null; done
q -f "$here/fixtures/substrate_fixtures.sql" >/dev/null
check "0072 forwards twice (idempotent)" ok "$(q -f "$here/../migrations/0072_email_signature_builder.sql" >/dev/null && echo ok)"

A=00000000-0000-0000-0000-00000000000a
B=00000000-0000-0000-0000-00000000000b
ACCT_A=60000000-0000-0000-0000-00000000000a
ACCT_B=60000000-0000-0000-0000-00000000000b
AUTH=authenticated
SHA=$(printf 'a%.0s' $(seq 1 64))
PATH_A="$A/signature-$ACCT_A/k3j2h1g0-signature.png"
q -c "insert into storage.buckets (id, name) values ('user-files', 'user-files') on conflict do nothing" -c "insert into storage.objects (bucket_id, name, owner) values ('user-files', '$PATH_A', '$A'), ('user-files', '$B/signature-$ACCT_B/b-signature.png', '$B')" >/dev/null
IMG="{\"storage_id\":\"$PATH_A\",\"sha256\":\"$SHA\",\"size_bytes\":23456,\"mime_type\":\"image/png\",\"width\":192,\"height\":128}"
FIELDS='{"name":"Dave Fisher","title":"  Founder ","organization":"Bridge","phone":"","email":"dave@example.test","website":"   "}'
build() { as_user "${1:-$A}" $AUTH "select email_signature_build_set('${1:-$A}','${2:-$ACCT_A}','${3:-$FIELDS}'::jsonb,${4:-"'$IMG'::jsonb"},${5:-null})"; }

echo "-- the account starts as plain text, nothing built"
check "kind text, no fields, no picture, revision 1" "text|{}||1" "$(q -c "select signature_kind || '|' || signature_fields::text || '|' || coalesce(signature_image::text, '') || '|' || signature_revision from email_account where id='$ACCT_A'")"

echo "-- a built signature: fields in a fixed order, blank ones absent, one picture, the revision moves"
R1=$(build)
check "the lines: name, title (trimmed), organization, email; phone and website (blank) absent" "Dave Fisher|Founder|Bridge|dave@example.test" "$(echo "$R1" | jget signature_text | flat | sed 's/|$//')"
check "kind built, revision 2" "built|2" "$(echo "$R1" | jget signature_kind)|$(echo "$R1" | jget signature_revision)"
check "the saved fields keep only the filled ones (trimmed)" "Bridge|Dave Fisher|Founder|dave@example.test" "$(echo "$R1" | jget signature_fields | python3 -c "import json,sys; d=json.load(sys.stdin); print('|'.join(sorted(d.values())))")"
check "the picture reference is kept as sent (types normalised)" "$PATH_A|23456|image/png|192|128" "$(echo "$R1" | jget signature_image.storage_id)|$(echo "$R1" | jget signature_image.size_bytes)|$(echo "$R1" | jget signature_image.mime_type)|$(echo "$R1" | jget signature_image.width)|$(echo "$R1" | jget signature_image.height)"
check "the stored column is what the door returned" "built|2|Dave Fisher" "$(q -c "select signature_kind || '|' || signature_revision || '|' || (signature_fields->>'name') from email_account where id='$ACCT_A'")"
check "jarvis_signature_text agrees with the stored text (the one definition)" "$(q -c "select signature_text from email_account where id='$ACCT_A'" | flat)" "$(q -c "select jarvis_signature_text(signature_fields) from email_account where id='$ACCT_A'" | flat)"
check "email_accounts() carries kind, fields and image" "built|Dave Fisher|$PATH_A" "$(as_user $A $AUTH "select email_accounts()" | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(d['signature_kind']+'|'+d['signature_fields']['name']+'|'+d['signature_image']['storage_id'])")"

echo "-- a picture is optional; a signature with nothing in it is not a built one"
R2=$(build "$A" "$ACCT_A" '{"name":"Dave"}' null 2)
check "info only: built, no picture, revision 3" "built||3" "$(echo "$R2" | jget signature_kind)|$(echo "$R2" | jget signature_image)|$(echo "$R2" | jget signature_revision)"
check "an empty object is refused (empty)" "INVALID_PAYLOAD|empty" "$(build "$A" "$ACCT_A" '{}' null | jget error)|$(build "$A" "$ACCT_A" '{}' null | jget detail)"
check "all-blank fields are refused (empty)" "empty" "$(build "$A" "$ACCT_A" '{"name":"  ","title":""}' null | jget detail)"

echo "-- the optimistic revision"
check "a stale revision answers SIGNATURE_CONFLICT with the current state" "SIGNATURE_CONFLICT|3|built" "$(build "$A" "$ACCT_A" "$FIELDS" "'$IMG'::jsonb" 1 | jget error)|$(build "$A" "$ACCT_A" "$FIELDS" "'$IMG'::jsonb" 1 | jget signature_revision)|$(build "$A" "$ACCT_A" "$FIELDS" "'$IMG'::jsonb" 1 | jget signature_kind)"
check "the matching revision saves" "4" "$(build "$A" "$ACCT_A" "$FIELDS" "'$IMG'::jsonb" 3 | jget signature_revision)"

echo "-- what it refuses"
bad() { build "$A" "$ACCT_A" "$1" "${2:-"'$IMG'::jsonb"}" | jget detail; }
check "an unknown field" "fields" "$(bad '{"name":"D","nickname":"x"}')"
check "a value that is not text" "fields" "$(bad '{"name":5}')"
check "a control character (a line break) in a field" "fields" "$(bad '{"name":"D\nEvil: header"}')"
check "a name over 200 characters" "fields" "$(bad "{\"name\":\"$(printf 'x%.0s' $(seq 1 201))\"}")"
check "an email over 254 characters" "fields" "$(bad "{\"email\":\"$(printf 'x%.0s' $(seq 1 255))\"}")"
check "fields that are not an object" "fields" "$(bad '["name"]')"
IMGJ() { echo "{\"storage_id\":\"${1:-$PATH_A}\",\"sha256\":\"${2:-$SHA}\",\"size_bytes\":${3:-23456},\"mime_type\":\"${4:-image/png}\",\"width\":${5:-192},\"height\":${6:-128}}"; }
check "a picture in another owner's folder" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$B/signature-$ACCT_B/b-signature.png")'::jsonb")"
check "a path that climbs out of the folder (..)" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$A/../$B/x.png")'::jsonb")"
check "an empty path segment" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$A//x.png")'::jsonb")"
check "a picture nobody uploaded" "image_missing" "$(bad '{"name":"D"}' "'$(IMGJ "$A/signature-$ACCT_A/never-uploaded.png")'::jsonb")"
check "a type that is not PNG or JPEG" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$PATH_A" "$SHA" 23456 image/gif)'::jsonb")"
check "a hash that is not 64 lowercase hex" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$PATH_A" "$(printf 'A%.0s' $(seq 1 64))")'::jsonb")"
check "a size over 60000 bytes" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$PATH_A" "$SHA" 60001)'::jsonb")"
check "a size of zero" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$PATH_A" "$SHA" 0)'::jsonb")"
check "a width of zero" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$PATH_A" "$SHA" 23456 image/png 0 128)'::jsonb")"
check "a height over 512" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$PATH_A" "$SHA" 23456 image/png 192 513)'::jsonb")"
check "a size that is not a whole number" "image" "$(bad '{"name":"D"}' "'$(IMGJ "$PATH_A" "$SHA" 1.5)'::jsonb")"
check "another owner's account is not found" "NOT_FOUND" "$(build "$B" "$ACCT_A" '{"name":"B"}' null | jget error)"
check "p_owner that is not the caller is refused" "AUTH_REQUIRED" "$(as_user "$B" $AUTH "select email_signature_build_set('$A','$ACCT_A','{\"name\":\"X\"}'::jsonb,null,null)" | jget error)"
ANON_OUT=$(as_anon "select email_signature_build_set('$A','$ACCT_A','{\"name\":\"X\"}'::jsonb,null,null)" || true)
case "$ANON_OUT" in *"permission denied"*) ANON_OK=ok ;; *) ANON_OK="no: $ANON_OUT" ;; esac
check "no caller at all (the anon role) cannot call it" ok "$ANON_OK"
check "a refused save changed nothing (revision still 4, still built)" "4|built" "$(q -c "select signature_revision || '|' || signature_kind from email_account where id='$ACCT_A'")"

echo "-- send_review carries the picture only while the draft still ends with the current block"
SIG_TEXT=$(q -c "select signature_text from email_account where id='$ACCT_A'")
REVN=$(q -c "select signature_revision from email_account where id='$ACCT_A'")
mkdraft() { # body, signature_revision -> draft id
  local body="$1" rev="$2" f
  f=$(python3 -c "import json,sys; print(json.dumps({'to_addresses':['coach@example.test'],'subject':'Hello','body_text':sys.argv[1],'signature_revision':(None if sys.argv[2]=='null' else int(sys.argv[2])),'reply_headers':{'in_reply_to':None,'references':[],'thread_id':None},'thread_id':None}))" "$body" "$rev")
  as_user $A $AUTH "select draft_save(null,'$ACCT_A','$f'::jsonb)" | jget draft_id
}
BODY=$(printf 'Thanks, see you Tuesday.\n\n-- \n%s' "$SIG_TEXT")
D1=$(mkdraft "$BODY" "$REVN")
RV1=$(as_user $A $AUTH "select send_review('$D1')")
check "an untouched block at the current revision: the picture rides" "$PATH_A|Dave Fisher" "$(echo "$RV1" | jget exact.signature.image.storage_id)|$(echo "$RV1" | jget exact.signature.fields.name)"
check "the body is exactly what was typed (the lines appear once, in the text)" "$BODY" "$(echo "$RV1" | jget exact.body_text)"
check "the stored payload the hash binds holds the reference" "$PATH_A" "$(q -c "select payload->'signature'->'image'->>'storage_id' from outbox_command where action_id='$(echo "$RV1" | jget review.action_id)'")"
D2=$(mkdraft "$(printf 'Thanks.\n\n-- \n%s edited' "$SIG_TEXT")" "$REVN")
check "the block was edited: no picture" "" "$(as_user $A $AUTH "select send_review('$D2')" | jget exact.signature)"
D3=$(mkdraft "$(printf 'Thanks.\n\n-- \n%s\nP.S. one more thing' "$SIG_TEXT")" "$REVN")
check "words after the block: no picture" "" "$(as_user $A $AUTH "select send_review('$D3')" | jget exact.signature)"
D4=$(mkdraft "$BODY" "$((REVN - 1))")
check "a draft made against an older signature revision: no picture" "" "$(as_user $A $AUTH "select send_review('$D4')" | jget exact.signature)"
D5=$(mkdraft "$BODY" null)
check "a draft that never recorded a revision: no picture" "" "$(as_user $A $AUTH "select send_review('$D5')" | jget exact.signature)"
D6=$(mkdraft "No signature at all" "$REVN")
check "no block in the body: no picture" "" "$(as_user $A $AUTH "select send_review('$D6')" | jget exact.signature)"
R3=$(build "$A" "$ACCT_A" '{"name":"Dave Fisher","email":"dave@example.test"}' null "$REVN")
check "info only, no picture: nothing rides even with an untouched block" "" "$(as_user $A $AUTH "select send_review('$(mkdraft "$(printf 'Hi\n\n-- \n%s' "$(echo "$R3" | jget signature_text)")" "$(echo "$R3" | jget signature_revision)")')" | jget exact.signature)"
check "the signature moved on: the older draft (made at the old revision) sends no picture" "" "$(as_user $A $AUTH "select send_review('$(mkdraft "$BODY" "$REVN")')" | jget exact.signature)"

echo "-- the plain editor puts the account back to plain text and removes the picture"
R4=$(build "$A" "$ACCT_A" "$FIELDS" "'$IMG'::jsonb")
REV4=$(echo "$R4" | jget signature_revision)
P1=$(as_user $A $AUTH "select email_signature_set('$A','$ACCT_A','Typed by hand',$REV4)")
check "plain save: text kind, no fields, no picture, revision moved" "text|{}||$((REV4 + 1))|Typed by hand" "$(echo "$P1" | jget signature_kind)|$(echo "$P1" | jget signature_fields)|$(echo "$P1" | jget signature_image)|$(echo "$P1" | jget signature_revision)|$(echo "$P1" | jget signature_text)"
D7=$(mkdraft "$(printf 'Hi\n\n-- \nTyped by hand')" "$((REV4 + 1))")
check "a plain-text account sends no picture" "" "$(as_user $A $AUTH "select send_review('$D7')" | jget exact.signature)"

echo "-- rollback: the old bodies come back, nothing rides, the builder door is gone; forward runs again"
q -f "$here/../rollback/0072_email_signature_builder_down.sql" >/dev/null
check "rolled back: email_accounts() has no kind key" "False" "$(as_user $A $AUTH "select email_accounts()" | python3 -c "import json,sys; print('signature_kind' in json.load(sys.stdin)[0])")"
check "rolled back: the builder door is gone" "0" "$(q -c "select count(*) from pg_proc where proname in ('email_signature_build_set','jarvis_signature_text')")"
check "rolled back: the three columns are gone" "0" "$(q -c "select count(*) from information_schema.columns where table_name='email_account' and column_name in ('signature_kind','signature_fields','signature_image')")"
check "rolled back: the plain editor still saves" "Plain again" "$(as_user $A $AUTH "select email_signature_set('$A','$ACCT_A','Plain again',null)" | jget signature_text)"
check "rolled back: send_review still reviews a draft" "Hello" "$(as_user $A $AUTH "select send_review('$(mkdraft 'Body' 1)')" | jget exact.subject)"
check "forward runs again after the rollback" ok "$(q -f "$here/../migrations/0072_email_signature_builder.sql" >/dev/null && echo ok)"
check "forward again: a built save works" "built" "$(build "$A" "$ACCT_A" '{"name":"Again"}' null | jget signature_kind)"
check "a very wide, thin logo (192 by 6) is a valid picture" "6" "$(build "$A" "$ACCT_A" '{"name":"Again"}' "'$(IMGJ "$PATH_A" "$SHA" 23456 image/png 192 6)'::jsonb" | jget signature_image.height)"

echo
if [ "$fail" = "0" ]; then echo "signature_builder: all checks passed"; else echo "signature_builder: FAILURES"; exit 1; fi
