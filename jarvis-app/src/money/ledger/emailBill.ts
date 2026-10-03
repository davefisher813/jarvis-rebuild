import type { LedgerService } from "./LedgerService";
import type { BillCorrection } from "./bill";
import { parseCents } from "./cents";
import { isRealDate } from "./dates";
import { normalizeVendor } from "./fingerprint";
import { isPaid } from "./status";
import type { Bill, EmailSource } from "./types";

// A BILL THAT ARRIVES BY EMAIL, AND THE LATER CHANGES TO IT (spec section 6).
//
// One thread is one bill. The same mail door can be tapped twice, and the same
// thread can come back with a new amount ("Your bill is now $90") or a new due
// date; none of those may make a second record (hard rule 4). The bill already
// in Money is matched by its thread, and a difference is offered as an UPDATE
// to that bill, never written silently and never added beside it. The update
// goes through ledger.correctBill, so what changed is in the bill's history and
// a paid bill's paid state waits for the person to confirm it again (rule 2).
//
// Nothing here reads a clock, guesses a date or calls a model: a due date is in
// the result only when the mail stated one (rule 3), and every door works with
// every AI feature off (rule 5). The pure half is the first four exports; the
// last two are the thin service calls the mail doors share.

/** The stable key for a mail thread's bill. */
export const threadFingerprint = (threadId: string): string => `gmail:${threadId}`;

export function emailSourceFor(threadId: string): EmailSource {
  return { type: "email", fingerprint: threadFingerprint(threadId), ref: threadId };
}

/** The bill a thread already made, or null. Matches on the stored source's
 *  `ref` or its fingerprint. When a thread somehow holds several, the one whose
 *  vendor reads the same wins; otherwise the first stands. */
export function findBillForThread(bills: Bill[], threadId: string, vendor?: string): Bill | null {
  const key = threadFingerprint(threadId);
  const hits = bills.filter((b) => {
    const s = b.data.source;
    return typeof s === "object" && s !== null && (s.ref === threadId || s.fingerprint === key);
  });
  if (!hits.length) return null;
  if (vendor && hits.length > 1) {
    const want = normalizeVendor(vendor);
    const same = hits.find((b) => normalizeVendor(b.data.vendor) === want);
    if (same) return same;
  }
  return hits[0]!;
}

export interface IncomingBill {
  amount: number | string | null;
  /** Only ever a date the mail stated. Blank never changes an existing one. */
  dueDate?: string | null;
}

export interface BillUpdate {
  billId: string;
  vendor: string;
  /** What `ledger.correctBill` is called with: only the facts that differ. */
  correction: BillCorrection;
  changes: ("amount" | "dueDate")[];
  /** The bill was paid; applying this asks for the paid state again. */
  reopensPaid: boolean;
  /** The question to put to the person, ready to show. */
  prompt: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayWords(iso: string): string {
  const [, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}`;
}

/** "$84.12", or "EUR 84.12" for any currency that is not dollars. */
export function moneyWords(cents: number, currency = "USD"): string {
  const n = (cents / 100).toFixed(2);
  return currency === "USD" ? `$${n}` : `${currency} ${n}`;
}

/** The difference between the bill in Money and what the mail now says, or
 *  null when there is none (the same amount, and no new or different date). */
export function describeUpdate(existing: Bill, incoming: IncomingBill): BillUpdate | null {
  const d = existing.data;
  const cents = parseCents(incoming.amount);
  const amountChanged = cents !== null && cents !== d.amountCents;
  const due = typeof incoming.dueDate === "string" && isRealDate(incoming.dueDate.trim()) ? incoming.dueDate.trim() : undefined;
  const dueChanged = !!due && due !== d.dueDate;
  if (!amountChanged && !dueChanged) return null;

  const correction: BillCorrection = {};
  const changes: BillUpdate["changes"] = [];
  if (amountChanged) { correction.amount = cents! / 100; changes.push("amount"); }
  if (dueChanged) { correction.dueDate = due; changes.push("dueDate"); }

  const was = moneyWords(d.amountCents, d.currency);
  const now = amountChanged ? moneyWords(cents!, d.currency) : was;
  let prompt: string;
  if (amountChanged) {
    prompt = `${d.vendor} is already in Money at ${was}. Update it to ${now}${dueChanged ? `, due ${dayWords(due!)}` : ""}?`;
  } else if (d.dueDate) {
    prompt = `${d.vendor} is already in Money, due ${dayWords(d.dueDate)}. Change the due date to ${dayWords(due!)}?`;
  } else {
    prompt = `${d.vendor} is already in Money with no due date. Set it to ${dayWords(due!)}?`;
  }
  const reopensPaid = isPaid(d);
  if (reopensPaid) prompt += " It will need its paid mark confirmed again.";
  return { billId: existing.id, vendor: d.vendor, correction, changes, reopensPaid, prompt };
}

const FIELD_WORDS: Record<string, string> = {
  vendor: "a Vendor", amount: "an Amount", currency: "a Real Currency", dueDate: "a Real Due Date",
};

/** What a refused write was missing, for the receipt: "Bill Needs a Vendor · Nothing Saved". */
export function missingWords(errors: string[]): string {
  const parts = errors.map((e) => FIELD_WORDS[e] ?? e);
  return `Bill Needs ${parts.join(" and ")} · Nothing Saved`;
}

export interface BillCandidate {
  vendor: string;
  amount: number | string | null;
  /** Only a date the source stated. */
  dueDate?: string | null;
  notes?: string | null;
}

export type FiledBill =
  | { status: "added"; id: string; message: string }
  | { status: "duplicate"; id: string; message: string }
  | { status: "update"; id: string; update: BillUpdate; message: string; apply: () => Promise<{ ok: boolean; message: string }> }
  | { status: "invalid"; errors: string[]; message: string };

function amountWords(c: BillCandidate): string {
  const cents = parseCents(c.amount);
  return cents === null ? "" : ` ${moneyWords(cents)}`;
}

/** A bill the person typed, pasted or confirmed in the app. Source "manual".
 *  An exact repeat is reported, never doubled. */
export async function fileManualBill(
  ledger: Pick<LedgerService, "addBill">,
  c: BillCandidate & { recurrence?: "weekly" | "monthly" | "yearly" | null },
): Promise<FiledBill> {
  const r = await ledger.addBill({ vendor: c.vendor, amount: c.amount, dueDate: c.dueDate ?? null, notes: c.notes ?? null, recurrence: c.recurrence ?? null }, "manual", "user");
  return settled(r, c);
}

function settled(r: Awaited<ReturnType<LedgerService["addBill"]>>, c: BillCandidate): FiledBill {
  if (!r.ok) return { status: "invalid", errors: r.errors, message: missingWords(r.errors) };
  if (r.duplicate) return { status: "duplicate", id: r.id, message: `Already in Money · ${c.vendor.trim()}${amountWords(c)}` };
  return { status: "added", id: r.id, message: `Added to Money${amountWords(c) ? " ·" + amountWords(c) : ""}` };
}

/** A bill read from a mail thread. The thread is the source (`gmail:<id>`). A
 *  second approval of the same thread is reported as already in Money, and a
 *  changed amount or due date comes back as an update OFFER the caller shows;
 *  nothing is written until `apply()` is called. */
export async function fileEmailBill(
  ledger: Pick<LedgerService, "addBill" | "listBills" | "correctBill">,
  c: BillCandidate,
  threadId: string,
): Promise<FiledBill> {
  const mine = findBillForThread(await ledger.listBills(), threadId, c.vendor);
  if (mine) {
    const update = describeUpdate(mine, c);
    if (!update) return { status: "duplicate", id: mine.id, message: `Already in Money · ${mine.data.vendor} ${moneyWords(mine.data.amountCents, mine.data.currency)}` };
    return {
      status: "update", id: mine.id, update, message: update.prompt,
      apply: async () => {
        const w = await ledger.correctBill(mine.id, update.correction);
        if (!w.ok) return { ok: false, message: "Couldn't Update It · Nothing Changed" };
        const to = update.correction.amount !== undefined ? ` · ${moneyWords(Math.round(Number(update.correction.amount) * 100), mine.data.currency)}` : "";
        return { ok: true, message: `Updated in Money${to}` };
      },
    };
  }
  const r = await ledger.addBill(
    { vendor: c.vendor, amount: c.amount, dueDate: c.dueDate ?? null, notes: c.notes ?? null },
    emailSourceFor(threadId),
    "email",
  );
  return settled(r, c);
}
