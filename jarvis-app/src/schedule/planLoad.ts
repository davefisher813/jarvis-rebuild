import type { EventItem } from "./types";
import type { PlanBlock } from "./planDay";
import type { PlanBlocked } from "./screens/PlanDaySheet";
import { isFocusRange } from "../routine/types";

// THE LOAD (P2/P3, Dave 2026-08-20: "look at how limited this still is").
//
// Nothing on the planning sheet ever said how full the day was. You could
// pick six things into four open hours and only find out afterwards, when the
// losers appeared in a grey line at the very bottom saying "No room today".
// That is the app knowing something and telling you last.
//
// This derives it up front, from the same inputs the planner itself used, so
// the number on screen can never disagree with the plan underneath it.
//
// Laws:
//   - Focus zones are OPEN time, not busy time. A Deep Work block is where
//     picks are supposed to go; counting it as busy would say the day is full
//     precisely when it is most available.
//   - Soft blocks (meals) count as open. The planner only breaks them when it
//     has to, and saying "you have no time" because dinner exists is a lie.
//   - Over is measured against what the planner COULD NOT place, not against
//     raw arithmetic. A day with a 90-minute gap and a 90-minute task fits
//     even when the totals look tight.

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

export interface DayLoad {
  openMin: number;      // minutes genuinely free in the planning window
  pickedMin: number;    // minutes the current picks take
  unplaced: number;     // picks the planner could not fit at all
  overMin: number;      // how far past open the picks reach, 0 when they fit
  fits: boolean;
}

function merge(ranges: { s: number; e: number }[]): { s: number; e: number }[] {
  const sorted = [...ranges].filter((r) => r.e > r.s).sort((a, b) => a.s - b.s);
  const out: { s: number; e: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.s <= last.e) last.e = Math.max(last.e, r.e);
    else out.push({ ...r });
  }
  return out;
}

// Free minutes between startMin and endMin once fixed events and HARD
// protected time are removed. Focus and soft blocks stay open on purpose.
export function openMinutes(
  events: EventItem[],
  blocked: PlanBlocked[],
  startMin: number,
  endMin: number,
): number {
  const span = Math.max(0, endMin - startMin);
  if (span === 0) return 0;
  const busy = merge([
    ...events.map((e) => ({
      s: toMin(e.data.start),
      e: e.data.end ? toMin(e.data.end) : toMin(e.data.start) + 60,
    })),
    ...blocked.filter((b) => !isFocusRange(b) && !b.soft).map((b) => ({ s: b.s, e: b.e })),
  ]);
  let taken = 0;
  for (const b of busy) {
    const s = Math.max(startMin, b.s);
    const e = Math.min(endMin, b.e);
    if (e > s) taken += e - s;
  }
  return Math.max(0, span - taken);
}

export function loadOf(
  blocks: PlanBlock[],
  unplaced: { durationMin: number }[],
  openMin: number,
): DayLoad {
  const pickedMin = blocks.reduce((n, b) => n + (toMin(b.end) - toMin(b.start)), 0);
  const spill = unplaced.reduce((n, t) => n + t.durationMin, 0);
  // Over is what did not fit, plus anything the placed blocks pushed past the
  // open total. Unplaced is the honest signal; the arithmetic is the backstop.
  const overMin = spill > 0 ? spill : Math.max(0, pickedMin - openMin);
  return { openMin, pickedMin, unplaced: unplaced.length, overMin, fits: overMin === 0 };
}

export function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// The line under the strip. Never says "you have no time" when the day is
// simply unplanned; an empty pick set gets the open number and nothing else.
export function loadLine(load: DayLoad, picked: number): string {
  const open = hhmm(load.openMin) + " open";
  if (picked === 0) return open;
  if (load.fits) return `${open} · ${picked} picked, fits`;
  return `${open} · ${hhmm(load.overMin)} over`;
}

// Which picks to let go of, when the day says no. The LAST ones picked, never
// the first: pick order is priority order everywhere else in this sheet, and
// dropping someone's top choice to make the arithmetic work is the app
// deciding what matters. Returns the ids, fewest first.
export function dropToFit(
  picks: string[],
  durOf: (id: string) => number,
  overMin: number,
): string[] {
  if (overMin <= 0) return [];
  const out: string[] = [];
  let freed = 0;
  for (let i = picks.length - 1; i >= 0 && freed < overMin; i--) {
    const id = picks[i]!;
    out.unshift(id);
    freed += durOf(id);
  }
  return out;
}

// Worded to keep the count out of the leading slot. "2 Of These Won't Fit"
// is what the number-lead rule would produce, and it reads like a ransom
// note; putting the count second says the same thing in English.
export function dropLine(n: number): string {
  return n === 1 ? "One of These Won't Fit" : `These ${n} Won't Fit`;
}

// PLAN IT FOR ME (P1). The sheet's old AI button only estimated LENGTHS for
// tasks already picked by hand, and the picking is the hard part. This is the
// selection step: take the ranked candidates and fill the open time, stopping
// at whatever cap the day carries.
//
// Deterministic and pure. The AI, when it is available, then reorders and
// re-sizes what this chose; when it is not, this alone is a real plan.
//
// Laws:
//   - Rank order is respected absolutely. This fills the day, it does not
//     re-decide what matters.
//   - It stops at the open time, never past it. A one-tap plan that does not
//     fit is the same broken promise the sheet already made.
//   - It always returns at least one task when one exists. "I planned nothing
//     for you" is not an answer to "plan it for me".
export function autoSelect(
  ranked: { id: string }[],
  openMin: number,
  durOf: (id: string) => number,
  cap: number | null,
): string[] {
  const out: string[] = [];
  let used = 0;
  for (const t of ranked) {
    if (cap != null && out.length >= cap) break;
    const d = durOf(t.id);
    if (out.length > 0 && used + d > openMin) continue; // try the next, shorter one
    out.push(t.id);
    used += d;
    if (used >= openMin) break;
  }
  return out;
}
