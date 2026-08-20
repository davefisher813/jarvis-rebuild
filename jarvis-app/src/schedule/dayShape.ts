// PLAN IT LIKE A DAY THAT WORKED (P12, Dave 2026-08-20).
//
// The hard part of planning is not the tasks, it is the rhythm: how long the
// blocks were, what order they went in, when the heavy one sat. A day that
// went well already knows all of that. This copies the SHAPE and pours
// today's tasks into it.
//
// It copies rhythm, never content. Re-running last Tuesday's actual tasks
// would be nonsense; re-running last Tuesday's pace is the whole point.
//
// Laws:
//   - "Worked" means measured, never assumed: a shape is only offered as one
//     that worked when its own plan.outcome events say every pick landed. A
//     day we cannot score is offered by its weekday and named as such.
//   - Shapes are recorded at COMMIT, from the blocks that actually committed,
//     so the stored rhythm is the one he chose, not the one we proposed.

import { capAfterNumber } from "../shared/casing";

const KEY = "jarvis.plan.shapes.v1";
const CAP = 30;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ShapeSlot { startMin: number; min: number }
export interface DayShape {
  day: string;         // YYYY-MM-DD the plan was for
  dow: number;         // 0=Sun
  slots: ShapeSlot[];  // start + length, in the order they ran
}

export interface ShapeOffer {
  shape: DayShape;
  title: string;
  sub: string;
  worked: boolean;
}

export function loadShapes(storage: Pick<Storage, "getItem"> = localStorage): DayShape[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is DayShape =>
      !!s && typeof (s as DayShape).day === "string" && Array.isArray((s as DayShape).slots));
  } catch {
    return [];
  }
}

export function saveShape(shape: DayShape, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  if (shape.slots.length === 0) return;
  const next = [...loadShapes(storage).filter((s) => s.day !== shape.day), shape].slice(-CAP);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

// Per-day scores from the outcome log. A day whose events carry no `day` prop
// (recorded before 2026-08-20) is simply absent: unscoreable, never zero.
export function dayScores(
  events: { type: string; props?: Record<string, unknown> }[],
): Record<string, { picks: number; done: number }> {
  const out: Record<string, { picks: number; done: number }> = {};
  for (const e of events) {
    if (e.type !== "plan.outcome") continue;
    const day = e.props?.day;
    if (typeof day !== "string") continue;
    const row = out[day] ?? { picks: 0, done: 0 };
    row.picks++;
    if (e.props?.flag === true) row.done++;
    out[day] = row;
  }
  return out;
}

// How many distinct plans the record covers, so a finish rate can be per-day
// rather than per-pick.
export function planCount(events: { type: string; props?: Record<string, unknown> }[]): number {
  return Object.keys(dayScores(events)).length;
}

// The best shape to offer for a target weekday. A fully-done day wins, most
// recent first; otherwise the most recent shape for the same weekday; and if
// he has never planned that weekday, nothing at all. Silence beats offering
// him a Sunday rhythm for a Wednesday.
export function shapeOffer(
  shapes: DayShape[],
  targetDow: number,
  targetDay: string,
  scores: Record<string, { picks: number; done: number }>,
): ShapeOffer | null {
  const past = shapes.filter((s) => s.day < targetDay && s.slots.length > 0);
  if (past.length === 0) return null;
  const newest = (a: DayShape, b: DayShape) => b.day.localeCompare(a.day);

  const worked = past
    .filter((s) => {
      const sc = scores[s.day];
      return !!sc && sc.picks > 0 && sc.done === sc.picks;
    })
    .sort(newest)[0];
  if (worked) {
    return {
      shape: worked,
      title: `Plan It Like ${DOW[worked.dow] ?? "That Day"}`,
      sub: capAfterNumber(`${worked.slots.length} blocks · Everything got done`),
      worked: true,
    };
  }

  const sameDow = past.filter((s) => s.dow === targetDow).sort(newest)[0];
  if (!sameDow) return null;
  return {
    shape: sameDow,
    title: `Same Shape as Last ${DOW[sameDow.dow] ?? "Time"}`,
    sub: capAfterNumber(`${sameDow.slots.length} blocks · Same lengths, same order`),
    worked: false,
  };
}

// Pour picks into a shape: the nth pick takes the nth slot's start and
// length. Extra picks past the shape's slot count keep their own length and
// auto-place; extra slots are simply unused. Returns the overrides and
// durations the sheet already understands, so this feature adds no new
// placement path (and inherits every guard the existing one has).
export function applyShape(
  shape: DayShape,
  picks: string[],
  windowStartMin: number,
  windowEndMin: number,
): { overrides: Record<string, string>; durations: Record<string, number> } {
  const overrides: Record<string, string> = {};
  const durations: Record<string, number> = {};
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  picks.forEach((id, i) => {
    const slot = shape.slots[i];
    if (!slot) return;
    // A shape from a longer day must not push a block past this day's window.
    const start = Math.max(windowStartMin, Math.min(windowEndMin - slot.min, slot.startMin));
    if (start < windowStartMin || start + slot.min > windowEndMin) return;
    overrides[id] = fmt(start);
    durations[id] = slot.min;
  });
  return { overrides, durations };
}
