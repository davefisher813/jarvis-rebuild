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

// THE RAMP IS A SUGGESTION, NOT A SECOND SET OF ROWS (2026-09-29, Dave: "Edit
// the warm up feature. It is way too complicated. It seems like it's on some
// automode but it's a huge pain to deal with.").
//
// The live session used to draw the whole ramp as dashed rows and count them
// off by HOW MANY warm-ups were logged. Log two of your own (180, 270) and the
// ramp's first two rows were "done" while its 160 and 225 stayed on screen,
// offering weights already passed. Now the ramp feeds ONE thing, the Now
// card's Warm-Up mode, and it is read against WHAT WAS LIFTED, not how many.

/** The next ramp step the athlete has not already gone past: the first one
 *  strictly heavier than the heaviest warm-up logged. Null when the ramp is
 *  off (an empty list), exhausted, or the athlete warmed up beyond it. */
export function nextRampStep(ramp: SetEntry[], logged: Pick<SetEntry, "w" | "warmup">[]): SetEntry | null {
  const heaviest = Math.max(0, ...logged.filter((s) => s.warmup).map((s) => s.w ?? 0));
  return ramp.find((r) => (r.w ?? 0) > heaviest) ?? null;
}

/** Does the Now card open in Warm-Up mode? Only before the first working set,
 *  and only while the ramp still has a step to offer. After a working set, or
 *  once the ramp is used up, it is Work mode, and one tap flips it either way. */
export function startsInWarmUp(ramp: SetEntry[], logged: Pick<SetEntry, "w" | "warmup" | "drop">[]): boolean {
  if (logged.some((s) => !s.warmup && !s.drop)) return false;
  return nextRampStep(ramp, logged) !== null;
}

/** What the Warm-Up side of the toggle opens at, in the order that is least
 *  surprising: the next ramp step; else what the last warm-up was (a repeat is
 *  one tap to change); else half the working weight on a rack the bar can
 *  build (never under the bar), or on the nearest `step` for a stack or a
 *  dumbbell. Always a starting point, never a prescription. */
export function warmupSeed(opts: {
  ramp: SetEntry[];
  logged: Pick<SetEntry, "w" | "r" | "warmup">[];
  /** The working weight the athlete is about to lift, if anything says. */
  work: number | null;
  /** True when the lift has a bar to start from (equipment.plateMath). */
  hasBar: boolean;
  rack: RackConfig;
  unit?: string;
  /** The weight field's own increment. */
  step: number;
}): { w?: number; r?: number } {
  const next = nextRampStep(opts.ramp, opts.logged);
  if (next) return { w: next.w, r: next.r };
  const lastWarm = [...opts.logged].reverse().find((s) => s.warmup && ((s.w ?? 0) > 0 || (s.r ?? 0) > 0));
  if (lastWarm) return { ...((lastWarm.w ?? 0) > 0 ? { w: lastWarm.w } : {}), ...((lastWarm.r ?? 0) > 0 ? { r: lastWarm.r } : {}) };
  const r = rackIn(opts.rack, opts.unit);
  const work = opts.work ?? 0;
  if (opts.hasBar) {
    const half = work > 0 ? floorToRack(work / 2, r) : r.bar;
    return { w: Math.max(r.bar, Math.round(half * 100) / 100), r: 8 };
  }
  if (work <= 0) return { r: 8 };
  const step = opts.step > 0 ? opts.step : 1;
  return { w: Math.max(step, Math.round(Math.floor(work / 2 / step + 1e-9) * step * 100) / 100), r: 8 };
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

/** H-29 (Health Push B, 2026-09-12): the nearest total this rack CAN build
 *  when it cannot build the one asked for. Lower wins a tie, because it is
 *  the number the athlete can load without guessing. Null with no plates. */
export function nearestBuildable(total: number, bar: number, plates: number[]): number | null {
  if (plates.length === 0) return null;
  // Every buildable total is the bar plus an even number of plates, so the
  // grid is 2x the smallest plate; walk it down and up from the nearest
  // gridline and take whichever lands first, lower on a tie.
  const step = Math.min(...plates) * 2;
  const r4 = (x: number) => Number(x.toFixed(4));
  const ok = (t: number) => {
    if (t <= bar) return t === bar;
    const per = platesPerSide(t, bar, plates);
    return per != null && per.length > 0;
  };
  const base = r4(bar + Math.floor((total - bar) / step) * step);
  let lo: number | null = null;
  for (let k = 0; k <= 200; k++) { const t = r4(base - k * step); if (t < bar) break; if (ok(t)) { lo = t; break; } }
  let hi: number | null = null;
  for (let k = 1; k <= 200; k++) { const t = r4(base + k * step); if (ok(t)) { hi = t; break; } }
  if (lo == null) return hi;
  if (hi == null) return lo;
  return total - lo <= hi - total ? lo : hi;
}

export type PlateFacts =
  | { kind: "plates"; per: number[] }
  | { kind: "none"; at: number; nearest: number | null };

/** What the chip says about the bar: the plates per side, or that the rack
 *  cannot build this number and the nearest it can (H-29). Null when there is
 *  nothing on the bar to say. `at` and `nearest` are in the exercise's own
 *  unit, the one the athlete typed. */
export function plateFacts(total: number, rack: RackConfig, unit?: string, bar = rack.bar): PlateFacts | null {
  // `bar` is what to subtract before halving, and it is NOT always the rack's
  // (2026-09-16). A Smith carriage and a plate-loaded machine both load real
  // plates and neither has a 45 to take off first -- equipment.ts has said so
  // since it was written (plates: true, hasBar: false) and this function was
  // subtracting the barbell's bar from them anyway, which put every machine's
  // plate count out by a bar's worth. Callers pass what their own equipment
  // has; the default keeps the barbell's behaviour for callers that do not.
  const w = weightIn(total, unit, rack.unit);
  if (w <= bar) return null;
  const per = platesPerSide(w, bar, rack.plates);
  if (per) return per.length ? { kind: "plates", per } : null;
  const near = nearestBuildable(w, bar, rack.plates);
  return { kind: "none", at: total, nearest: near == null ? null : weightIn(near, rack.unit, unit) };
}
