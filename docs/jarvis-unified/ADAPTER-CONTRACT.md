# The destination adapter contract

Shared between the unified substrate and the Money, Tasks and Schedule modules.
Written 2026-10-03 (slice 01). The code is `jarvis-app/src/substrate/destinations/`;
the proof is `destinations.contract.test.ts`. If a module's writer changes
shape, that test is what goes red, and this page is what says who moves.

## The three calls

```ts
prepare(input, evidence, ctx)  -> Prepared | NotPrepared     // pure, no store
commit(store, ownerId, prepared, ctx, id?) -> Committed      // through the module's own writer
canUndo(store, ownerId, itemId, recordedRevision) -> UndoCheck
```

- `prepare` validates and normalises, and returns `data`: EXACTLY the
  `item.data` the module's own writer would store, plus `destinationKind`
  (the entity_type), `displaySummary` (the card line), `exactEffect` (the
  receipt's verb), `payloadHash` (SHA-256 over the normalised payload, what
  the approval binds to) and `moduleVersion`.
- `commit` writes through the module's writer today. The command function of
  slice 03 writes `prepared.data` under `prepared.destinationKind` inside one
  database transaction instead; the contract test holds the two equal, so a
  record saved either way reads the same in its module, history line and all.
- `canUndo` says whether a compensating delete is still honest: the item is
  unchanged since it was written (`serverTime` equals the recorded revision)
  and nothing refers to it. It never deletes.

`NotPrepared` is one of two things. `MISSING_DETAILS` names fields the person
can fix (the card shows Needs details). `UNSUPPORTED` means the module cannot
hold it yet; the candidate stays in Email and the line says so.

## Where each kind lands

| Capture kind | entity_type | Writer the adapter mirrors | moduleVersion |
|---|---|---|---|
| bill | `money_bill` | `LedgerService.addBill` via `buildBill` | `money-ledger-2026-10-02` |
| receipt | `money_receipt` | `LedgerService.addReceipt` | `money-ledger-2026-10-02` |
| task | `task` | `TasksService.createTask` | `tasks-service-2026-10-03` |
| event | `event` | `ScheduleService.createEvent` | `schedule-service-2026-10-03` |
| waiting | `waiting` | `WaitingService.create` | `waiting-service-2026-10-03` |

A bill is never a task. The registry (`DESTINATION_OF`) has no path from a
bill to Tasks, the task service's own guard refuses a bill-shaped candidate,
and the database trigger `email_candidate_destination` refuses a bill
candidate pointed at a task item. Three walls, all tested.

## Money, field by field

| Payload (spec) | Ledger (`BillData` / `ReceiptData`) | Rule |
|---|---|---|
| `issuer` / `merchant` | `vendor` | trimmed, otherwise as written |
| `amount.minor_units` | `amountCents` | integer; must be above zero (the ledger's `parseCents`); never passes through a float |
| `amount.currency` | `currency` | ISO 4217 and a two-decimal minor unit; anything else is a missing detail (JPY, KWD stay in Email) |
| `due_date` or `no_due_date_confirmed` | `dueDate` (absent when none) | a blank date stays blank; the person must confirm No due date |
| `purchase_date` | `transactionDate` | required for a receipt |
| `invoice_number` | `notes` ("Invoice 4021") | the ledger has no invoice field |
| `receipt_number` | not stored | kept on the candidate and its evidence |
| `transaction_type = refund` | not supported | `UNSUPPORTED`; Money has no refund kind |
| evidence from a mail thread | `source = { type: "email", fingerprint: "gmail:<thread>", ref: <thread> }`, history `by: "email"` | the same key `emailBill.ts` uses, so one thread stays one bill and a later change is an update offer |
| manual capture | `source = "manual"`, history `by: "user"` | |

Receipts: `displaySummary` is "Delta · $284.10 · Oct 2"; `exactEffect` is
"Saved $284.10 Receipt to Money". Bills: "Con Edison · $142.30 · Due Oct 15"
and "Saved $142.30 Bill to Money". A second commit of the same bill or receipt
is the ledger's own duplicate answer: no second record, `duplicateOf` set,
"Already in Money · Con Edison $142.30".

What the substrate never does to Money: no mark paid, no transaction, no
recurrence, no budget, no edit of an existing record. A changed source after
a save becomes an Email-local update candidate (slice 06), never a write.

## Tasks, Schedule, Waiting

- Task: `{ text, category: "", done: false, due?, notes?, fromThread, source: { type: "email", ref: thread } }`. The email provenance is what Today's Email band and the From Email list key on.
- Event: `{ title, date, start, end?, category: "", location?, clientId, source }`. A timed instant is written in the reader's zone; an all-day event is one day at `00:00` with no end (the Google importer's shape). Multi-day and across-midnight spans are `UNSUPPORTED`. `clientId` is the durable idempotency key (migration 0039): the same appointment committed twice, on any device, is one row.
- Waiting: `WaitingData` with `status: "open"`, `startedAt`, an optional `followUpOn` (tracker metadata, never a task), `sourceEvidenceId`, `threadId`, `account`.

## Readiness

`readinessFrom(registered)` answers per kind from the `entity_type` registry
as returned by the `substrate_readiness()` function (migration 0044). A kind
is ready only when the migration answered, the kind is registered and the
adapter's `destinationKind` matches the registry's route. Anything less is
`unavailable` with the module's line, "Money Isn't Ready · Your Bill Is Still
Here". A missing function (PostgREST `PGRST202`) reads as the migration not
applied. Nothing is ever ready on a guess.

## What the server checks again (slice 03)

`capture_approve` takes the adapter's output as `p_prepared`:

```
{ destination_kind, data, exact_effect, display_summary, module_version, evidence_excerpt? }
```

`src/substrate/commands/captures.ts` builds it with `preparedForServer(prepared)`; `data` is byte for byte the adapter's `data`. The database then takes its own second look before the item is written (`jarvis_capture_valid`), the same invariants the module writers hold, named as the first field that fails:

| Kind | Destination | Must hold |
|---|---|---|
| bill | `money_bill` only | `vendor` non-empty; `amountCents` a positive integer; `currency` three capitals; `dueDate` ISO if present; `fingerprint` and a `history` array; never `paidAt` or `paidEvidence` on a capture |
| receipt | `money_receipt` only | `vendor`, positive integer `amountCents`, `currency`, ISO `transactionDate`, `fingerprint`, `history` |
| task | `task` only | `text` non-empty; `due` ISO if present; never `bill`, `amount`, `amountCents` or `vendor` (a bill is never a task) |
| event | `event` only | `title`; `date` ISO and `start` HH:MM; `end` HH:MM if present |
| waiting | `waiting` only | `title`, `waitingFor`, `counterpartyDisplay`; `status` open |

A kind that does not match the candidate's kind is INVALID_PAYLOAD; a destination whose entity type is not registered is MODULE_UNAVAILABLE and the candidate stays. Money's duplicate rule is applied by the server as well: the same `fingerprint` is the same record, the receipt says "Already in Money · ..." and nothing new is written; Undo then refuses, because the capture created nothing.

## Changing it

- A module that changes its stored shape updates its writer, watches the
  contract test go red, and either updates the adapter in the same change or
  bumps `moduleVersion` and tells the substrate. Never both halves silently.
- A new field on a payload is additive: the adapter maps it or names it as
  not stored, here.
- `CAPTURE_PAYLOAD_VERSION` moves only with a reader migration first.

## Open questions for Money (from this slice)

1. Refunds: a receipt with a sign, or a refund kind? Until then refunds wait in Email.
2. Non-two-decimal currencies: does the ledger want `amountMinor` plus a scale, or stay cents-only?
3. A receipt number field, or notes?
4. Should a bill saved from a card carry the candidate's evidence id on its history line, so Money can show "From an email" with a link back?
