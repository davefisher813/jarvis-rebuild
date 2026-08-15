// The Day Loop (Group C item 14, REVISED by Dave 2026-08-14; supersedes
// Morning Already Planned). The ENTIRE day is drafted at first open, tasks
// placed into real gaps around events, routine, and protected time, plus an
// Anytime pool. One Accept commits the whole day: still the honest commit
// moment, NEVER auto-committed. Continuous re-flow (push 16) keeps the
// remainder true; what stops fitting is said out loud with a Set Aside
// offer, never silent overflow. Auto-Sweep stages tomorrow and tomorrow's
// draft is prepared before the next open. Draft, accept, live, re-flow,
// close, redraft: one loop.
//
// Drafting is DETERMINISTIC (the placement engine in planDay.ts): the loop
// costs zero AI calls, works offline, and is instant at open.

import { planDay, type PlanBlock, type PlanTask } from "../schedule/planDay";
import type { EventItem } from "../schedule/types";

export interface DayDraft {
  date: string;
  blocks: PlanBlock[];
  // What did not fit: the honest pool, shown, never silently dropped.
  anytime: { id: string; text: string }[];
  accepted: boolean;
  // Event ids created by Accept, so undo and re-flow know their own blocks.
  eventIds: string[];
  dismissed: boolean;
}

const KEY = "jarvis.dayloop.v1";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readDraft(date: string): DayDraft | null {
  const s = storage();
  if (!s) return null;
  try {
    const d = JSON.parse(s.getItem(KEY) || "null") as DayDraft | null;
    return d && d.date === date ? d : null;
  } catch {
    return null;
  }
}

export function writeDraft(d: DayDraft): void {
  const s = storage();
  if (!s) return;
  try { s.setItem(KEY, JSON.stringify(d)); } catch { /* the loop redrafts */ }
}

export interface DraftInputs {
  date: string;
  candidates: { id: string; text: string; category: string; suggested: boolean; windowS?: number; windowE?: number }[];
  events: EventItem[];
  startMin: number;
  endMin: number;
  blocked: { s: number; e: number; label: string; soft?: boolean; kind?: string }[];
  maxBlocks: number | null;
  estimateFor: (category: string) => number;
}

// Build (or rebuild) the day's draft. Suggested candidates first, capped at
// the day's sizing; what does not place lands in Anytime.
export function draftDay(inp: DraftInputs): DayDraft {
  const cap = inp.maxBlocks ?? 5;
  const picks = inp.candidates.filter((c) => c.suggested).slice(0, cap);
  const rest = inp.candidates.filter((c) => !picks.some((p) => p.id === c.id));
  const tasks: PlanTask[] = picks.map((c) => ({
    id: c.id,
    text: c.text,
    category: c.category,
    durationMin: inp.estimateFor(c.category),
    ...(c.windowS !== undefined ? { windowS: c.windowS } : {}),
    ...(c.windowE !== undefined ? { windowE: c.windowE } : {}),
  }));
  const hard = inp.blocked.filter((b) => !b.soft && b.kind !== "focus").map((b) => ({ s: b.s, e: b.e }));
  const soft = inp.blocked.filter((b) => b.soft && b.kind !== "focus").map((b) => ({ s: b.s, e: b.e, label: b.label }));
  const focus = inp.blocked.filter((b) => b.kind === "focus").map((b) => ({ s: b.s, e: b.e }));
  const plan = planDay(tasks, inp.events, inp.startMin, inp.endMin, 10, hard, soft, focus);
  return {
    date: inp.date,
    blocks: plan.blocks,
    anytime: [
      ...plan.unplaced.map((t) => ({ id: t.id, text: t.text })),
      ...rest.map((c) => ({ id: c.id, text: c.text })),
    ],
    accepted: false,
    eventIds: [],
    dismissed: false,
  };
}

// Re-flow (push 16): the remainder of an ACCEPTED day, re-draped around
// reality. A block whose start has passed without its task completing is
// re-placed into the remaining open time; blocks that no longer fit are
// reported for the Set Aside offer, never dropped silently. Pure: returns
// the moves; the caller applies them through the schedule service so every
// move is a real, undoable write.
export interface ReflowResult {
  // Event id -> new start/end.
  moves: { eventId: string; start: string; end: string; prevStart: string; prevEnd: string }[];
  // Plan blocks that no longer fit anywhere today.
  overflow: { eventId: string; title: string }[];
}

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};
const toHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function reflowDay(
  planEvents: EventItem[], // today's events created from the plan (sourceTaskId set)
  otherEvents: EventItem[], // everything else on the calendar today
  nowMin: number,
  endMin: number,
  blocked: { s: number; e: number }[],
): ReflowResult {
  // Which plan blocks slipped: start passed, still in the future half of the
  // plan? A block wholly in the past that the user let slide is exactly what
  // re-flow exists to rescue.
  const slipped = planEvents.filter((ev) => toMin(ev.data.start) < nowMin);
  const upcoming = planEvents.filter((ev) => toMin(ev.data.start) >= nowMin);
  if (slipped.length === 0) return { moves: [], overflow: [] };

  // Busy = real events + blocked ranges + upcoming plan blocks (they keep
  // their slots; only slipped work moves).
  const busy = [
    ...otherEvents.map((e) => ({ s: toMin(e.data.start), e: e.data.end ? toMin(e.data.end) : toMin(e.data.start) + 60 })),
    ...upcoming.map((e) => ({ s: toMin(e.data.start), e: e.data.end ? toMin(e.data.end) : toMin(e.data.start) + 60 })),
    ...blocked,
  ].filter((b) => b.e > nowMin);

  const moves: ReflowResult["moves"] = [];
  const overflow: ReflowResult["overflow"] = [];
  let cursor = nowMin;
  const BUFFER = 10;
  for (const ev of slipped) {
    const dur = ev.data.end ? toMin(ev.data.end) - toMin(ev.data.start) : 60;
    // First gap from the cursor that fits.
    let s = cursor;
    let placed = false;
    while (s + dur <= endMin) {
      const clash = busy.find((b) => s < b.e && b.s < s + dur);
      if (!clash) { placed = true; break; }
      s = clash.e + BUFFER;
    }
    if (!placed) {
      overflow.push({ eventId: ev.id, title: ev.data.title });
      continue;
    }
    moves.push({
      eventId: ev.id,
      start: toHHMM(s),
      end: toHHMM(s + dur),
      prevStart: ev.data.start,
      prevEnd: ev.data.end ?? toHHMM(toMin(ev.data.start) + dur),
    });
    busy.push({ s, e: s + dur });
    cursor = s;
  }
  return { moves, overflow };
}
