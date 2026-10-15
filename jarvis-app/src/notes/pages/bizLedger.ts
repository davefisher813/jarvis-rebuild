// THE BUSINESS LEDGER IS A VIEW OVER MONEY (issue #115: "a view over Money data"; no second ledger store). It stores a filter (a
// category and a year) and nothing else. Every row below is read from the Money tracker's spending and its receipts each time the
// page opens, so a correction made in Money is the correction here, and the page can never disagree with it.

import type { TrackerTx } from "../../money/tracker";
import type { Receipt } from "../../money/ledger/types";
import type { PageData, PageRecord } from "./pageModel";

export interface LedgerRow { id: string; date: string; vendor: string; category: string; cents: number; from: "Spending" | "Receipt" }

const norm = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

/** The spending and receipts in a category (and a year, when one is set), newest first. A receipt a payment is already matched to is
 *  that payment, so it is drawn once. Money in (a refund, income) is not spending and is left out. */
export function businessRows(txs: TrackerTx[], receipts: Receipt[], category: string, year: number | null): LedgerRow[] {
  const cat = norm(category);
  const inYear = (iso: string) => year === null || iso.startsWith(String(year));
  const rows: LedgerRow[] = [];
  const paid = new Set<string>();
  for (const t of txs) {
    if (t.data.amountCents <= 0 || norm(t.data.category) !== cat || !inYear(t.data.date)) continue;
    if (t.data.matchedReceiptId) paid.add(t.data.matchedReceiptId);
    rows.push({ id: t.id, date: t.data.date, vendor: (t.data.merchant || t.data.name || "").trim(), category: t.data.category, cents: t.data.amountCents, from: "Spending" });
  }
  for (const r of receipts) {
    if (norm(r.data.category) !== cat || !inYear(r.data.transactionDate) || paid.has(r.id) || (r.data.linkedTransactionId && txs.some((t) => t.id === r.data.linkedTransactionId && norm(t.data.category) === cat))) continue;
    rows.push({ id: r.id, date: r.data.transactionDate, vendor: r.data.vendor.trim(), category: r.data.category ?? "", cents: r.data.amountCents, from: "Receipt" });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.vendor.localeCompare(b.vendor)));
}

export const ledgerTotal = (rows: LedgerRow[]): number => rows.reduce((s, r) => s + r.cents, 0) / 100;

/** The page's own filter: its category (default Business) and its year ("" is every year). */
export function ledgerFilter(page: PageData): { category: string; year: number | null } {
  const y = Number((page.meta?.year ?? "").trim());
  return { category: (page.meta?.category ?? "").trim() || "Business", year: Number.isInteger(y) && y > 1999 && y < 2200 ? y : null };
}

/** The rows as a page's records, for export: the same table every other page exports, from what Money holds now. */
export function ledgerAsPage(page: PageData, rows: LedgerRow[]): PageData {
  const records: PageRecord[] = rows.map((r) => ({ id: r.id, v: { date: r.date, vendor: r.vendor, category: r.category, amount: String(r.cents / 100), from: r.from } }));
  return { ...page, records };
}
