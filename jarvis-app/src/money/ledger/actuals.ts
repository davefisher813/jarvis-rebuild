import { monthOfDay } from "./dates";
import { amountTolerance, type TxLike } from "./reconcile";
import { UNCATEGORIZED, type ReceiptData } from "./types";

// BUDGET ACTUALS, COMPUTED NEVER STORED (spec section 6).
//
// Spent in a month is the sum of the month's transactions (money out) and the
// month's STANDALONE receipts, grouped by category, with one rule that is the
// whole point of the module: a receipt linked to a transaction is the same
// money, so the pair is counted once, at the transaction's amount. When the two
// amounts differ by more than the match tolerance the difference is surfaced as
// a discrepancy instead of one of them being silently picked.
//
// No projections and no "pace": a forecast is a guess (spec 6).

export interface ActualsRow {
  name: string;
  /** Cents, or null when the budget set no limit for a category that has spend. */
  limit: number | null;
  spent: number;
  /** limit - spent, floored at 0; null with no limit. */
  remaining: number | null;
  /** spent - limit when over; 0 otherwise. */
  overBy: number;
}

export interface Discrepancy {
  receiptId: string;
  transactionId: string;
  receiptCents: number;
  transactionCents: number;
}

export interface Actuals {
  rows: ActualsRow[];
  totalSpent: number;
  totalLimit: number;
  discrepancies: Discrepancy[];
}

const isIncome = (c: string | undefined): boolean => (c ?? "").trim().toLowerCase() === "income";
const catOf = (c: string | undefined): string => {
  const t = (c ?? "").trim();
  return t || UNCATEGORIZED;
};

export function budgetActuals(input: {
  /** YYYY-MM */
  month: string;
  /** Category to its limit in cents. */
  allocations: Record<string, number>;
  txs: TxLike[];
  receipts: { id: string; data: ReceiptData }[];
}): Actuals {
  const { month, allocations, txs, receipts } = input;
  const spent = new Map<string, number>();
  const add = (cat: string, cents: number) => spent.set(cat, (spent.get(cat) ?? 0) + cents);
  const txById = new Map(txs.map((t) => [t.id, t]));
  const discrepancies: Discrepancy[] = [];
  // A receipt linked to a transaction that still exists is the transaction's
  // money; if that transaction was deleted the link is dead and the receipt
  // stands on its own again.
  const pairedReceiptFor = new Map<string, { id: string; data: ReceiptData }>();
  for (const r of receipts) {
    const t = r.data.linkedTransactionId ? txById.get(r.data.linkedTransactionId) : undefined;
    if (t) pairedReceiptFor.set(t.id, r);
  }

  for (const t of txs) {
    const m = t.data.month ?? monthOfDay(t.data.date);
    if (m !== month) continue;
    if (t.data.amountCents <= 0 || isIncome(t.data.category)) continue; // money in is not spend
    const r = pairedReceiptFor.get(t.id);
    // The pair takes the transaction's category unless it has none.
    const cat = catOf(t.data.category) !== UNCATEGORIZED ? catOf(t.data.category) : catOf(r?.data.category);
    add(cat, t.data.amountCents);
    if (r && Math.abs(r.data.amountCents - t.data.amountCents) > amountTolerance(r.data.amountCents, t.data.amountCents)) {
      discrepancies.push({ receiptId: r.id, transactionId: t.id, receiptCents: r.data.amountCents, transactionCents: t.data.amountCents });
    }
  }
  for (const r of receipts) {
    if (monthOfDay(r.data.transactionDate) !== month) continue;
    if (r.data.linkedTransactionId && txById.has(r.data.linkedTransactionId)) continue; // counted with its transaction
    add(catOf(r.data.category), r.data.amountCents);
  }

  const names = new Set<string>([...Object.keys(allocations), ...spent.keys(), UNCATEGORIZED]);
  const rows: ActualsRow[] = [...names].map((name) => {
    const limit = name in allocations ? allocations[name]! : null;
    const s = spent.get(name) ?? 0;
    return {
      name,
      limit,
      spent: s,
      remaining: limit === null ? null : Math.max(0, limit - s),
      overBy: limit !== null && s > limit ? s - limit : 0,
    };
  });
  // Budget order first (as the person set it), then categories with spend and no
  // limit by size, Uncategorized last so it is always findable at the foot.
  const order = Object.keys(allocations);
  rows.sort((a, b) => {
    if (a.name === UNCATEGORIZED) return 1;
    if (b.name === UNCATEGORIZED) return -1;
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return b.spent - a.spent || a.name.localeCompare(b.name);
  });
  return {
    rows,
    totalSpent: rows.reduce((n, r) => n + r.spent, 0),
    totalLimit: Object.values(allocations).reduce((n, c) => n + c, 0),
    discrepancies,
  };
}

/** "$40.00 over", stated plainly. Null when not over. */
export function overLine(row: ActualsRow, fmt: (cents: number) => string): string | null {
  return row.overBy > 0 ? `${fmt(row.overBy)} over` : null;
}
