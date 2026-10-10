# Why JARVIS knows this

Written 2026-10-10 (Phase 0, design D1, D2 and D9). The question a developer
asks of one row, and where the database keeps the answer. The code is
`jarvis-core/supabase/migrations/0060_memory.sql`; the proof is
`jarvis-core/supabase/tests/memory.sh` (39 checks on the local Postgres). Phase 0
ships no screen for any of this: the read is `select item_why('<id>')`.

Where this page and PHASE0-DESIGN.md differ, this page describes the SQL as
written and says what the design said in one clause.

## Which table answers which question

| Question | Table | Written by |
|---|---|---|
| What is this record, and what does it say now? | `item` | the Store, the SQL doors, the server, a hand edit |
| Who wrote it, through which door, when, and what moved? | `item_change` | the `item_memory` trigger only |
| What does it point at, and what points at it? | `item_link` | the `item_memory` trigger only (a projection of the JSONB fields) |
| What did the record itself say about where it came from? | `item.data -> 'source'` | the app, at creation (`shared/provenance.ts`) |
| Which approved command made it? | `action` | `capture_approve` and the other command functions |
| What did that command promise and do, step by step? | `receipt_event` | the same functions, append only |
| What did the command rest on (the email, the record another app sent)? | `source_evidence` | the capture and record functions |
| Was it offered first, and by whom? | `proposal` | `proposal_submit`, and in 0061 `record_push` and `records_import` |

Three logs, three jobs. `item_change` is the history of a plain write: every
insert, update and delete of an item, whoever made it, with no receipt and no
verb. The `action` and `receipt_event` chain is the record of an approved
command: a card the person tapped, a record an app sent, with its verb, its
assurance and its undo. `source_evidence` is what a command was built from,
kept beside the receipt that cites it. A hand typed task has one log entry
and nothing else; an email born task has all three.

## item_why(p_item)

`item_why(uuid) returns jsonb`, SECURITY INVOKER, granted to `authenticated`
and `service_role`. Row level security scopes every join, so another owner's
id answers `null` and `anon` is refused (42501). The shape, built from the
proof's pasted Mike task (ids are examples):

```json
{
  "item":   { "id": "e3000000-0000-0000-0000-000000000002", "entity_type": "task",
              "created_at": "2026-10-10T14:02:11.418Z", "updated_at": "2026-10-10T14:02:11.418Z",
              "client_id": null },
  "source": { "type": "paste", "ts": 1760000000000, "inferred": ["personId"] },
  "first":  { "at": "2026-10-10T14:02:11.418Z", "client_at": "2026-10-10T14:02:11.418Z",
              "origin": "user", "via": null, "op": "insert",
              "changed_keys": ["category", "done", "personId", "source", "text"] },
  "changes": [
    { "id": "7c1f…", "op": "insert", "at": "2026-10-10T14:02:11.418Z", "client_at": "2026-10-10T14:02:11.418Z",
      "origin": "user", "via": null,
      "changed_keys": ["category", "done", "personId", "source", "text"],
      "before": null,
      "after": { "category": "", "done": false, "personId": "e2000000-0000-0000-0000-000000000001",
                 "source": { "type": "paste", "ts": 1760000000000, "inferred": ["personId"] },
                 "text": "Need to follow up with Mike about summer roster" },
      "revision": "2026-10-10T14:02:11.418Z", "erased": false, "erased_at": null }
  ],
  "links_out": [
    { "kind": "about", "path": "personId", "target": "e2000000-0000-0000-0000-000000000001",
      "to_item": "e2000000-0000-0000-0000-000000000001", "to_type": "person", "gone": false,
      "created_by": "rule", "via": null, "created_at": "2026-10-10T14:02:11.418Z" }
  ],
  "links_in":  [],
  "actions":   [],
  "evidence":  [],
  "proposals": [],
  "answer": "rule"
}
```

- `first` is the earliest `item_change` row for the id, or `null`.
- `changes` is the latest 50 rows, newest first; an erased row reads
  `erased: true` with `before` and `after` null.
- `links_out` and `links_in` carry ids and entity types only, never the
  target's data. `gone` is `to_item is null`.
- `actions` are the `action` rows whose `destination_id` is the item
  (`id, kind, state, verb, actor_kind, surface, created_at`), each with its
  `receipts` (`sequence, state, exact_verb, actor_kind, actor_display,
  assurance, occurred_at, diff, evidence_refs, erased_at`).
- `evidence` is every `source_evidence` row those receipts cite. In 0060
  `source_app` and `source_record_id` are null constants; 0061 redefines
  `item_why` with the real columns. The same is true of `proposals.source_app`
  (the design listed the real column for proposals; 0060 selects null).
- `proposals` matches `payload ->> 'client_id'` to `data ->> 'clientId'`.

`answer` is one word, decided in this order: `unknown` when there is no change
row; `rule` when `source.inferred` is a non empty array; `import` when
`source.type` is one of `app, import, google_calendar, contacts, gmail,
apple_calendar, apple_reminders, apple_health`, or the item is a `person`
whose `data.source` is the string `import`; `typed` when the first row's origin
is `user`; otherwise the first row's origin itself (`function`, `server`,
`operator`). The design said `typed` needs `source` null; the SQL answers
`typed` for any user origin that the two source tests above did not claim.

## The four origins, and via

The database derives `origin` in the trigger; no caller declares it. In order:

1. `server` when `auth.role()` is `service_role`.
2. `function` when the PL/pgSQL call stack (`get diagnostics ... pg_context`)
   holds a frame whose function is SECURITY DEFINER (`pg_proc.prosecdef`).
3. `user` when the request role (`current_setting('role', true)`) is `anon` or
   `authenticated` and no definer frame is present. `item_apply_patch` and
   `item_apply_patch_if_older` are invokers, so a browser patch through them
   reads `user` (proven).
4. `operator` otherwise: the SQL editor, psql, a migration's own statements.

`via` is the name of the innermost SECURITY DEFINER frame, set only when the
origin is `function`, so a definer wrapper around `capture_approve` still
reads `via capture_approve` (proven with a wrapper the proof defines and
drops). A service role call reads `server` with `via` null even when it goes
through a definer door, because the server test comes first. The doors that
exist today: `capture_approve` (the proven one), and the design names
`decision_save`, `exploration_keep`, `jarvis_waiting_write` and `action_undo`;
0061 adds `record_approve`. Both columns are checked against
`^[a-z0-9_]{1,64}$`.

A link's `created_by` has two more words than an origin. `import` when `via`
is `record_approve`; `rule` when a browser insert's path leaf (`personId` from
`personId`, `targetId` from `connections[].targetId`) is listed in
`source.inferred`; otherwise the write's origin. On an update the new pointer
is never `rule`: a chip correction reads `user`.

## Per kind: what each of the 45 kinds can answer

Every kind gets `first` and `changes` from the trigger from 0060 on. What else
it can say depends on its Data interface, which `laws/sourceLaw.test.ts` pins
as an exact map over `ALL_ENTITY_TYPES`. Links are the registry rows of
`jarvis_link_paths()` (42 rows; the design said 43).

| Roster (sourceLaw) | Kinds | `source` in `item_why` | `links_out` kinds |
|---|---|---|---|
| Source required (4) | money_bill, money_receipt, strand, brain_memory | the module's own shape, read through `sourceOf()` in the app; the SQL reads `data -> 'source'` as stored | bill: because_of; receipt: matches, attached; strand: mentions; brain_memory: mentions, replaces, replaced_by |
| Source optional (8) | task, event, note, workout, money_tx, decision_record, person, waiting | a `Source` stamp when a machine made the row, none when a hand did; `person` is an enum string with no ref and no when | task: about, in, under, for, from, reminds, triggers; event: from, has, in; note: about, mentions, has; workout: in; money_tx: pays, matches; decision_record: mentions, replaces, replaced_by, because_of, from; waiting: about; person: none out, `about` in |
| Evidence instead (3) | exploration_note, learned_rule, chat_message | none; the chain runs through evidence ids and `provenance.refs` | exploration_note: in, became; chat_message: mentions |
| When only (15) | the ten health loggers, health_consent, metric_def, metric_log, user_file, month_seal | none; `created_at` and `first.client_at` are the fact | ate_before, call_it, bag_check: for; took_it: for; metric_log: in |
| Nothing today (15) | account, money_account, money_budget, money_sub, project, goal, life_area, category, program, profile, routine, brain_doc, health_trusted_adult, health_med_def, health_age_rule_shown | none; each waits for Dave's ruling | project: under; goal: under, because_of; health_trusted_adult: about |

For every `health_%` kind, `health_consent`, `metric_log`, `profile`,
`chat_message`, `user_file` and `brain_doc`, the change rows carry
`changed_keys` and never a value (EXCLUDED_KINDS, below). A row written before
0060 answers `unknown` whatever its kind.

## What is deliberately not recorded

The four rules live as constants at the top of `jarvis_item_memory()`:

- `NOISE_KEYS` = `runLen, bestRun, lastCounted, doneCount`: the key stays in
  `changed_keys`, the value never reaches `before` or `after`
  (`laws/runVocabulary.test.ts` reads this line).
- `BULK_KEYS` = `doc, blocks, versions, revisions, history, gcalHash, found,
  attendees`, and any other value whose jsonb text is over `VALUE_CAP` = 2048
  bytes: recorded as `{"_omitted": "bulk", "bytes": n}`.
- `EXCLUDED_KINDS` = `health_consent, metric_log, profile, chat_message,
  user_file, brain_doc`, plus every `health_%` entity type: keys only.
- JSON null and absence are one value: an insert's `changed_keys` leaves out
  a key whose value is JSON null, a cleared key reads as `null` in `after`,
  patching the same null again writes no row, and an update whose normalised
  diff is empty writes no row (`updated_at` still moves).

Not links, by the registry header: `category`, `extraCategories[]`,
`categoryIds[]`, `tags[]`, `gameCategoryId` and the month_seal keys (a
classification); `fromThread`, `gcalId`, `bookingId`, `clientId`,
`emailIds[]`, `sourceUid` and a non item `source.ref` (external identities);
`note.found[].targetId` (a suggestion not taken);
`exploration_note.evidenceIds[]` and `waiting.sourceEvidenceId` (they point at
`source_evidence`). A pointer at the row itself projects nothing and never
blocks the save.

## Erase, deletion and prune

- **Deleting an item** erases the values of every history row for it
  (`before` and `after` null, `erased_at` set) and writes one `delete` row
  with every key of the old data and no values. `changed_keys` stays on the
  earlier rows. A recreate under the same id writes a fresh insert row and
  `item_why` answers from it. History holds small values while the record
  lives and only facts once it is gone.
- **`history_erase(p_item)`**, for the owner (`auth.uid()`; `AUTH_REQUIRED`
  when none): sets `changed_keys` to `{}`, `before` and `after` to null and
  stamps `erased_at` on the caller's rows for that item; answers
  `{item_id, erased_rows, note: "Erasing history does not undo a change."}`.
  Another owner's id answers `erased_rows: 0`. Erasing a living record blanks
  the key names too; deletion keeps them.
- **Append only.** The browser cannot insert, update or delete `item_change`
  (42501 each). The server may update only `changed_keys`, `before`, `after`
  and `erased_at`, and only when `erased_at` is set; only the server deletes.
- **`item_change_prune(p_older_than interval default '365 days')`** is a
  service request (`jarvis_is_service_request()`, else 42501); it deletes rows
  older than the interval except each item's earliest row, so the origin
  answer survives any retention. Nothing schedules it in Phase 0.
- **`delete_owned`** deletes `item_link` before `item` and `item_change` last,
  because deleting the items writes delete rows into it.
- `item_link` rows need no erasing: an outbound row cascades with its source;
  an inbound row keeps `target` and has `to_item` set null when the target
  goes, and is healed when a row with that id is recreated.

## Which replay shapes carry an age

`client_at` is the capture moment; `at` is the server clock.

| Write | How the age travels | What `client_at` reads |
|---|---|---|
| Queued create | the Store drain passes `op.queuedAt` to `adapter.create`, which inserts `created_at`; the trigger sets `client_at := new.created_at` | the capture moment, before `at` (proven) |
| Live create | no `created_at` given, the default `now()` | equal to `at` |
| Queued update | `adapter.apply(..., op.queuedAt)` calls `item_apply_patch(p_id, p_patch, p_client_at)`, or `adapter.applyIfOlder` calls `item_apply_patch_if_older`; each sets the `jarvis.client_at` setting first | `p_client_at` (proven); a stale `_if_older` patch writes no row |
| Live update | the two argument `item_apply_patch` call | equal to `at` |
| Delete through PostgREST | `adapter.del` accepts `clientAt` and does not send it (`jarvis-core/src/core/supabaseAdapter.ts`, `del`): PostgREST cannot run `set_config` ahead of the DELETE | `now()`; a delete RPC with `p_client_at` is the named fix |
| A queue persisted by an older build | `queuedAt` is absent on its updates and deletes | `now()` |

The setting is transaction local (`set_config(..., true)`), so it never leaks
into a later statement.

## The side queues and the refused update

**Health and gym do not go through the Store.** The health loggers queue in
`jarvis.health.pending.v1` (`health/offlineQueue.ts`) and a finished workout in
gym's own pending queue (`gym/liveSession.ts`, `queueFinished` and
`flushPending`); both flush to the Store later. `Store.pending()`
(`jarvis-core/src/core/store.ts`) reads only `online` and the Store's own
queue, so it does not see them; their toasts are rostered as SIDE_QUEUE in
`laws/savedLaw.test.ts` and folding them is Dave's call.

**A refused update still reads as Saved.** `Store.update` resolves `false`
when the adapter refuses a stale, missing or not owned patch, and callers
discard the value. No `item_change` row is written for it (nothing changed),
so the history is honest and the toast is not. Named for Phase 0.5: changing
service return shapes at every edit door.

## The unknown answer

A row that predates 0060 has no change row: `first` is `null`, `changes` is
`[]` and `answer` is `unknown`. Nothing is invented for it. Its links were
backfilled once by `jarvis_link_project_all()` as `created_by operator, via
backfill_0060`, which says exactly what is known (the pointer existed on that
date; who set it is not recorded); a pointer at a missing id lands with
`to_item` null. A second run of the backfill writes nothing.

## The package's sentence, with AI off

"Need to follow up with Mike about summer roster" has no anchored opener
(`TASK_OPENERS` in `paste/deterministic.ts` lists `follow up` only at the
start of a line), so the deterministic read is an unconfident task with
`personId` set to the one Mike. Phase 0 puts two things behind `memory_v1`:
the stamp `source = {type: "paste", ts, inferred: ["personId"]}`, and a
refused AI (off, gated or unreachable) leaving that deterministic result
standing instead of turning the line into a note with no person. The trigger
then projects one `about` link with `created_by rule`, and `item_why` answers
`rule` (proven on the stored shape). The task is kept, not confident: the
unanchored opener that would make it confident is Phase 0.5, after a golden
set run (AUTOFILL-SPEC.md). Flag off, the line becomes today's note.
