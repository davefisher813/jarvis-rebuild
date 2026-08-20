// THE ESCALATION LADDER (N13, Dave 2026-08-20).
//
// Fifty-five days deserves a different tone than three. One nudge template
// for every wait is why follow-ups stop working: the second one reads exactly
// like the first, so the reader learns that nothing changes if they ignore it.
//
// Laws:
//   - The tone escalates. The BLAME never does. Every rung assumes they are
//     busy; none of them mentions how many times he has asked, because that
//     is an argument, and he wants an answer.
//   - The last rung is not a harder email. It is a different channel, because
//     three ignored emails is evidence that email is not working.
//   - The rung comes from the WAIT, which is derived, so it cannot be gamed
//     by sending more nudges.

export type Rung = "gentle" | "direct" | "switch";

export interface Ladder {
  rung: Rung;
  label: string;      // what the button says
  instruction: string; // what the drafter is told
  note: string;       // what the card says under it
}

export const RUNG_AT = { direct: 7, switch: 21 };

export function rungFor(waitingDays: number, nudgesSent = 0): Rung {
  if (waitingDays >= RUNG_AT.switch || nudgesSent >= 2) return "switch";
  if (waitingDays >= RUNG_AT.direct || nudgesSent >= 1) return "direct";
  return "gentle";
}

export function ladderFor(waitingDays: number, nudgesSent = 0): Ladder {
  const rung = rungFor(waitingDays, nudgesSent);
  if (rung === "switch") {
    return {
      rung,
      label: "Try Calling",
      instruction: "Write two sentences that offer a call instead, and give a concrete window this week. Do not restate the original question and do not reference the history of this request.",
      note: "Email isn't working here",
    };
  }
  if (rung === "direct") {
    return {
      rung,
      label: "Nudge Firmly",
      instruction: "One or two sentences, direct and specific. Name exactly what you need and by when. Stay warm. Do not reference the history of this request at all.",
      note: "Direct, still warm",
    };
  }
  return {
    rung,
    label: "Nudge",
    instruction: "One or two sentences. Light and easy to answer. Assume they are busy.",
    note: "Light touch",
  };
}

// Nudges actually sent per thread, so the ladder climbs even when the wait
// clock is short because he chased early.
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
