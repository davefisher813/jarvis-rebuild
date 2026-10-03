import { dayGap, isRealDate } from "./dates";
import { normalizeVendor } from "./fingerprint";
import { appended, entry, isoNow, type Clock } from "./history";
import { markPaid } from "./bill";
import { isPaid } from "./status";
import { DEFAULT_CURRENCY, type BillData, type HistoryEntry, type ReceiptData } from "./types";

// RECONCILIATION (spec section 5), the part most likely to double-count.
//
// Matching is a PROPOSAL and a link is not a merge. This file only ever answers
// "these two look like the same money"; the person approves; a link is written
// on both sides and both records keep existing. Nothing here deletes, merges
// or decides.
//
// The tolerances are spec A4 and are the only numbers in this file: amount
// within $1.00 or 1% (the larger), date within 3 days, vendor equal after
// normalising. Tune them only with Dave's approval after real misses.

export const AMOUNT_TOLERANCE_CENTS = 100;
export const AMOUNT_TOLERANCE_PCT = 0.01;
export const DATE_WINDOW_DAYS = 3;

/** The slice of a transaction this file reads. money_tx data satisfies it. */
export interface TxLike {
  id: string;
  data: {
    date: string;
    merchant: string;
    amountCents: number;
    category?: string;
    currency?: string;
    month?: string;
    matchedReceiptId?: string;
    paysBillId?: string;
    history?: HistoryEntry[];
  };
}

export function amountTolerance(aCents: number, bCents: number): number {
  return Math.max(AMOUNT_TOLERANCE_CENTS, Math.round(AMOUNT_TOLERANCE_PCT * Math.max(Math.abs(aCents), Math.abs(bCents))));
}
export const amountsMatch = (a: number, b: number): boolean => Math.abs(a - b) <= amountTolerance(a, b);
const sameCurrency = (a: string | undefined, b: string | undefined): boolean => (a ?? DEFAULT_CURRENCY) === (b ?? DEFAULT_CURRENCY);
const sameVendor = (a: string, b: string): boolean => {
  const x = normalizeVendor(a);
  return x.length > 0 && x === normalizeVendor(b);
};

export interface MatchProposal {
  /** The receipt or bill id. */
  recordId: string;
  transactionId: string;
  /** Absolute days apart. */
  dateGap: number;
  /** Absolute cents apart. */
  amountDiffCents: number;
}

const rank = (a: MatchProposal, b: MatchProposal): number =>
  a.amountDiffCents - b.amountDiffCents || a.dateGap - b.dateGap || a.transactionId.localeCompare(b.transactionId);

/** Receipts with no link, against transactions with no link. A transaction is
 *  money out (positive in the repo's sign). Every candidate pair is listed,
 *  best first; approving one makes the others stale (linkReceipt rechecks). */
export function proposeReceiptMatches(receipts: { id: string; data: ReceiptData }[], txs: TxLike[]): MatchProposal[] {
  const out: MatchProposal[] = [];
  for (const r of receipts) {
    if (r.data.linkedTransactionId) continue;
    for (const t of txs) {
      if (t.data.matchedReceiptId || t.data.amountCents <= 0) continue;
      if (!sameCurrency(r.data.currency, t.data.currency)) continue;
      if (!sameVendor(r.data.vendor, t.data.merchant)) continue;
      if (!isRealDate(t.data.date) || !isRealDate(r.data.transactionDate)) continue;
      const gap = Math.abs(dayGap(r.data.transactionDate, t.data.date));
      if (gap > DATE_WINDOW_DAYS) continue;
      if (!amountsMatch(r.data.amountCents, t.data.amountCents)) continue;
      out.push({ recordId: r.id, transactionId: t.id, dateGap: gap, amountDiffCents: Math.abs(r.data.amountCents - t.data.amountCents) });
    }
  }
  return out.sort(rank);
}

/** Unpaid bills with an EXPLICIT due date, against payments that match it. A
 *  bill with no due date is never proposed: there is no date to match, and
 *  none is invented. (The person can still link one by hand.) */
export function proposeBillMatches(bills: { id: string; data: BillData }[], txs: TxLike[]): MatchProposal[] {
  const out: MatchProposal[] = [];
  for (const b of bills) {
    if (isPaid(b.data) || !b.data.dueDate || !isRealDate(b.data.dueDate)) continue;
    for (const t of txs) {
      if (t.data.paysBillId || t.data.amountCents <= 0) continue;
      if (!sameCurrency(b.data.currency, t.data.currency)) continue;
      if (!sameVendor(b.data.vendor, t.data.merchant)) continue;
      if (!isRealDate(t.data.date)) continue;
      const gap = Math.abs(dayGap(b.data.dueDate, t.data.date));
      if (gap > DATE_WINDOW_DAYS) continue;
      if (!amountsMatch(b.data.amountCents, t.data.amountCents)) continue;
      out.push({ recordId: b.id, transactionId: t.id, dateGap: gap, amountDiffCents: Math.abs(b.data.amountCents - t.data.amountCents) });
    }
  }
  return out.sort(rank);
}

export type LinkResult<T> = { ok: true } & T | { ok: false; reason: "already_linked" | "not_a_payment" | "evidence_required" | "paid_date_required" | "bad_evidence" };

/** Approve a receipt to transaction match: a link on both sides, nothing merged. */
export function linkReceipt(
  receiptId: string,
  receipt: ReceiptData,
  tx: TxLike,
  now: Clock = isoNow,
): LinkResult<{ receipt: ReceiptData; txPatch: { matchedReceiptId: string; history: HistoryEntry[] } }> {
  if (receipt.linkedTransactionId || tx.data.matchedReceiptId) return { ok: false, reason: "already_linked" };
  if (tx.data.amountCents <= 0) return { ok: false, reason: "not_a_payment" };
  return {
    ok: true,
    receipt: {
      ...receipt,
      linkedTransactionId: tx.id,
      history: appended(receipt.history, entry("user", "matched to a transaction", { linkedTransactionId: { to: tx.id } }, now)),
    },
    txPatch: {
      matchedReceiptId: receiptId,
      history: appended(tx.data.history, entry("user", "matched to a receipt", { matchedReceiptId: { to: receiptId } }, now)),
    },
  };
}

export function unlinkReceipt(
  receipt: ReceiptData,
  tx: TxLike | undefined,
  now: Clock = isoNow,
): { receipt: ReceiptData; txPatch: { matchedReceiptId: null; history: HistoryEntry[] } | null } {
  const next: ReceiptData = { ...receipt };
  delete next.linkedTransactionId;
  next.history = appended(receipt.history, entry("user", "unmatched", { linkedTransactionId: { from: receipt.linkedTransactionId } }, now));
  return {
    receipt: next,
    txPatch: tx ? { matchedReceiptId: null, history: appended(tx.data.history, entry("user", "unmatched", { matchedReceiptId: { from: tx.data.matchedReceiptId } }, now)) } : null,
  };
}

/** Approve a bill to payment match. The bill becomes paid WITH the transaction
 *  as its evidence and the transaction's own date as the paid date; the two
 *  stay separate records. */
export function linkBill(
  billId: string,
  bill: BillData,
  tx: TxLike,
  now: Clock = isoNow,
): LinkResult<{ bill: BillData; txPatch: { paysBillId: string; history: HistoryEntry[] } }> {
  if (tx.data.paysBillId) return { ok: false, reason: "already_linked" };
  if (tx.data.amountCents <= 0) return { ok: false, reason: "not_a_payment" };
  const paid = markPaid(bill, { type: "transaction", transactionId: tx.id }, tx.data.date, "user", now);
  if (!paid.ok) return { ok: false, reason: paid.reason };
  return {
    ok: true,
    bill: paid.next,
    txPatch: {
      paysBillId: billId,
      history: appended(tx.data.history, entry("user", "matched to a bill", { paysBillId: { to: billId } }, now)),
    },
  };
}
