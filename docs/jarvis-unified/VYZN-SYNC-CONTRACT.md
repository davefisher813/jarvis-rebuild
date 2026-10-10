# The VYZN sync contract

Shared between JARVIS and the apps that hand it records: the agent backend's inbox today
(jarvis-backend `family/`), Bridge and Tucci reserved. Written 2026-10-10 (Phase 0, design D5 and
D6). The database is `jarvis-core/supabase/migrations/0062_vyzn_inbox.sql`; the gateway method is
`jarvis-app/src/substrate/gateway/protocol.ts` and `handler.ts`; the pull is
`jarvis-app/src/push/proxy.ts` with `src/substrate/records/envelope.ts`; the proof is
`jarvis-core/supabase/tests/inbox.sh` (30 checks). If an app's shape changes, the proof and the
handler tests are what go red, and this page is what says who moves.

The one sentence: **an app proposes; it never commits.** Every record an app sends lands as a
proposal in JARVIS's inbox. Dave's tap makes the item. Nothing an app sends can overwrite a row
Dave owns, and a backend item is consumed only once Dave has taken it. `family/README.md`:
"Dave's input in the JARVIS app always wins" is a constraint here, not a convention.

## The two legs

| leg | who calls | door | credential | writes |
|---|---|---|---|---|
| push | the app, on its own schedule | `POST /api/agent` with method `record.push` | the app's agent token (`jarvis_agent_...`), minted by `vyzn_app_connect` | `record_push(p_owner, p_connection, p_source_app, p_records)`, service request only |
| pull | JARVIS, on Dave's tap | `POST /api/push?inbox=pull` | Dave's own session (Supabase JWT); the proxy adds `x-jarvis-secret` for the backend hop | `records_import(p_source_app, p_records)` as the person, owner from `auth.uid()` |

Both legs run one body, `jarvis_records_ingest`. Neither consults `jarvis_ai_switch`: a
deterministic transfer is not inference, and the feed works with AI off (the proof asserts the
contrast: `proposal_submit` on the same connection answers `ADMIN_AI_DISABLED`, `record_push`
answers `proposed`). Both legs are behind the `vyzn_sync_v1` build flag: off, the method answers
`503 UNAVAILABLE` and the pull answers `404`.

## The envelope

```json
{
  "protocol_version": 1,
  "method": "record.push",
  "params": {
    "source_app": "backend-inbox",
    "records": [
      {
        "source_record_id": "inbox_11111111-1111-4111-8111-111111111111",
        "revision": 1,
        "kind": "task",
        "data": { "text": "Send the grant letter", "due": "2026-10-01", "notes": "Priority High" },
        "source": { "label": "Added by Michael Corleone" },
        "client_at": "2026-10-09T12:00:00.000Z"
      }
    ]
  }
}
```

The PARAM_SCHEMA (`protocol.ts`), which `validate` applies before any function runs and which refuses
every property it does not name:

| field | rule |
|---|---|
| `source_app` | one of `VYZN_APPS`: `backend-inbox`, `bridge`, `tucci` (the TS mirror of `jarvis_vyzn_apps()`) |
| `records` | 1 to `LIMITS.recordsPerPush` (50) items |
| `source_record_id` | 1 to 128 characters matching `^[A-Za-z0-9._:-]+$` |
| `revision` | an integer, 1 to 2147483647 |
| `kind` | one of `RECORD_KINDS`: `task`, `event`, `note`, `person` |
| `data` | a JSON object under `LIMITS.recordBytes` (8192 bytes) |
| `source` | optional; `{ url?: string (512), label?: string (120) }` and nothing else |
| `client_at` | optional; an ISO timestamp, `^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$`, finite and no later than one day after the server's clock (`INVALID_PAYLOAD`, `detail: client_at`, otherwise) |

Inside `data`, four words are the server's alone and are refused when an app sends them:
`previous_item`, `destination_id`, `clientId`, `source`. The authority keys (`approved`,
`approved_by`, `approval`, `status`, `execute`, `executed`, `owner_id`, `user_id`, `actor`,
`capabilities`, `mode`, `confirmed`) are refused at any depth, in the handler and again in SQL.

## Per record outcomes

The answer is `{ received, written, results: [...], receipt_id, replay }` with one result per record,
each carrying `source_record_id` and `revision`:

| outcome | when | what was written |
|---|---|---|
| `proposed` | a new revision with no saved item | one proposal; `superseded` counts the older open revisions of the same record that stepped aside |
| `replay` | this revision was received before (same key, same bytes) | nothing; `status` is the proposal's (`proposed`, `accepted`, `dismissed`, `superseded`) |
| `already_saved` | the record is saved and this revision is at or below the highest accepted one | nothing; `item_id` names the row |
| `newer_revision_proposed` | the record is saved and this revision is above the accepted one | one proposal carrying `previous_item`; `record_approve` will refuse it (below) |

One arrival receipt per call that wrote anything, in Hub > Activity: `Received 3 Records From
Backend Inbox` (singular `Received 1 Record From Backend Inbox`), credited to the app when its
connection row exists, to You otherwise. A whole batch replay finds the first receipt and writes no
second. The HTTP status is 201 for a first push and 200 for a whole replay.

## Batch refusals: nothing partial

A batch with one bad record is refused whole and writes nothing. `INVALID_PAYLOAD` carries `detail`
(the field) and the `source_record_id`:

- `source_app` not an app, or not the connection's `provider_key`
- `records` not 1 to 50, or over 262144 bytes in all
- a record with a property the schema does not name, an authority key anywhere, a reserved word inside `data`
- `source_record_id`, `revision`, `kind`, `data`, `source` or `client_at` outside the table above
- the same `source_record_id` twice in one batch (`detail: duplicate`)

`IDEMPOTENCY_CONFLICT` with the `source_record_id`: a revision received before with different bytes.
Replays inside a clean batch are answered per record, not refused. Two pushes of the same new batch at
the same moment are safe: the one that commits second answers `replay` for the records the first
landed (and the first's receipt), or `IDEMPOTENCY_CONFLICT` and nothing written when the same key
carries other bytes; it never surfaces a constraint error.

## Identity

A record's key is `source_app:source_record_id` and its idempotency key is `key:revision`. On
approve the item carries `data.clientId = key`, which migration 0039's partial unique index makes
one row per record whatever device or path landed it, and `data.source = { type: "app", ref: key,
ts }` with `ts` from `client_at` (or the approval moment). Both are written by `record_approve`
over whatever the adapter prepared; an app cannot set either. `item_why(item)` answers `import` for
such a row and names the evidence (`type app`, `source_app`, `source_record_id`) and the proposals
whose `client_id` matches.

The backend inbox has no revisions: a changed item there is a new id, so every pulled record is
`revision 1`, and the mapping refuses any id that is not `inbox_<uuid>` (the backend's own
`isInboxId`), so JARVIS can never reach the app's own task list.

## Per kind fields

What `data` carries on the wire, and what `record_approve` writes. The adapter's `p_prepared`
shape is `capture_approve`'s (`ADAPTER-CONTRACT.md`): `{ destination_kind, data, exact_effect,
display_summary, module_version }`; the database's second look is `jarvis_capture_valid`.

| kind | wire `data` (the app sends) | item `data` (the writer's own shape) | must hold |
|---|---|---|---|
| task | `text`, `due?` (YYYY-MM-DD), `notes?` | `TasksService.createTask`: `{ text, category: "", done: false, due?, notes?, clientId, source }` | `text` non empty; `due` ISO if present; never `bill`, `amount`, `amountCents`, `vendor` |
| event | `title`, `date`, `start`, `end?`, `location?` | `ScheduleService.createEvent`: `{ title, date, start, end?, category: "", location?, clientId, source }` | `title`; `date` ISO and `start` HH:MM; `end` HH:MM if present |
| note | `title`, `body?` | `NotesService.insertNote`: `{ title, category, blocks, connections, clientId, source }` | `title` 1 to 200, or a non empty `blocks` array; no bill keys |
| person | `name`, `email?`, `phone?`, `org?` | `people/importMatch.draftFrom`: `{ name, group: "contacts", triageState: "unsorted", clientId, source, email?, phone?, ... }` | `name` 1 to 120; `email` a valid address if present; `phone` at most 40; no bill keys |

Task and event have destination adapters today; note and person approve into the writers' own
shapes and their adapters are Phase 0.5 code. A bill is never any of the four. A kind outside the
four is `INVALID_PAYLOAD` on the wire; a prepared `destination_kind` that does not match the record's
kind is `INVALID_PAYLOAD`; an unregistered destination is `MODULE_UNAVAILABLE` and the proposal
stays.

## Approve, dismiss, undo, and what the sender can observe

- `vyzn_inbox(p_limit)` lists the owner's open app proposals newest first: `{ id, revision,
  record_revision, source_app, source_record_id, client_id, kind, data, source, client_at,
  previous_item, agent_id, created_by, created_at, payload_hash }`. `revision` is the row's (what
  to hand back as `p_expected_revision`); `record_revision` is the app's.
- `record_approve(p_proposal, p_expected_revision, p_shown_payload_hash, p_idempotency_key,
  p_prepared)`: in `capture_approve`'s order. The item is written only when no row carries the
  key; otherwise the receipt reads `Already in Tasks · <Title>` (or Schedule, Notes, People) and
  nothing new is written. One evidence row (`type app`, the record's text as excerpt), one action
  `record_<kind>`, one consumed approval, one confirmed receipt with the per field diff. A second tap
  with the same hash replays; a different hash is `IDEMPOTENCY_CONFLICT`; a changed row is
  `SOURCE_CHANGED`; a dismissed or superseded proposal is `INVALID_PAYLOAD`; a null
  `p_expected_revision` is `INVALID_PAYLOAD` (`detail: expected_revision`) for approve and dismiss alike.
- `record_dismiss(p_proposal, p_expected_revision)`: `proposal_dismiss`'s shape on the app surface.
  The same revision pushed again answers `replay` with `status dismissed`; a higher revision is a
  new proposal.
- `action_undo` removes the item and puts the proposal back to `proposed`, so the inbox row comes
  back exactly as it was. The receipt reads `Removed From Tasks · <Title>` (Schedule, Notes, People).
  A second tap on that row approves it again (a new action under a new key; a third tap with the same
  hash replays the second).
- In Hub > Activity the approval reads `Added to Tasks · <Title>` with `Suggested by Backend Inbox ·
  Approved by You`; Undo and Open are offered (`activity_feed` and `receipt_detail` read `undoable`
  for a `record_%` action; `destinationKindOf` maps `record_task`, `record_event`, `record_note`;
  `record_person` opens nothing until the shell has a person route, Phase 0.5).

What the sender observes: its own push answers (outcome and status per record) and, on the next
push of the same revision, `replay` with `accepted` or `dismissed`. It never sees the item, a
title it did not send, or a count it was not granted. `review.link` and `action.status` are not
widened to the inbox in Phase 0.

## Never overwrite, structurally

A newer revision of a saved record never touches the item. At push it becomes a proposal with
`payload.previous_item` and `payload.previous_updated_at` (`newer_revision_proposed`); at approve,
`record_approve` refuses any proposal carrying `previous_item` with `DESTINATION_CHANGED` and
`difference: [{ field, yours, theirs }]` (`yours` is the item's value, `theirs` the record's) and
writes nothing. One case is not a refusal: when the named item is gone because its approval was
undone, no row holds the record's key and no later revision was accepted, the tap creates the item
(there is nothing to overwrite); if a row does hold the key, the difference is taken against that row. A newer revision before any tap marks the older open proposal `superseded`, so a
stale one can never be approved first. In Phase 0 there is no code path that can change a row Dave
owns from an app's words. Phase 0.5 names the one that would: `record_take(p_proposal, p_fields,
p_expected_item_updated_at)`, Dave's own tap on the difference, with a `Took Theirs · <Title>`
receipt; nothing in Phase 0 forecloses it.

## Consumption: the backend inbox is consumed on Dave's tap

The pull DELETEs `/api/memory/tasks/:id` (the backend's only consume path, `family/routes.js`) ONLY
for a record whose outcome is `already_saved`, or `replay` whose status is `accepted` or
`dismissed`. A `proposed` or `newer_revision_proposed` record stays in the backend inbox, so the
agents and Dave keep reading it there (the `family_read_tasks` promise: "tasks agents added that
Dave has not taken yet") until Dave taps; the next pull after the tap finds `replay accepted` and
consumes it. Taken means accepted or dismissed (Dave's decision 2, the default). A refused batch or
a backend outage deletes nothing. Prospects are not pulled.

The pull answers `{ pulled, proposed, replayed, already, superseded, deleted, refused }`;
`refused` counts backend items the mapping would not send (a non inbox id, an empty text). The
mapping (`backendInboxToRecords`): `text` trimmed to 500, `due` kept when it is a date, `prio`
folded into `notes` as one line (`Priority High`), the agent's roster name as `source.label`
(`Added by Michael Corleone`; an unknown or retired id reads `Added by an Agent`, never a slug),
`createdAt` as `client_at`. The proxy never logs a task's text.

## The mode words for an app

The app's connection row appears in Hub > Agents like any other, with its Mode. For an app the
words have one defined meaning:

| mode | meaning |
|---|---|
| Read Only | pauses pushes: the gateway answers `MODE_CEILING` (403) before `record_push` runs; `record_push` called directly as the service role answers `SCOPE_DENIED` |
| Help Me | accepts pushes (the mode `vyzn_app_connect` mints) |
| Just Handle It | refused: `connection_set_mode` answers `SCOPE_DENIED` with the detail `an app only proposes`; the tap shows the `SCOPE_DENIED` line, Not Shared With This Assistant, and does not render the detail |

Revoking the connection (Hub > Agents, `connection_revoke`) makes every later push
`CONNECTION_REVOKED`. The pull does not need the connection row; with the row present a pulled
record is credited to the app, without it to You.

## The actor rule

`actor_kind` is `agent` when the proposal carries `agent_id` (the app's connection exists, whether
the record arrived by push or by Dave's pull) and `user` otherwise. So a pulled Michael Corleone
task reads `Suggested by Backend Inbox · Approved by You`, never crediting Dave with an agent's
words; and a pull with no connection row reads `You`, because nothing then identifies the writer.
The person is always the initiator; `approved_by` is the person on every approval.

## The apps

| app | `source_app` | display | status in Phase 0 | credential |
|---|---|---|---|---|
| the agent backend's inbox | `backend-inbox` | Backend Inbox | the pull leg is built and proven; the push leg is open to the same connection | Dave mints the row in the SQL editor: `select vyzn_app_connect('<owner uuid>', 'backend-inbox', '<sha256 hex of the token>');` with a token from the `node -e` line `family/README.md` already uses, prefixed `jarvis_agent_` |
| Bridge | `bridge` | Bridge | reserved: the envelope and the kinds are open to it; no connection minted, no record kind named (bridge-app has no task or event model yet) | the same function with `bridge` |
| Tucci | `tucci` | Tucci | reserved, as Bridge | the same function with `tucci` |

The credential: the app's token is held in the pushing app's deploy and sent as
`Authorization: Bearer jarvis_agent_...`; JARVIS stores only `sha256(token)` in
`jarvis_private.agent_credential`. Running `vyzn_app_connect` again rotates the hash and writes a
second `Connected · Backend Inbox` receipt under the next epoch; an old token is gone the moment the
new hash lands. No device identity; no admin screen; Dave's SQL editor is the minting surface.

## LIMITS

| name | value | where |
|---|---|---|
| `requestBytes` | 65536 | the whole request body |
| `recordsPerPush` | 50 | records per envelope (and per pull batch) |
| `recordBytes` | 8192 | one record's `data` |
| `importBytes` | 262144 | the records array in all, checked again in SQL |
| rate | the connection's bucket (`agent_rate_take`), 429 with `retry-after` | |

## Error vocabulary

| code | status | when |
|---|---|---|
| `UNAVAILABLE` | 503 | the flag is off; the database did not answer |
| `AUTH_REQUIRED` | 401 | no token, or no session on the pull |
| `SCOPE_DENIED` | 403 | not the owner's connection; Read Only; not an app; Just Handle It asked for an app |
| `CAPABILITY_UNVERIFIED` | 403 | the connection was not verified to propose |
| `MODE_CEILING` | 403 | the handler's own refusal of a Read Only push, before the function |
| `CONNECTION_REVOKED` | 410 | the row was revoked |
| `INVALID_PAYLOAD` | 422 | any shape or reserved word refusal, whole batch; `detail` names the field |
| `IDEMPOTENCY_CONFLICT` | 409 | a revision received before with different bytes; on approve, a tap with another hash |
| `RATE_LIMITED` | 429 | the bucket |
| `SOURCE_CHANGED` | 409 | approve or dismiss with a stale row revision or hash |
| `DESTINATION_CHANGED` | 409 | approve of a proposal that names a saved item (never overwrite) |
| `MISSING_DETAILS` | 422 | `jarvis_capture_valid` named a field (`bill_is_not_a_task` and friends) |
| `MODULE_UNAVAILABLE` | 503 | the destination kind is not registered |
| `NOT_FOUND` | 404 | a proposal that is not the caller's; the pull without its flag answers a plain 404 `{error: "Not found"}`, not this shape |

## The curl for the pull

Signed in as Dave (a Supabase session JWT), with `vyzn_sync_v1` on the deploy:

```
curl -s -X POST "https://<app host>/api/push?inbox=pull" \
  -H "Authorization: Bearer <supabase session jwt>"
```

answers `{"pulled":1,"proposed":1,"replayed":0,"already":0,"superseded":0,"deleted":0,"refused":0}` on
the first pull of one new backend item (the backend's `inboxCount` is unchanged), and after Dave
approves it in JARVIS, `{"pulled":1,"proposed":0,"replayed":1,"already":0,"superseded":0,"deleted":1,"refused":0}`
with `inboxCount` one lower. The push leg's curl is the agent gateway's, with the envelope above as
the body and the app's token as the bearer: 201 `proposed`, again 200 `replay`, and an envelope
carrying `"approved": true` anywhere is 422.

## What the backend changes in Phase 0: nothing

`GET /api/memory/tasks`, `DELETE /api/memory/tasks/:id` and the `x-jarvis-secret` header are what
the pull uses, exactly as `family/routes.js` has them. No new route, no new field, no new variable
on the backend. The tap that runs the pull from Hub > Agents is Phase 0.5; Phase 0 proves the branch
in `proxy.test.ts` and live with the one curl above.

## Changing it

- A new kind is additive: a row in the per kind table, a branch in `jarvis_capture_valid`, a word
  in `RECORD_KINDS`, a check in `inbox.sh`. Never a kind the destination registry does not hold.
- A new app is a word in `jarvis_vyzn_apps()` and `VYZN_APPS`, a display word in
  `vyzn_app_connect`, and a row in the apps table above. Never a CHECK on `provider_key`.
- A field that would carry authority or identity is never added to `data`; it is the server's.
- `protocol_version` moves only with a reader migration first.
