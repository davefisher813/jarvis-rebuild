import { dayGap, isRealDate } from "./dates";
import { normalizeVendor } from "./fingerprint";
import type { BillData, BillRecurrence } from "./types";

// RECURRING-BILL SUGGESTIONS (spec section 3). A suggestion is a CANDIDATE,
// never a record and never a schedule: it names a pattern the bills already
// show ("ConEdison, $84.12, three months in a row") and waits for a tap. This
// reads bills the person entered; it asks no model.

export interface RecurringSuggestion {
  vendor: string;
  amountCents: number;
  recurrence: BillRecurrence;
  /** The bill the confirmation would be written to: the latest of the run. */
  billId: string;
  /** How many in a row were seen. */
  count: number;
}

const ym = (iso: string): number => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/** Three or more bills from one vendor, the same amount to the cent, on
 *  consecutive calendar months, none of them already recurring. Bills with no
 *  due date take no part: there is no date to find a rhythm in. */
export function suggestMonthly(bills: { id: string; data: BillData }[]): RecurringSuggestion[] {
  const groups = new Map<string, { id: string; data: BillData }[]>();
  for (const b of bills) {
    if (!b.data.dueDate || !isRealDate(b.data.dueDate)) continue;
    const key = normalizeVendor(b.data.vendor) + "|" + b.data.amountCents + "|" + b.data.currency;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const out: RecurringSuggestion[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.data.dueDate!.localeCompare(b.data.dueDate!));
    // The trailing run of consecutive months ending at the latest bill.
    let run = 1;
    for (let i = sorted.length - 1; i > 0; i--) {
      if (ym(sorted[i]!.data.dueDate!) - ym(sorted[i - 1]!.data.dueDate!) === 1) run++;
      else break;
    }
    const latest = sorted[sorted.length - 1]!;
    if (run >= 3 && !latest.data.recurrence) {
      out.push({ vendor: latest.data.vendor, amountCents: latest.data.amountCents, recurrence: "monthly", billId: latest.id, count: run });
    }
  }
  return out.sort((a, b) => a.vendor.localeCompare(b.vendor));
}

// dayGap is re-exported so the screen can word "3 months in a row" without a
// second date helper.
export { dayGap };
