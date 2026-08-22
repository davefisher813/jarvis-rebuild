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

// A draft that still proposes times already in the past is stale: showing it
// would break "a plan never lies about time", and accepting it would write
// past placements (hotfix 2026-08-21: an 8:30 AM draft accepted at 2 PM was
// one of the two machines behind the duplicate-and-overlap screenshots).
// Accepted drafts are re-flow's job, not staleness's.
export function draftIsStale(d: DayDraft, nowMin: number): boolean {
  if (d.accepted) return false;
  const toM = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
  return d.blocks.some((b) => toM(b.start) < nowMin);
}

// THE PLAN ALREADY ANSWERED IT (Dave 2026-08-22). His screenshot had
// "Finish Jarvis Visuals" placed at 12:00 PM by the drafted day AND
// headlining Heads Up as "Slid 3d · Break It Down": the same task twice on
// one screen, which the locked law "no repetition on any page" forbids. Of
// the two the notice is the weaker, because the card above has already
// given the task a time. Producers ask this before they nag.
//
// An accepted draft still holds its tasks, so the quiet lasts through the
// day. A DISMISSED draft holds nothing -- he threw the plan away, so the
// notices are news again. Pure, so the law is testable.
export function plannedTaskIds(draft: DayDraft | null | undefined): Set<string> {
  if (!draft || draft.dismissed) return new Set<string>();
  return new Set(draft.blocks.map((b) => b.taskId));
}

// ONE PROPOSED DAY (planning merge, phase 1, 2026-08-22).
//
// There were two auto-planners. The Day Loop drafted the day and cached it;
// the plan sheet ran its own autoSelect the moment it mounted and held the
// result in component state. Tapping Edit on the drafted card therefore did
// not open that draft -- it opened a second planner that re-picked from
// scratch, and committing there left the first proposal standing. The card
// then still offered "Accept the Day" for a plan that was already committed,
// and accepting it swept the blocks he had just made and wrote the OLD ones
// back. Same failure family as the duplicate machine of 2026-08-21: more
// than one thing believed it owned the day.
//
// The draft is the one proposal now. The sheet seeds from it, and a commit
// through any surface RESOLVES it: same object, marked accepted, holding
// what actually got written. Pure, so the law is testable.
export function acceptInto(
  standing: DayDraft | null,
  date: string,
  blocks: PlanBlock[],
  eventIds: string[],
): DayDraft | null {
  // Nothing standing for this date, or he threw it away: the commit is its
  // own thing and there is no card to reconcile.
  if (!standing || standing.date !== date || standing.dismissed) return null;
  const placed = new Set(blocks.map((b) => b.taskId));
  return {
    ...standing,
    blocks,
    // What just got a time leaves the honest leftovers pool.
    anytime: standing.anytime.filter((a) => !placed.has(a.id)),
    accepted: true,
    eventIds,
  };
}

// The picks and lengths a sheet should open with, taken from the standing
// draft rather than re-derived. Ids the task list no longer offers (finished
// or deleted since the draft was cut) are dropped: seeding a pick for a task
// that is not in the list would show a phantom row.
export function seedFrom(
  standing: DayDraft | null,
  known: Iterable<string>,
): { ids: string[]; minutes: Record<string, number> } | null {
  if (!standing || standing.dismissed || standing.blocks.length === 0) return null;
  const have = new Set(known);
  const toMin = (hhmm: string) => {
    const p = hhmm.split(":");
    return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
  };
  const ids: string[] = [];
  const minutes: Record<string, number> = {};
  for (const b of standing.blocks) {
    if (!have.has(b.taskId)) continue;
    ids.push(b.taskId);
    const len = toMin(b.end) - toMin(b.start);
    if (len > 0) minutes[b.taskId] = len;
  }
  return ids.length > 0 ? { ids, minutes } : null;
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

// EDIT IN PLACE (planning merge, phase 2, 2026-08-22).
//
// The card's rows become editable where they already sit: change a length,
// drop a block, pull one up from Anytime. Each edit re-places the whole day
// through the SAME engine the draft was cut with, so the times below an edit
// move honestly instead of the card showing a length that disagrees with the
// clock beside it.
//
// Pure, and it goes through planDay exactly like draftDay does, so an edited
// day and a drafted day cannot be placed by two different sets of rules.
export interface EditInputs {
  // Ordered task ids to place. Order is priority: earlier picks claim the
  // better slots, same as the drafter.
  ids: string[];
  minutes: Record<string, number>;
  // Everything the day could hold, so a promoted Anytime task can be found
  // and a dropped one can go back to the pool.
  pool: { id: string; text: string; category: string; windowS?: number; windowE?: number }[];
  events: EventItem[];
  startMin: number;
  endMin: number;
  blocked: { s: number; e: number; label: string; soft?: boolean; kind?: string }[];
  estimateFor: (category: string) => number;
}

export function editDraft(standing: DayDraft, inp: EditInputs): DayDraft {
  const byId = new Map(inp.pool.map((c) => [c.id, c]));
  const tasks: PlanTask[] = [];
  for (const id of inp.ids) {
    const c = byId.get(id);
    if (!c) continue; // gone from the pool: never place a phantom
    tasks.push({
      id: c.id,
      text: c.text,
      category: c.category,
      durationMin: inp.minutes[id] ?? inp.estimateFor(c.category),
      ...(c.windowS !== undefined ? { windowS: c.windowS } : {}),
      ...(c.windowE !== undefined ? { windowE: c.windowE } : {}),
    });
  }
  const hard = inp.blocked.filter((b) => !b.soft && b.kind !== "focus").map((b) => ({ s: b.s, e: b.e }));
  const soft = inp.blocked.filter((b) => b.soft && b.kind !== "focus").map((b) => ({ s: b.s, e: b.e, label: b.label }));
  const focus = inp.blocked.filter((b) => b.kind === "focus").map((b) => ({ s: b.s, e: b.e }));
  const plan = planDay(tasks, inp.events, inp.startMin, inp.endMin, 10, hard, soft, focus);

  // The leftovers pool is rebuilt, not patched: anything the pool offers that
  // did not get placed belongs in Anytime, and nothing placed may also sit
  // there. Patching the old list is how a task ends up in both.
  const placed = new Set(plan.blocks.map((b) => b.taskId));
  const anytime = inp.pool
    .filter((c) => !placed.has(c.id))
    .map((c) => ({ id: c.id, text: c.text }));

  return { ...standing, blocks: plan.blocks, anytime };
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
