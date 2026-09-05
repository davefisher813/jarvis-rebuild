import type { Exercise, SetEntry } from "./types";
import { newSetId } from "./strip";
import { LB_PER_KG } from "./measures";

// THE RAMP AND THE PLATES (D3-A and D8-A, Training Catalog V2, approved
// 2026-08-31).
//
// Two derivations that share one fact: what the bar can actually be loaded
// to. Nothing here is ever stored in a program -- the plan is the working
// sets, and a ramp is computed from them, so changing the working weight
// re-ramps for free and an edited plan can never disagree with its warm-up.

/** The plates a normal rack has, heaviest first (lb). Overridable in
 *  Settings -> Training once the athlete says otherwise. */
export const DEFAULT_PLATES = [45, 35, 25, 10, 5, 2.5];
export const DEFAULT_BAR = 45;

export interface RackConfig {
  bar: number;
  plates: number[];
  /** GYM-F-19 (2026-09-05): the unit the rack's own numbers are in. S5-Q32
   *  made the bar a bare number with no unit at all, so a kg lifter on the
   *  default rack got "45 kg x 10" out of the ramp (the 45 is the lb bar) and
   *  never saw plate math at all, because SetStrip suppressed it for kg. A
   *  rack is physical; naming its unit is what lets both features be right
   *  for a lifter whose exercises are not all in it. Absent means pounds,
   *  which is what every stored rack was. */
  unit?: string;
}

/** A weight moved between units. Pounds are the pivot, same constant every
 *  comparison in the gym uses (GYM-F-06). */
export function weightIn(n: number, from: string | undefined, to: string | undefined): number {
  const f = from ?? "lb", t = to ?? "lb";
  if (f === t) return n;
  const lb = f === "kg" ? n * LB_PER_KG : n;
  return Math.round((t === "kg" ? lb / LB_PER_KG : lb) * 100) / 100;
}

/** The same physical rack, its numbers read in `unit`. What a lb bar can be
 *  loaded to does not change because the athlete thinks in kg; only the
 *  numbers they read do. */
export function rackIn(rack: RackConfig, unit?: string): RackConfig {
  const from = rack.unit ?? "lb";
  const to = unit ?? from;
  if (from === to) return rack;
  return { bar: weightIn(rack.bar, from, to), plates: rack.plates.map((p) => weightIn(p, from, to)), unit: to };
}

/** The smallest jump the rack can make above the bar: two of the lightest
 *  plate. Everything rounds to this so no ramp asks for a weight that
 *  cannot be built. */
const step = (rack: RackConfig): number => 2 * Math.min(...rack.plates);

/** Round DOWN to something the rack can build. Down, not nearest: a warm-up
 *  that creeps heavier than intended is the one rounding error that costs
 *  something. */
function floorToRack(weight: number, rack: RackConfig): number {
  const s = step(rack);
  return rack.bar + Math.floor((weight - rack.bar) / s + 1e-9) * s;
}

/** The first weight the athlete actually plans to work at: the first chip
 *  that is neither skipped nor empty. */
function workingWeight(ex: Pick<Exercise, "kind" | "sets">): number | null {
  if (ex.kind !== "weight_reps") return null; // only a bar has a ramp
  for (const s of ex.sets) {
    if (s.skipped) continue;
    if ((s.w ?? 0) > 0) return s.w!;
  }
  return null;
}

// The convention every lifting guide teaches, and the one Boostcamp's
// warm-up guide writes down: the bar for movement, then roughly 40%, 60%
// and 85% OF THE WORKING WEIGHT, dropping reps as the weight climbs. A
// starting point the athlete edits, never a prescription.
const RAMP_STEPS: { pct: number; reps: number }[] = [
  { pct: 0, reps: 10 },     // the bar itself
  { pct: 0.4, reps: 8 },
  { pct: 0.6, reps: 5 },
  { pct: 0.85, reps: 3 },
];

/**
 * The warm-up sets for one exercise, or an empty list when it has nothing to
 * ramp (no weight, no plan yet, or a working weight the bar already meets).
 * Every set is marked `warmup`, which is what keeps it out of PRs, volume
 * and the uniformity read.
 */
export function rampFor(
  ex: Pick<Exercise, "kind" | "sets" | "unit">,
  rack: RackConfig = { bar: DEFAULT_BAR, plates: DEFAULT_PLATES },
): SetEntry[] {
  // GYM-F-19 (2026-09-05): the rack is read in the EXERCISE's unit before
  // anything is computed, so a kg lifter no longer gets the pound bar's number
  // with a kg label glued to it. Where the two agree this is a no-op, which is
  // every lifter whose rack matches their lifts.
  const r = rackIn(rack, ex.unit);
  const work = workingWeight(ex);
  if (work === null || work <= r.bar) return [];
  const out: SetEntry[] = [];
  let last = -1;
  for (const s of RAMP_STEPS) {
    const w = s.pct === 0 ? r.bar : floorToRack(work * s.pct, r);
    // Never repeat a step, never go under the bar, and never approach at or
    // above the work itself.
    if (w >= work || w <= last || w < r.bar) continue;
    out.push({ id: newSetId(), w: Math.round(w * 100) / 100, r: s.reps, warmup: true });
    last = w;
  }
  return out;
}

/**
 * PLATE MATH (D8-A). What goes on ONE side to reach `total`, heaviest first.
 * Null when this rack cannot build that number exactly -- a wrong plate list
 * is worse than no plate list, so it says nothing rather than rounding the
 * athlete's own logged weight for them.
 */
export function platesPerSide(total: number, bar: number, plates: number[]): number[] | null {
  let side = (total - bar) / 2;
  if (side <= 0) return null;
  const out: number[] = [];
  for (const p of [...plates].sort((a, b) => b - a)) {
    while (side >= p - 1e-9) { out.push(p); side = Number((side - p).toFixed(4)); }
  }
  return side > 1e-9 ? null : out;
}

/**
 * "45 · 45 · 25" for the chip, or null when there is nothing honest to say.
 *
 * GYM-F-19 (2026-09-05): `total` is in `unit` (the exercise's), the rack is in
 * its own, and the plates named are the rack's OWN numbers, because those are
 * the discs the athlete picks up. A kg lifter with a kg rack sees kg plates;
 * SetStrip used to suppress plate math for kg outright, which is why a lifter
 * who had set a 20 kg bar and kg plates still never saw it.
 */
export function plateLine(total: number, rack: RackConfig, unit?: string): string | null {
  const per = platesPerSide(weightIn(total, unit, rack.unit), rack.bar, rack.plates);
  return per && per.length ? per.join(" · ") : null;
}
