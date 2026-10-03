// BILLS NEVER BECOME TASKS (spec hard rule 1, enforced in code).
//
// Any candidate that looks like a bill (an amount and a vendor, a `bill`
// field, or a bill-kind word with an amount) is refused at the door of the
// task pipeline, and the refusal is logged. It is not a UI nicety: the guard
// is called from TasksService.createTask itself, so no feature, present or
// future, can turn a bill into a task by going around a screen.

export interface TaskCandidateProbe {
  bill?: unknown;
  kind?: unknown;
  amount?: unknown;
  amountCents?: unknown;
  vendor?: unknown;
}

export interface Rejection { at: string; via: string; reason: string }

const BILL_KINDS = new Set(["bill", "invoice", "payment", "renewal", "subscription"]);
const LOG_CAP = 50;
const rejections: Rejection[] = [];

const positive = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x) && x > 0;

/** True when the candidate reads as a bill under any of its three shapes. */
export function isBillShaped(c: TaskCandidateProbe): boolean {
  if (c.bill) return true;
  const amount = positive(c.amount) || positive(c.amountCents);
  if (!amount) return false;
  if (typeof c.kind === "string" && BILL_KINDS.has(c.kind.trim().toLowerCase())) return true;
  return typeof c.vendor === "string" && c.vendor.trim().length > 0;
}

/** Ask before a task is made from a candidate. `via` names the door. */
export function guardTaskCandidate(c: TaskCandidateProbe, via: string, now: () => string = () => new Date().toISOString()): { ok: true } | { ok: false; reason: "bill_is_not_a_task" } {
  if (!isBillShaped(c)) return { ok: true };
  rejections.push({ at: now(), via, reason: "bill_is_not_a_task" });
  if (rejections.length > LOG_CAP) rejections.shift();
  // The log line a person debugging "where did my bill go" will look for.
  if (typeof console !== "undefined") console.warn(`[money] refused to make a task from a bill-shaped candidate (via ${via}); it belongs in Money.`);
  return { ok: false, reason: "bill_is_not_a_task" };
}

export function recentRejections(): readonly Rejection[] { return rejections; }
export function clearRejections(): void { rejections.length = 0; }
