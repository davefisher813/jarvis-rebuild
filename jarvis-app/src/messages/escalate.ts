// THE ESCALATION LADDER'S COUNTER (N13, Dave 2026-08-20).
//
// Fifty-five days deserves a different tone than three. One nudge template
// for every wait is why follow-ups stop working: the second one reads exactly
// like the first, so the reader learns that nothing changes if they ignore it.
//
// EMAIL-F-29 (2026-09-05): the ladder itself now lives in mailAction.ts,
// which derives the rung from the thread rather than from the wait alone.
// The copy that used to sit here (Rung, Channel, Ladder, RUNG_AT, rungFor,
// LadderOpts, ladderFor) had no caller but its own test, and two RUNG_AT
// constants in one module tree is a drift waiting to happen. What is left is
// the half mailAction reads: how many nudges have actually gone out per
// thread, so the ladder climbs even when the wait clock is short because he
// chased early. The count is a count, never a run.

const KEY = "jarvis.mail.nudges.v1";

export function loadNudgeCounts(storage: Pick<Storage, "getItem"> = localStorage): Record<string, number> {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "{}") as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) if (typeof v === "number") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function countNudge(
  threadId: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Record<string, number> {
  const cur = loadNudgeCounts(storage);
  const next = { ...cur, [threadId]: (cur[threadId] ?? 0) + 1 };
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
