import type { Exercise, SetEntry } from "./types";
import { newSetId } from "./strip";

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

export interface RackConfig { bar: number; plates: number[] }

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
  ex: Pick<Exercise, "kind" | "sets">,
  rack: RackConfig = { bar: DEFAULT_BAR, plates: DEFAULT_PLATES },
): SetEntry[] {
  const work = workingWeight(ex);
  if (work === null || work <= rack.bar) return [];
  const out: SetEntry[] = [];
  let last = -1;
  for (const s of RAMP_STEPS) {
    const w = s.pct === 0 ? rack.bar : floorToRack(work * s.pct, rack);
    // Never repeat a step, never go under the bar, and never approach at or
    // above the work itself.
    if (w >= work || w <= last || w < rack.bar) continue;
    out.push({ id: newSetId(), w, r: s.reps, warmup: true });
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

/** "45 · 45 · 25" for the chip, or null when there is nothing honest to say. */
export function plateLine(total: number, bar: number, plates: number[]): string | null {
  const per = platesPerSide(total, bar, plates);
  return per && per.length ? per.join(" · ") : null;
}
