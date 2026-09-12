import { EMPTY_RECEIPTS, type SweepReceipts } from "./sweep";

// THE PARKED SWEEP (E-19, Email Build Master 2026-09-12, Push D).
//
// Backing out of the Sweep used to END it: the finish screen printed the
// receipts and the hand went back into the deck, so a phone call at card
// four meant dealing again from card one. A session is now a thing that can
// be put down and picked up. The nav's back button parks it here; the next
// visit to the Sweep, inside one session length, offers Continue Where You
// Left Off with the card number he stopped at.
//
// Laws:
//   - This is UI state, not a record. It never becomes an event, and no
//     event writer reads it (laws/email.test.ts, law 8): the plan text is
//     the prepared reply in his voice, which is exactly the free text the
//     event log must never carry.
//   - It expires. A parked hand older than one session length is stale by
//     definition (the inbox moved on), and Continue is never offered on it.
//   - Only Start Over or a natural finish clears it. Parking again just
//     overwrites.

export const SESSION_KEY = "jarvis.mail.sweep.session.v1";

export interface SweepSession {
  handIds: string[];
  idx: number;
  planText?: string;
  savedAt: number;
  // 7A: the receipts follow the hand, so a session finished in two sittings
  // still prints what it truly did, not just the second half.
  receipts?: SweepReceipts;
  // How long the first sitting ran, so the finish screen's time is honest.
  elapsedMs?: number;
}

export function loadSweepSession(storage: Pick<Storage, "getItem"> = localStorage): SweepSession | null {
  try {
    const p = JSON.parse(storage.getItem(SESSION_KEY) || "null") as Partial<SweepSession> | null;
    if (!p || typeof p !== "object") return null;
    if (!Array.isArray(p.handIds) || !p.handIds.every((h) => typeof h === "string")) return null;
    if (typeof p.idx !== "number" || !Number.isInteger(p.idx) || p.idx < 0) return null;
    if (typeof p.savedAt !== "number") return null;
    const r = p.receipts;
    const receipts = r && typeof r === "object"
      ? { ...EMPTY_RECEIPTS, ...Object.fromEntries(Object.entries(r).filter(([k, v]) => k in EMPTY_RECEIPTS && typeof v === "number")) } as SweepReceipts
      : undefined;
    return {
      handIds: p.handIds,
      idx: p.idx,
      savedAt: p.savedAt,
      ...(typeof p.planText === "string" && p.planText ? { planText: p.planText } : {}),
      ...(receipts ? { receipts } : {}),
      ...(typeof p.elapsedMs === "number" && p.elapsedMs >= 0 ? { elapsedMs: p.elapsedMs } : {}),
    };
  } catch {
    return null;
  }
}

export function saveSweepSession(s: SweepSession, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function clearSweepSession(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try { storage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}

/** Fresh means parked less than one session length ago: older than that
 *  the inbox has moved on and the offer would be a lie. */
export function isFreshSession(s: SweepSession | null, now: number, sessionMs: number): s is SweepSession {
  return !!s && now - s.savedAt >= 0 && now - s.savedAt < sessionMs;
}

/**
 * The hand to continue with, dealt from what is STILL in the deck. Cards
 * handled elsewhere since the park (the thread opened and archived from the
 * list, say) drop out; the order is the parked order, so "4 of 9" still
 * means the same cards in the same seats. Null when nothing parked is left
 * to continue: the offer is then not made.
 */
export function resumeHand<T extends { id: string }>(s: SweepSession, threads: readonly T[]): { hand: T[]; idx: number } | null {
  const byId = new Map(threads.map((t) => [t.id, t]));
  const hand: T[] = [];
  let idx = -1;
  for (let i = 0; i < s.handIds.length; i++) {
    const t = byId.get(s.handIds[i]!);
    if (!t) continue;
    if (i >= s.idx && idx < 0) idx = hand.length;
    hand.push(t);
  }
  if (hand.length === 0 || idx < 0) return null;
  return { hand, idx };
}
