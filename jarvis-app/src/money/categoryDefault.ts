import { normalizeVendor } from "./ledger/fingerprint";
import { DEFAULT_BUDGET_CATEGORIES, UNCATEGORIZED, type ReceiptData } from "./ledger/types";

// THE CATEGORY A VENDOR USUALLY GETS (Money ledger, 2026-10-03).
//
// Adding a receipt or a transaction should not ask the same question twice.
// The picker opens on the category this vendor was last filed under, read from
// what the person already entered, with no model in the way: a plain lookup
// over existing transactions and receipts. Nothing is auto-categorised; the
// default is a starting value the person can change in one tap.
//
// Two category values are not a choice and never become a default: blank (a
// receipt with none) and "Other", the transaction sheet's own starting value,
// which says nothing about the vendor. Income is a direction, not a category
// of spending.

/** The slice of a transaction this reads. money_tx data satisfies it. */
export interface CategorisedTx { date: string; merchant: string; category?: string }
/** The slice of a receipt this reads. */
export type CategorisedReceipt = Pick<ReceiptData, "vendor" | "transactionDate" | "category">;

const NOT_A_CHOICE = new Set(["", "other", "income", UNCATEGORIZED.toLowerCase()]);
const real = (c: string | undefined): string | undefined => {
  const t = (c ?? "").trim();
  return NOT_A_CHOICE.has(t.toLowerCase()) ? undefined : t;
};

/** The vendor's most recent real category (newest date wins; a tie goes to the
 *  later record in the list), or undefined when there is none. */
export function lastCategoryFor(
  vendor: string,
  txs: { data: CategorisedTx }[],
  receipts: { data: CategorisedReceipt }[],
): string | undefined {
  const key = normalizeVendor(vendor);
  if (!key) return undefined;
  let best: { date: string; category: string } | undefined;
  const consider = (name: string, date: string, category: string | undefined) => {
    const c = real(category);
    if (!c || normalizeVendor(name) !== key) return;
    if (!best || date >= best.date) best = { date, category: c };
  };
  for (const t of txs) consider(t.data.merchant, t.data.date, t.data.category);
  for (const r of receipts) consider(r.data.vendor, r.data.transactionDate, r.data.category);
  return (best as { category: string } | undefined)?.category;
}

/** The names a category picker offers: what has been used (transactions,
 *  receipts, any budget), then the nine proposed names not already there. The
 *  picker is a convenience over free text, never a taxonomy to set up first. */
export function categoryChoices(input: {
  txs?: { data: { category?: string } }[];
  receipts?: { data: { category?: string } }[];
  budgetNames?: string[];
}): string[] {
  const seen = new Map<string, string>();
  const add = (c: string | undefined) => {
    const t = (c ?? "").trim();
    if (!t || t.toLowerCase() === "income" || t.toLowerCase() === UNCATEGORIZED.toLowerCase()) return;
    if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  };
  for (const n of input.budgetNames ?? []) add(n);
  for (const t of input.txs ?? []) add(t.data.category);
  for (const r of input.receipts ?? []) add(r.data.category);
  const used = [...seen.values()].sort((a, b) => a.localeCompare(b));
  for (const d of DEFAULT_BUDGET_CATEGORIES) add(d);
  const proposed = [...seen.values()].filter((c) => !used.includes(c));
  return [...used, ...proposed];
}
