import { fmtCents, fmtDay } from "./tracker";
import type { HistoryEntry } from "./ledger/types";

// A RECORD'S HISTORY, IN PLAIN WORDS (ledger acceptance 9). The list rides in
// the record (history.ts); this turns each line into the three things a row
// shows: the day, what happened, and what changed with before and after.

export interface HistoryLine {
  /** Stable key for the list. */
  key: string;
  /** "2026-10-03", the day the line was written. */
  day: string;
  /** "Corrected", "Matched to a Receipt". */
  what: string;
  /** "Amount $47.12 to $48.00"; one per changed field. */
  changes: string[];
}

const LABEL: Record<string, string> = {
  vendor: "Vendor", merchant: "Merchant", amountCents: "Amount", transactionDate: "Date", date: "Date",
  category: "Category", account: "Account", name: "Name",
  linkedTransactionId: "Payment", matchedReceiptId: "Receipt", paysBillId: "Bill",
};
const IDS = new Set(["linkedTransactionId", "matchedReceiptId", "paysBillId"]);

function show(field: string, v: unknown): string {
  if (v === undefined || v === null || v === "") return "none";
  if (field === "amountCents" && typeof v === "number") return fmtCents(v);
  if ((field === "transactionDate" || field === "date") && typeof v === "string") return fmtDay(v);
  return String(v);
}

function change(field: string, c: { from?: unknown; to?: unknown }): string {
  const label = LABEL[field] ?? field;
  // An id means nothing to a person: a link is said as added or removed.
  if (IDS.has(field)) return c.to !== undefined && c.to !== null ? `${label} linked` : `${label} unlinked`;
  return `${label} ${show(field, c.from)} to ${show(field, c.to)}`;
}

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Oldest first, the order things happened. A missing or damaged list is empty. */
export function historyLines(history: HistoryEntry[] | undefined): HistoryLine[] {
  if (!Array.isArray(history)) return [];
  return history.map((h, i) => ({
    key: `${i}-${h.at}`,
    day: typeof h.at === "string" ? h.at.slice(0, 10) : "",
    what: sentence(h.action ?? ""),
    changes: Object.entries(h.changes ?? {}).map(([f, c]) => change(f, c)),
  }));
}
