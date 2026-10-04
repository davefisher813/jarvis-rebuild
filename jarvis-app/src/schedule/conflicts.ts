import type { EventItem } from "./types";
import { fmtTime, eventsForDate } from "./calendar";
import { durationOf } from "./dayEdit";
import { modeOf, type ProtectedRange } from "../routine/types";
import { lineCase } from "../shared/casing";

// CONFLICTS: what a proposed interval runs into (2026-10-01, the Schedule
// audit's P0 #2).
//
// The app had one overlap model, dayEdit.overlapsOn, and it answers a
// different question: which EVENTS already on a day collide with each other.
// Nothing asked the question BEFORE a write: "if I put something here, what
// does it land on?" So Add to Schedule booked a task on top of Breakfast, a
// fixed 11:20 Golf sat across a flexible Gym and Lunch, and a nudge into an
// occupied slot said nothing. This is that question, pure, so every commit
// point asks it the same way and the answer cannot drift between surfaces.
//
// THE RULES (one place, so the sheet's wording follows them):
//   - a FIXED EVENT (anything on the calendar that is not a planner block)
//     and a PROTECTED BLOCK (a routine block that says nothing lands here)
//     are a real conflict;
//   - a PLANNED TASK BLOCK (an event made from a task) is a real conflict
//     too: two things at one time is two things at one time;
//   - a FLEXIBLE BLOCK (a soft routine block, a preference rather than a
//     wall) is a SOFT conflict: still reported, so the person can choose;
//   - a block that HOLDS tasks (Deep Work) is time set aside FOR tasks, so a
//     task landing in it is the point, not a clash. It is flexible for
//     anything else, and invisible when the thing being placed is a task.
//
// Nothing here blocks anyone. The callers warn, then allow.

export type ItemKind = "event" | "protected" | "flexible" | "task";
export type Severity = "conflict" | "soft";

export interface DayItem {
  id: string;
  title: string;
  /** Minutes from midnight. */
  start: number;
  end: number;
  kind: ItemKind;
  /** A routine block that holds tasks. Only meaningful on a flexible item. */
  holds?: boolean;
}

export interface Conflict {
  item: DayItem;
  severity: Severity;
}

export interface Proposed {
  start: number;
  end: number;
  /** The event being moved or edited: it cannot conflict with itself. */
  ignoreId?: string;
  /** The thing being placed is a task, so a block that holds tasks is welcome. */
  forTask?: boolean;
}

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};
const fromMin = (m: number): string => {
  const t = Math.max(0, Math.min(24 * 60 - 1, m));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
export { toMin as hhmmToMin, fromMin as minToHhmm };

/** A routine range as the day item it is for the purposes of a conflict. */
function blockKind(r: ProtectedRange): { kind: ItemKind; holds?: boolean } {
  const mode = modeOf(r);
  // Deep Work and its kin: time FOR tasks, never a wall.
  if (mode === "holds") return { kind: "flexible", holds: true };
  // A commute or the gym is busy time even when a channel is free, so a blend
  // is a wall like Protected (2026-10-04: and, like Protected, only a
  // preference once its Kept Clear When Possible switch is on; it used to be a
  // wall whatever the switch said).
  return { kind: r.soft ? "flexible" : "protected" };
}

/**
 * The day's occupied time as one list: the events that occur on `date`
 * (recurring ones included) and the routine ranges that apply to it. An event
 * made from a task is a "task"; every other event is a "event".
 */
export function dayItemsFor(events: EventItem[], date: string, ranges: ProtectedRange[] = []): DayItem[] {
  const out: DayItem[] = [];
  for (const e of eventsForDate(events, date)) {
    const s = toMin(e.data.start);
    out.push({
      id: e.id,
      title: e.data.title,
      start: s,
      end: s + durationOf(e.data),
      kind: e.data.sourceTaskId ? "task" : "event",
    });
  }
  for (const r of ranges) {
    if (!(r.e > r.s) || !r.label.trim()) continue;
    const k = blockKind(r);
    out.push({ id: r.id ? "block:" + r.id : "block:" + r.label + "@" + r.s, title: r.label.trim(), start: r.s, end: r.e, ...k });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

const severityOf = (k: ItemKind): Severity => (k === "flexible" ? "soft" : "conflict");

/** Everything the proposed interval overlaps, earliest first, each classified. */
export function findConflicts(items: DayItem[], p: Proposed): Conflict[] {
  const end = p.end > p.start ? p.end : p.start + 15;
  const out: Conflict[] = [];
  for (const it of items) {
    if (p.ignoreId && it.id === p.ignoreId) continue;
    if (p.forTask && it.holds) continue;
    if (!(p.start < it.end && it.start < end)) continue;
    out.push({ item: it, severity: severityOf(it.kind) });
  }
  return out.sort((a, b) => a.item.start - b.item.start || a.item.end - b.item.end);
}

/** True when any of them is a real conflict rather than a soft one. */
export function hasRealConflict(cs: Conflict[]): boolean {
  return cs.some((c) => c.severity === "conflict");
}

export interface FreeSlotOpts {
  ignoreId?: string;
  forTask?: boolean;
  /** The latest the thing may END, minutes from midnight. Defaults to 11 PM. */
  dayEnd?: number;
  /** Search grid in minutes. A free slot starts on it. Defaults to 5. */
  step?: number;
}

/**
 * The nearest start at or after `from` where a `durationMin` interval touches
 * nothing: no event, no protected block, no flexible block. When the rest of
 * the day is crowded with flexible blocks only, the nearest start clear of
 * every REAL conflict is offered instead (a soft clash is a choice, an
 * occupied slot is not). Null when neither exists before `dayEnd`.
 */
export function nextFreeSlot(items: DayItem[], durationMin: number, from: number, opts: FreeSlotOpts = {}): number | null {
  const step = Math.max(1, opts.step ?? 5);
  const limit = opts.dayEnd ?? 23 * 60;
  const dur = Math.max(5, durationMin);
  const up = (m: number) => Math.ceil(m / step) * step;
  const search = (softCounts: boolean): number | null => {
    let s = up(Math.max(0, from));
    while (s + dur <= limit) {
      const clash = findConflicts(items, { start: s, end: s + dur, ignoreId: opts.ignoreId, forTask: opts.forTask })
        .find((c) => softCounts || c.severity === "conflict");
      if (!clash) return s;
      s = Math.max(s + step, up(clash.item.end));
    }
    return null;
  };
  return search(true) ?? search(false);
}

/** "9:30 to 10:00 AM" (one meridiem when both ends share it). */
export function spanText(startMin: number, endMin: number): string {
  const a = fmtTime(fromMin(startMin));
  const b = fmtTime(fromMin(endMin));
  return a.ap === b.ap ? `${a.time} to ${b.time} ${b.ap}` : `${a.time} ${a.ap} to ${b.time} ${b.ap}`;
}

/** "10:00 AM" */
export function clockText(min: number): string {
  const t = fmtTime(fromMin(min));
  return `${t.time} ${t.ap}`;
}

/**
 * ONE line naming what the interval overlaps: "Overlaps Breakfast 9:30 to
 * 10:00 AM", or "... and 1 More" when it runs into several. The real conflict
 * is named before a soft one, since that is the one worth reading.
 */
export function conflictLine(cs: Conflict[]): string {
  if (cs.length === 0) return "";
  const lead = cs.find((c) => c.severity === "conflict") ?? cs[0]!;
  const rest = cs.length - 1;
  const named = `Overlaps ${lead.item.title} ${spanText(lead.item.start, lead.item.end)}`;
  return lineCase(rest > 0 ? `${named} and ${rest} more` : named);
}

/** The same line for the fact that sits on a sheet while it is being edited. */
export function conflictTone(cs: Conflict[]): "conflict" | "soft" | null {
  if (cs.length === 0) return null;
  return hasRealConflict(cs) ? "conflict" : "soft";
}

/**
 * RUNNING LATE, SUMMARISED. Shifting the rest of the day by `mins` keeps every
 * moved event's distance from the other moved events, so the only NEW clashes
 * are with what did not move: a repeating event that stayed, an event already
 * underway, and the routine's blocks. Counts those, without a write.
 */
export function shiftNewConflicts(
  dayEvents: EventItem[],
  date: string,
  moving: EventItem[],
  mins: number,
  ranges: ProtectedRange[] = [],
): { count: number; first: Conflict | null } {
  const movingIds = new Set(moving.map((m) => m.id));
  const staying = dayItemsFor(dayEvents, date, ranges).filter((i) => !movingIds.has(i.id));
  let count = 0;
  let first: Conflict | null = null;
  for (const m of moving) {
    const s = toMin(m.data.start);
    const e = s + durationOf(m.data);
    const forTask = !!m.data.sourceTaskId;
    const before = findConflicts(staying, { start: s, end: e, forTask }).map((c) => c.item.id);
    for (const c of findConflicts(staying, { start: s + mins, end: e + mins, forTask })) {
      if (before.includes(c.item.id)) continue;
      count++;
      if (!first || (c.severity === "conflict" && first.severity === "soft")) first = c;
    }
  }
  return { count, first };
}

/**
 * A NUDGE'S TOAST LINE. Moving an event to `toStart` (keeping its length):
 * the line for the clashes that move CREATES, or "" when it creates none.
 * Clashes the event already had at its old time are not repeated, so a
 * nudge out of an overlap never scolds and a nudge within one stays quiet.
 */
export function moveNote(
  items: DayItem[],
  moved: { id: string; start: string; end?: string; forTask?: boolean },
  toStart: string,
  /** The new end when the move also sets one (the time picker); otherwise the length is kept. */
  toEnd?: string,
): string {
  const s = toMin(moved.start);
  const kept = moved.end ? Math.max(15, toMin(moved.end) - s) : 60;
  const len = toEnd ? Math.max(15, toMin(toEnd) - toMin(toStart)) : kept;
  const was = new Set(findConflicts(items, { start: s, end: s + kept, ignoreId: moved.id, forTask: moved.forTask }).map((c) => c.item.id));
  const t = toMin(toStart);
  const now = findConflicts(items, { start: t, end: t + len, ignoreId: moved.id, forTask: moved.forTask }).filter((c) => !was.has(c.item.id));
  return conflictLine(now);
}
