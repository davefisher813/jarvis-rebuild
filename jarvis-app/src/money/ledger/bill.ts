import { parseCents } from "./cents";
import { isRealDate } from "./dates";
import { fingerprintOf } from "./fingerprint";
import { appended, diffFields, entry, isoNow, type Clock } from "./history";
import { isPaid } from "./status";
import { checkCore, optionalDate, type Checked } from "./validate";
import type { BillData, BillRecurrence, BillSource, HistoryEntry, PaidEvidence } from "./types";

// BILL OPERATIONS, PURE (spec section 3). Each one takes a bill and answers
// with the next bill or the reason it refuses. Nothing here touches a store,
// so every rule is testable without one, and the service has nothing to decide.

export interface BillInput {
  vendor?: string;
  amount?: string | number | null;
  currency?: string | null;
  /** Blank stays blank. A guessed due date is worse than none. */
  dueDate?: string | null;
  notes?: string | null;
  autopay?: boolean;
  payUrl?: string | null;
  /** Honoured only when a person chose it (`by: "user"`); see buildBill. */
  recurrence?: BillRecurrence | null;
}

const RECURRENCES: readonly BillRecurrence[] = ["weekly", "monthly", "yearly"];
const BILL_FIELDS = ["vendor", "amountCents", "currency", "dueDate", "notes", "autopay", "payUrl", "recurrence"] as const;
/** Changing any of these on a paid bill asks for the paid state again. */
const MONEY_FACTS = ["vendor", "amountCents", "currency", "dueDate"] as const;

const sealed = (data: Omit<BillData, "fingerprint" | "history">, history: HistoryEntry[]): BillData => ({
  ...data,
  fingerprint: fingerprintOf({ kind: "bill", vendor: data.vendor, amountCents: data.amountCents, date: data.dueDate, source: data.source }),
  history,
});

/** A new bill, or the fields that kept it from being one. */
export function buildBill(
  input: BillInput,
  source: BillSource,
  by: HistoryEntry["by"],
  now: Clock = isoNow,
): Checked<BillData> {
  const core = checkCore(input);
  const due = optionalDate(input.dueDate);
  const errors = core.ok ? [] : [...core.errors];
  if (!due.ok) errors.push("dueDate");
  if (errors.length || !core.ok || !due.ok) return { ok: false, errors };
  const notes = input.notes?.trim();
  const payUrl = input.payUrl?.trim();
  // Recurrence is the person's call. A pipeline cannot schedule a bill by
  // inferring it (spec: "never inferred into a schedule").
  const recurrence = by === "user" && input.recurrence && RECURRENCES.includes(input.recurrence) ? input.recurrence : undefined;
  const data = sealed({
    ...core.value,
    ...(due.value ? { dueDate: due.value } : {}),
    ...(notes ? { notes } : {}),
    ...(input.autopay ? { autopay: true } : {}),
    ...(payUrl ? { payUrl } : {}),
    ...(recurrence ? { recurrence } : {}),
    source,
  }, [entry(by, source === "manual" ? "created" : "created from an email", undefined, now)]);
  return { ok: true, value: data };
}

export interface BillCorrection {
  vendor?: string;
  amount?: string | number | null;
  currency?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  autopay?: boolean;
  payUrl?: string | null;
  recurrence?: BillRecurrence | null;
}

/** A correction as a versioned update that shows what changed. A paid bill
 *  whose amount, vendor, currency or due date changed is no longer known to be
 *  paid: the paid state waits for the person to confirm it again. */
export function correctBill(
  before: BillData,
  c: BillCorrection,
  by: HistoryEntry["by"] = "user",
  now: Clock = isoNow,
): Checked<{ next: BillData; changed: boolean }> {
  const errors: string[] = [];
  let vendor = before.vendor;
  let amountCents = before.amountCents;
  let currency = before.currency;
  let dueDate = before.dueDate;
  if (c.vendor !== undefined) {
    vendor = c.vendor.trim();
    if (!vendor) errors.push("vendor");
  }
  if (c.amount !== undefined) {
    const cents = parseCents(c.amount);
    if (cents === null) errors.push("amount"); else amountCents = cents;
  }
  if (c.currency !== undefined) {
    const core = checkCore({ vendor: "x", amount: 1, currency: c.currency });
    if (!core.ok) errors.push("currency"); else currency = core.value.currency;
  }
  if (c.dueDate !== undefined) {
    const d = optionalDate(c.dueDate);
    if (!d.ok) errors.push("dueDate"); else dueDate = d.value;
  }
  if (errors.length) return { ok: false, errors };

  const draft: BillData = { ...before, vendor, amountCents, currency };
  if (dueDate) draft.dueDate = dueDate; else delete draft.dueDate;
  if (c.notes !== undefined) { const n = c.notes?.trim(); if (n) draft.notes = n; else delete draft.notes; }
  if (c.payUrl !== undefined) { const u = c.payUrl?.trim(); if (u) draft.payUrl = u; else delete draft.payUrl; }
  if (c.autopay !== undefined) { if (c.autopay) draft.autopay = true; else delete draft.autopay; }
  if (c.recurrence !== undefined) {
    if (by === "user" && c.recurrence && RECURRENCES.includes(c.recurrence)) draft.recurrence = c.recurrence;
    else delete draft.recurrence;
  }

  const changes = diffFields(before, draft, BILL_FIELDS);
  if (!Object.keys(changes).length) return { ok: true, value: { next: before, changed: false } };

  const reopens = isPaid(before) && MONEY_FACTS.some((f) => f in changes);
  if (reopens) draft.paidNeedsReconfirm = true;
  const next = sealed(
    { ...draft },
    appended(before.history, entry(by, reopens ? "corrected, paid state needs confirming" : "corrected", changes, now)),
  );
  return { ok: true, value: { next, changed: true } };
}

export type MarkPaidResult = { ok: true; next: BillData } | { ok: false; reason: "evidence_required" | "paid_date_required" | "bad_evidence" };

/** The only way into "paid" (spec rule 2, acceptance 2). No evidence, no paid:
 *  not "probably", not "autopay is on", not a silent default. */
export function markPaid(
  before: BillData,
  evidence: PaidEvidence | null | undefined,
  paidAt: string | null | undefined,
  by: HistoryEntry["by"] = "user",
  now: Clock = isoNow,
): MarkPaidResult {
  if (!evidence) return { ok: false, reason: "evidence_required" };
  if (evidence.type === "transaction" && !evidence.transactionId) return { ok: false, reason: "bad_evidence" };
  if (evidence.type === "confirmation" && !evidence.fingerprint) return { ok: false, reason: "bad_evidence" };
  // A stored record can carry anything; only the three real kinds count.
  const kind = (evidence as { type: string }).type;
  if (kind !== "user_confirmed" && kind !== "transaction" && kind !== "confirmation") return { ok: false, reason: "bad_evidence" };
  if (!isRealDate(paidAt)) return { ok: false, reason: "paid_date_required" };
  const next: BillData = { ...before, paidAt, paidEvidence: evidence };
  delete next.paidNeedsReconfirm;
  next.history = appended(before.history, entry(by, "marked paid", { paidAt: { from: before.paidAt, to: paidAt }, paidEvidence: { from: before.paidEvidence, to: evidence } }, now));
  return { ok: true, next };
}

/** Takes the paid state back off (Undo of Mark Paid, or "that was not paid"). */
export function unmarkPaid(before: BillData, by: HistoryEntry["by"] = "user", now: Clock = isoNow): BillData {
  const next: BillData = { ...before };
  delete next.paidAt;
  delete next.paidEvidence;
  delete next.paidNeedsReconfirm;
  next.history = appended(before.history, entry(by, "paid state removed", { paidAt: { from: before.paidAt } }, now));
  return next;
}

/** Recurrence, set only here or by the person's own choice on the sheet. */
export function confirmRecurrence(before: BillData, recurrence: BillRecurrence, now: Clock = isoNow): BillData {
  return {
    ...before,
    recurrence,
    history: appended(before.history, entry("user", "recurrence confirmed", { recurrence: { from: before.recurrence, to: recurrence } }, now)),
  };
}

/** Defence for the second wall: a stored bill that claims a paid date without
 *  evidence is refused at write time, not just read as unpaid. */
export function assertWritable(data: BillData): { ok: true } | { ok: false; reason: string } {
  if (data.paidAt && !data.paidEvidence) return { ok: false, reason: "evidence_required" };
  if (data.paidEvidence && !data.paidAt) return { ok: false, reason: "paid_date_required" };
  return { ok: true };
}
