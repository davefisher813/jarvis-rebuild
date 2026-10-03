# Money module (build spec 2026-10-02)

The spec is authoritative for Money. This note records how it landed in the
repo, where each hard rule is enforced, and what is still open.

## The five hard rules, and where they live

| Rule | Enforced in |
|---|---|
| 1. Bills live in Money and never become tasks | `money/ledger/guard.ts`, called from `TasksService.createTask` itself (a bill-shaped candidate returns null and is logged). Structural law: `laws/billsNeverTasks.test.ts`. |
| 2. Paid is never claimed without evidence | `ledger/bill.ts` `markPaid` (no evidence, no paid); `assertWritable` is the second wall; `ledger/status.ts` reads a paid date with no evidence as not paid. |
| 3. No invented dates | `ledger/validate.ts` `optionalDate`: blank stays blank. Status is computed from explicit dates only; no due date is never due and never overdue. |
| 4. No double-counting | `ledger/fingerprint.ts` (exact duplicates suppressed), `ledger/reconcile.ts` (a link, not a merge), `ledger/actuals.ts` (a linked pair counts once, at the transaction's amount). |
| 5. Deterministic first | Nothing in `money/ledger/` calls a model. AI may only propose a receipt read, which the person confirms. |

## Mapping from the spec to the repo (assumption A1)

- The spec's single `money` entity with `data.kind` is one entity type per kind,
  the repo's convention (migration 0041 says why). New: `money_bill`,
  `money_receipt` (migration 0042). Reused and extended with optional fields:
  `money_tx`, `money_budget`.
- `amount` is `amountCents` (integer) so a ledger adds up to the cent.
- Transactions keep the repo's sign: positive = money out. The spec says
  negative = out; flipping it would invert every stored row.
- Budgets stay monthly, `allocations` by category name in cents. The spec's
  `name` and `notes` are optional fields; the period is the month.
- The `item` table is last-write-wins and keeps no history. "Versioned, shows
  in the record's history" is a `history` list inside each record, written in
  the same patch as the change. History never stores null (the server strips
  nulls at every depth); a missing `from` or `to` means "none".
- Receipt photos use the existing `user_file` rows and the `user-files` bucket
  (assumption A2 holds); a receipt record carries `attachmentFileId`.
- The V3 spec (sections 3.6 and 3.7, the email candidate field contract) is not
  in the repo. Email-born records use `source: { type: "email", fingerprint,
  ref }` with the thread as the stable reference.

## Legacy bills

Bills stored before the ledger are tasks with `data.bill`. They keep working
unchanged and show beside ledger bills. New bills are never tasks. Moving the
old ones into `money_bill` is a separate, explicit step that needs Dave's yes.

## Tolerances (assumption A4)

Amount within $1.00 or 1% of the larger amount, date within 3 days, vendor
equal after normalising (lowercase, punctuation stripped). Constants are in
`ledger/reconcile.ts`. Tune only with Dave's approval after real misses.

## Deploy order

`jarvis-core/supabase/migrations/0042_money_ledger.sql` registers the two new
entity types. It must be applied to production BEFORE the app build that writes
them ships, or every Add Bill / Save Receipt is a dead button.

## Open questions for Dave

1. Budget periods: monthly only for v1, or weekly/custom now? (Built monthly.)
2. Overdue bills: push notification, or Today only? (Built Today only.)
3. Receipt photo retention: keep originals forever, or compress/archive later?
   (Built: kept as is.)
4. Mark paid: one tap with Undo, or an explicit confirm every time? (Built as a
   confirm, behind one constant so the answer flips it.)
