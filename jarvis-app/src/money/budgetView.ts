import { budgetActuals, type Actuals, type ActualsRow } from "./ledger/actuals";
import type { TxLike } from "./ledger/reconcile";
import { DEFAULT_BUDGET_CATEGORIES, UNCATEGORIZED, type ReceiptData } from "./ledger/types";
import { dollarsToCents, fmtCents } from "./tracker";

// THE MONTHLY BUDGET, AS THE SCREEN DRAWS IT (Money ledger, 2026-10-03).
//
// Monthly only (Dave's open question 1: no weekly, no custom period). The form
// holds a plain list of named rows, each with a limit the person types; the
// numbers beside them (spent, remaining, over) are never typed and never
// stored: they come from budgetActuals over the month's transactions and
// receipts, with a receipt linked to a payment counted once.
//
// There is no projection anywhere in this file: no pace, no forecast, no
// "on track". Spent so far is a fact; what the rest of the month holds is not.

export interface BudgetRow {
  /** Stable while editing, so renaming a row does not remount its field. */
  key: string;
  name: string;
  /** What the person typed. Blank is a category with no limit yet. */
  limit: string;
}

let seq = 0;
const nextKey = (): string => `b${++seq}`;

/** A blank row for "Add a Category". */
export const newRow = (name = "", limit = ""): BudgetRow => ({ key: nextKey(), name, limit });

/** The first budget of a month: the nine proposed names, limits left blank for
 *  the person to fill in. Nothing is stored until they save. */
export const seedRows = (): BudgetRow[] => DEFAULT_BUDGET_CATEGORIES.map((n) => newRow(n));

/** An existing budget's allocations as rows, in the order they were saved. */
export const rowsFromAllocations = (a: Record<string, number>): BudgetRow[] =>
  Object.entries(a).map(([name, cents]) => newRow(name, (cents / 100).toFixed(2)));

const isUncategorized = (n: string): boolean => n.trim().toLowerCase() === UNCATEGORIZED.toLowerCase();

/** What is stored: a name and a limit above zero. A blank row, a blank name and
 *  Uncategorized (which has no limit to set) are left out. */
export function allocationsFromRows(rows: BudgetRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const name = r.name.trim();
    const cents = dollarsToCents(r.limit);
    if (name && !isUncategorized(name) && cents > 0) out[name] = cents;
  }
  return out;
}

export interface DisplayRow extends ActualsRow {
  /** The form row behind it; absent for a category that only has spend. */
  key?: string;
}

/** Every row the month shows, in order: the person's rows as listed, then any
 *  category that has spend and no row, and Uncategorized last, always. */
export function displayRows(rows: BudgetRow[], actuals: Actuals): DisplayRow[] {
  const byName = new Map(actuals.rows.map((r) => [r.name, r]));
  const out: DisplayRow[] = [];
  const shown = new Set<string>();
  for (const r of rows) {
    const name = r.name.trim();
    if (isUncategorized(name)) continue;
    const a = byName.get(name);
    out.push({ key: r.key, name: name || r.name, limit: a?.limit ?? null, spent: a?.spent ?? 0, remaining: a?.remaining ?? null, overBy: a?.overBy ?? 0 });
    if (name) shown.add(name);
  }
  for (const a of actuals.rows) {
    if (a.name === UNCATEGORIZED || shown.has(a.name)) continue;
    out.push({ ...a });
  }
  const un = byName.get(UNCATEGORIZED);
  out.push({ name: UNCATEGORIZED, limit: null, spent: un?.spent ?? 0, remaining: null, overBy: 0 });
  return out;
}

/** The month's actuals for the rows as they stand in the form. */
export function monthActuals(month: string, rows: BudgetRow[], txs: TxLike[], receipts: { id: string; data: ReceiptData }[]): Actuals {
  return budgetActuals({ month, allocations: allocationsFromRows(rows), txs, receipts });
}

export interface DiscrepancyLine {
  key: string;
  /** "Stop & Shop". */
  vendor: string;
  /** "Receipt says $47.12, payment says $60.00". */
  says: string;
  /** Which one the budget used; always the payment, never a silent pick. */
  counted: string;
}

/** A linked pair whose amounts differ beyond tolerance, stated plainly. */
export function discrepancyLines(actuals: Actuals, receipts: { id: string; data: ReceiptData }[]): DiscrepancyLine[] {
  return actuals.discrepancies.map((d) => ({
    key: `${d.receiptId}|${d.transactionId}`,
    vendor: receipts.find((r) => r.id === d.receiptId)?.data.vendor ?? "",
    says: `Receipt says ${fmtCents(d.receiptCents)}, payment says ${fmtCents(d.transactionCents)}`,
    counted: "Counting the payment",
  }));
}
