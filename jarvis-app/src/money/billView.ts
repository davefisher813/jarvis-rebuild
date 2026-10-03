import type { TaskItem } from "../tasks/TasksService";
import { lineCase } from "../shared/casing";
import { shortDateFromMs } from "../shared/dateFormat";
import { activeBills, dayPhrase, monthDay } from "./bills";
import { dayGap, isRealDate } from "./ledger/dates";
import { billStatus, isPaid } from "./ledger/status";
import { DEFAULT_CURRENCY, type Bill, type BillData, type HistoryEntry, type PaidEvidence } from "./ledger/types";
import { formatMoney } from "./types";

// WHAT A LEDGER BILL SAYS ON A SCREEN, PURE (Money ledger, lane B).
//
// The ledger decides everything a bill IS (status.ts, bill.ts); this file only
// finds the words for it. Nothing here guesses a date, claims a payment or
// reads a clock: `today` comes in, plain words go out. The screens (the row,
// the detail sheet, the Today line) all read these, so they cannot disagree.

/** The amount as a person writes it: "$84.12", "$120", or "EUR 84.12" for a
 *  bill in another currency (formatMoney is dollars and only dollars). */
export function billAmount(d: Pick<BillData, "amountCents" | "currency">): string {
  const dollars = d.amountCents / 100;
  if (d.currency === DEFAULT_CURRENCY) return formatMoney(dollars);
  return `${d.currency} ${dollars.toFixed(2)}`;
}

/** Cents as a bare amount for a history line, in the bill's currency. */
const cents = (v: unknown, currency: string): string =>
  typeof v === "number" ? billAmount({ amountCents: v, currency }) : String(v);

export interface LedgerChip { cls: "u-late" | "u-today"; text: string }

/** The urgency chip on the row, from the computed status. Overdue wears the
 *  Colour Key red (u-late), the same chip a late legacy bill wears; due soon
 *  wears the warn tone. Paid, a bill far out, and a bill with no date have no
 *  chip: the second line carries them. An autopay bill that is not yet late
 *  says nothing here either, as a legacy one never did. */
export function ledgerChip(d: BillData, today: string): LedgerChip | null {
  const status = billStatus(d, today);
  if (status === "overdue") {
    const late = -dayGap(today, d.dueDate!);
    return { cls: "u-late", text: lineCase(late === 1 ? "1 day late" : `${late} days late`) };
  }
  if (status === "due" && !d.autopay) {
    const gap = dayGap(today, d.dueDate!);
    return { cls: "u-today", text: lineCase(gap === 0 ? "Due today" : gap === 1 ? "Due tomorrow" : `Due in ${gap} days`) };
  }
  return null;
}

export type LedgerLineState = "paid" | "reconfirm" | "autopay" | "due" | "none";

/** The one line under a bill's name. `when` is the day an autopay bill goes
 *  out, kept apart so the row sets it as a date. Autopay never says paid:
 *  "Set to Autopay" until a payment, a confirmation or the person says so. */
export function ledgerLine(d: BillData, today: string): { text: string; state: LedgerLineState; when?: string } {
  if (isPaid(d)) return { text: lineCase(`Paid ${monthDay(d.paidAt!)}`), state: "paid" };
  if (d.paidAt && d.paidNeedsReconfirm) return { text: "Confirm It Is Still Paid", state: "reconfirm" };
  if (d.autopay) {
    return d.dueDate && isRealDate(d.dueDate)
      ? { text: "Set to Autopay", when: dayPhrase(d.dueDate, today), state: "autopay" }
      : { text: "Set to Autopay", state: "autopay" };
  }
  if (d.dueDate && isRealDate(d.dueDate)) return { text: `Due ${monthDay(d.dueDate)}`, state: "due" };
  return { text: "", state: "none" };
}

/** Where a bill stands, in the words the detail sheet's Status row uses. */
export function ledgerStatusWord(d: BillData, today: string): string {
  const status = billStatus(d, today);
  if (status === "paid") return "Paid";
  if (d.paidAt && d.paidNeedsReconfirm) return "Confirm It Is Still Paid";
  if (status === "overdue") {
    const late = -dayGap(today, d.dueDate!);
    return lineCase(late === 1 ? "1 day late" : `${late} days late`);
  }
  if (status === "due") {
    const gap = dayGap(today, d.dueDate!);
    return lineCase(gap === 0 ? "Due today" : gap === 1 ? "Due tomorrow" : `Due in ${gap} days`);
  }
  return d.autopay ? "Set to Autopay" : "Unpaid";
}

/** The evidence for a paid bill in plain words, or null when it is not paid.
 *  `txs` is the payments the evidence may point at (money_tx rows). */
export function evidenceLine(
  d: BillData,
  txs: { id: string; data: { date: string; merchant?: string; name?: string } }[] = [],
): string | null {
  if (!d.paidAt || !d.paidEvidence) return null;
  const e: PaidEvidence = d.paidEvidence;
  if (e.type === "user_confirmed") return lineCase(`You confirmed it ${monthDay(d.paidAt)}`);
  if (e.type === "transaction") {
    const tx = txs.find((t) => t.id === e.transactionId);
    if (!tx) return lineCase(`Paid by your ${monthDay(d.paidAt)} payment`);
    const who = (tx.data.merchant || tx.data.name || d.vendor).trim();
    return lineCase(`Paid by your ${monthDay(tx.data.date)} ${who} payment`);
  }
  return lineCase(`Paid by a confirmation from ${monthDay(d.paidAt)}`);
}

// ---- history ---------------------------------------------------------------

export interface HistoryChange { label: string; from: string; to: string }
export interface HistoryLine { who: string; when: string; what: string; changes: HistoryChange[] }

const FIELD_LABEL: Record<string, string> = {
  vendor: "Vendor",
  amountCents: "Amount",
  currency: "Currency",
  dueDate: "Due Date",
  notes: "Notes",
  autopay: "Autopay",
  payUrl: "Pay Link",
  recurrence: "Repeats",
  paidAt: "Paid Date",
  paidEvidence: "Evidence",
};

const WHO: Record<HistoryEntry["by"], string> = { user: "You", email: "An Email", system: "JARVIS" };

function evidenceWord(e: unknown): string {
  const t = (e as { type?: string } | null)?.type;
  if (t === "user_confirmed") return "You confirmed it";
  if (t === "transaction") return "A matched payment";
  if (t === "confirmation") return "A confirmation";
  return "None";
}

/** One side of a change. A missing side is "none" (the server strips nulls,
 *  so an absent from or to is how "nothing before" and "nothing after" is
 *  stored). */
function side(key: string, v: unknown, currency: string): string {
  if (v === undefined || v === null || v === "") return "None";
  if (key === "amountCents") return cents(v, currency);
  if (key === "dueDate" || key === "paidAt") return typeof v === "string" && isRealDate(v) ? monthDay(v) : String(v);
  if (key === "autopay") return v ? "On" : "Off";
  if (key === "paidEvidence") return evidenceWord(v);
  if (key === "recurrence") return lineCase(String(v));
  return String(v);
}

/** The record's history, oldest first, as lines a person can read: who, when,
 *  what, and for each changed field the before and after. */
export function historyLines(history: HistoryEntry[] | undefined, currency: string): HistoryLine[] {
  return (history ?? []).map((h) => {
    const ms = Date.parse(h.at);
    return {
      who: WHO[h.by] ?? "JARVIS",
      when: Number.isFinite(ms) ? shortDateFromMs(ms) : "",
      what: lineCase(h.action),
      changes: Object.entries(h.changes ?? {}).map(([k, c]) => ({
        label: FIELD_LABEL[k] ?? lineCase(k),
        from: side(k, c.from, currency),
        to: side(k, c.to, currency),
      })),
    };
  });
}

// ---- the list --------------------------------------------------------------

export type BillEntry =
  | { kind: "ledger"; id: string; bill: Bill; due?: string }
  | { kind: "legacy"; id: string; task: TaskItem; due?: string };

const nameOf = (e: BillEntry): string => (e.kind === "ledger" ? e.bill.data.vendor : e.task.data.text).toLowerCase();

/** Ledger bills worth showing: everything not paid, plus recently paid ones
 *  as receipts (the same 30 days a legacy bill keeps). A paid bill older than
 *  that has finished its story and drops off the list, not out of the ledger. */
export function visibleLedgerBills(bills: Bill[], today: string): Bill[] {
  return bills.filter((b) => {
    if (!isPaid(b.data)) return true;
    return !!b.data.paidAt && isRealDate(b.data.paidAt) && dayGap(b.data.paidAt, today) <= 30;
  });
}

/** Ledger and legacy bills in one list, by due date, a bill with no due date
 *  last. Legacy rows come through activeBills untouched. */
export function mergedBills(ledger: Bill[], legacyTasks: TaskItem[], today: string): BillEntry[] {
  const out: BillEntry[] = [
    ...visibleLedgerBills(ledger, today).map((b): BillEntry => ({ kind: "ledger", id: b.id, bill: b, ...(b.data.dueDate ? { due: b.data.dueDate } : {}) })),
    ...activeBills(legacyTasks, today).map((t): BillEntry => ({ kind: "legacy", id: t.id, task: t, ...(t.data.due ? { due: t.data.due as string } : {}) })),
  ];
  return out.sort((a, b) => {
    if (!!a.due !== !!b.due) return a.due ? -1 : 1;
    return (a.due ?? "").localeCompare(b.due ?? "") || nameOf(a).localeCompare(nameOf(b));
  });
}

/** What is still to leave on a ledger bill through `through`, in dollars: not
 *  paid, due on or before that day (overdue counts, it still has to go). Only
 *  dollar bills add up here, because the Yours number is dollars; a bill in
 *  another currency is shown but never summed into it. */
export function ledgerBillsOut(bills: Bill[], through: string, today: string): number {
  let cents = 0;
  for (const b of bills) {
    const d = b.data;
    if (d.currency !== DEFAULT_CURRENCY || !d.dueDate || !isRealDate(d.dueDate)) continue;
    if (billStatus(d, today) === "paid" || d.dueDate > through) continue;
    cents += d.amountCents;
  }
  return cents / 100;
}

/** Dollars paid in this month by ledger bills, and how many (Paid This Month). */
export function ledgerPaidThisMonth(bills: Bill[], today: string): { total: number; count: number } {
  const month = today.slice(0, 7);
  let sum = 0;
  let count = 0;
  for (const b of bills) {
    const d = b.data;
    if (!isPaid(d) || !d.paidAt || d.paidAt.slice(0, 7) !== month || d.currency !== DEFAULT_CURRENCY) continue;
    sum += d.amountCents;
    count++;
  }
  return { total: sum / 100, count };
}
