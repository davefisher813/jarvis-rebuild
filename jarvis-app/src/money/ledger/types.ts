// THE MONEY LEDGER (build spec 2026-10-02, authoritative for Money).
//
// Bills, receipts, transactions and budgets, with five hard rules the code
// carries rather than the copy:
//   1. A bill lives in Money and is never a task (guard.ts).
//   2. "Paid" is never claimed without evidence (bill.ts, status.ts).
//   3. No invented dates: a missing due date stays missing (validate.ts).
//   4. No double-counting: fingerprints and one-count pairs (fingerprint.ts,
//      reconcile.ts).
//   5. Deterministic first: nothing in this folder calls a model.
//
// MAPPING FROM THE SPEC TO THE REPO (the spec asked for this to be written
// down; the PR carries the same table).
//   - The spec's single `money` entity with `data.kind` is one entity type per
//     kind here, the repo's own convention (migration 0041 says why): bills are
//     `money_bill`, receipts `money_receipt`; transactions and budgets reuse
//     `money_tx` and `money_budget`, extended with optional fields so every
//     record already stored reads unchanged.
//   - `amount` (decimal) is `amountCents` (integer). A ledger has to add up to
//     the cent (tracker.ts says the same); the seam is cents.ts.
//   - Transactions keep the repo's sign, positive = money OUT. The spec says
//     negative = out; flipping it would invert every stored September row.
//   - The `item` table is last-write-wins and keeps no history, so "versioned,
//     shows in the record's history" is a `history` list inside each record,
//     written in the same patch as the change it describes (history.ts).
//   - `due_date`, `paid_at` and the rest are camelCase to match the code.

export const ENTITY_MONEY_BILL = "money_bill";
export const ENTITY_MONEY_RECEIPT = "money_receipt";

/** One line of a record's history: when, who, what, and the before and after. */
export interface HistoryEntry {
  /** ISO timestamp. */
  at: string;
  by: "user" | "email" | "system";
  action: string;
  /** A missing `from` or `to` means "none". Never null: the server strips
   *  nulls at every depth (jsonb_strip_nulls), so null cannot be stored. */
  changes?: Record<string, { from?: unknown; to?: unknown }>;
}

/** Where an email-born record came from. `fingerprint` is the stable key. */
export interface EmailSource { type: "email"; fingerprint: string; ref?: string }

export type BillSource = "manual" | EmailSource;
export type ReceiptSource = "manual" | "camera" | EmailSource;
export type TxSource = "manual" | "import" | EmailSource;

/** The only three things that can make a bill paid. */
export type PaidEvidence =
  | { type: "user_confirmed" }
  | { type: "transaction"; transactionId: string }
  | { type: "confirmation"; fingerprint: string; ref?: string };

/** Set only after the user confirms a recurring-bill suggestion. */
export type BillRecurrence = "weekly" | "monthly" | "yearly";

export interface BillData {
  vendor: string;
  amountCents: number;
  currency: string;
  /** Explicit only. Absent when the source did not state one. */
  dueDate?: string;
  paidAt?: string;
  paidEvidence?: PaidEvidence;
  /** A correction to a paid bill asks for the paid state again. */
  paidNeedsReconfirm?: true;
  recurrence?: BillRecurrence;
  autopay?: boolean;
  payUrl?: string;
  notes?: string;
  source: BillSource;
  fingerprint: string;
  history: HistoryEntry[];
}

export interface ReceiptData {
  vendor: string;
  amountCents: number;
  currency: string;
  /** Explicit; defaults to today for manual entry, editable. */
  transactionDate: string;
  /** Free text, the same names a budget uses. Absent counts as Uncategorized. */
  category?: string;
  /** A `user_file` row id for the photo or file. */
  attachmentFileId?: string;
  linkedTransactionId?: string;
  source: ReceiptSource;
  fingerprint: string;
  history: HistoryEntry[];
}

export interface Bill { id: string; data: BillData }
export interface Receipt { id: string; data: ReceiptData }

export type BillStatus = "unpaid" | "due" | "overdue" | "paid";

/** A bill is "due" when its explicit due date is within this many days. */
export const DUE_SOON_DAYS = 7;
export const DEFAULT_CURRENCY = "USD";
/** Entries with no category land here, visible and counted. */
export const UNCATEGORIZED = "Uncategorized";

/** Proposed defaults for a first budget (spec A3), nine at most. */
export const DEFAULT_BUDGET_CATEGORIES = [
  "Groceries", "Dining", "Transport", "Housing", "Utilities", "Health", "Kids/Family", "Fun", "Other",
] as const;
