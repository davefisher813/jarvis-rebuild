import type { CondBlock, ProgramDay, Exercise, Workout, WorkoutExercise } from "./types";
import type { RackConfig } from "./ramp";
import { rampFor } from "./ramp";
import { paceFor, WORK_SEC, REST_FLOOR_SEC, DEFAULT_REST_SEC, RAMP_SEC_PER_SET } from "./pacing";
import { groupOf } from "./groups";

/** UP-ATH-17 (2026-09-06): in a group of two or more, so trimming it would
 *  break the alternation. Reads a legacy pairWith as a group of two. */
function isGrouped(ex: Exercise, exercises: Exercise[]): boolean {
  return groupOf(ex, exercises).length > 1;
}

// TIME-BOXED SESSIONS, D5-C (Training Catalog V2, approved 2026-08-31).
// Dave: "If I want to do a lift that normally takes an hour in 30 min it can
// suggest removing the cool down and doing less sets... make the user aware
// and make it VERY easy to make adjustments on the fly."
//
// Fitbod fits time by silently adding or dropping exercises. Ours fits with
// ORDERED LEVERS, every one a visible switch the athlete can flip back:
// shorten rests toward a floor, superset the pairs, trim last sets of
// accessories (never the top set of the main lift), drop the cool-down.
// The engine PRICES; only the athlete's own tap ever applies a lever, and
// nothing here writes to the program -- a fit is a stance for one session.

/** The athlete's choices for one session. Lives on LiveSession; the program
 *  is never touched (LAW 17). `trims` is per-exercise so the catch-up
 *  banner can trim ONE lift without dragging the whole toggle along. */
export interface FitPlan {
  budgetMin?: number;
  restCut?: boolean;
  superset?: boolean;
  skipCool?: boolean;
  trims?: Record<string, number>;
}

export const REST_CUT_SEC = 30;

function effRest(ex: Pick<Exercise, "restSec">, restCut: boolean | undefined): number {
  const stated = ex.restSec ?? DEFAULT_REST_SEC;
  // The cut only touches a REST THAT EXISTS: an exercise with no stated
  // rest has no timer to shorten, so a "cut" there would be a lever wired
  // to nothing -- the estimate would move and the session would not.
  return restCut && ex.restSec != null ? Math.max(REST_FLOOR_SEC, stated - REST_CUT_SEC) : stated;
}

/** Seconds one set costs under this plan. A learned pace is cut directly
 *  (its rest lives inside the measurement); a default is cut at its stated
 *  rest. Neither ever drops below work + the rest floor. */
export function perSetSec(history: Workout[], ex: Pick<Exercise, "name" | "kind" | "restSec">, restCut?: boolean): number {
  const pace = paceFor(history, ex);
  if (pace.learned) {
    return restCut && ex.restSec != null ? Math.max(WORK_SEC + REST_FLOOR_SEC, pace.secPerSet - REST_CUT_SEC) : pace.secPerSet;
  }
  return WORK_SEC + effRest(ex, restCut);
}

/** Non-filler groups in a day, each counted once, in day order.
 *
 *  UP-ATH-17 (2026-09-06): this was pairsIn and returned exactly two. A
 *  circuit shares its rest the same way a pair does, so the superset saving
 *  is priced across whatever the group actually holds. A pair is a group of
 *  two and prices identically to before. */
export function groupsIn(day: Pick<ProgramDay, "exercises">): Exercise[][] {
  const out: Exercise[][] = [];
  const seen = new Set<string>();
  for (const a of day.exercises) {
    if (a.filler || seen.has(a.id)) continue;
    const members = groupOf(a, day.exercises).filter((e) => !e.filler);
    if (members.length < 2) continue;
    for (const m of members) seen.add(m.id);
    out.push(members);
  }
  return out;
}

/** The exercises the trim lever may touch: unpaired accessories with three
 *  or more sets. NEVER the day's first exercise -- "never the top set of
 *  your main lift" is the catalog's own words -- and never a pair (trimming
 *  one side breaks the alternation) or a filler (its sets ride inside rest,
 *  there is nothing to save). */
export function trimTargets(day: Pick<ProgramDay, "exercises">): Record<string, number> {
  const out: Record<string, number> = {};
  day.exercises.forEach((ex, i) => {
    if (i === 0 || ex.filler || isGrouped(ex, day.exercises)) return;
    if (ex.sets.length >= 3) out[ex.id] = 1;
  });
  return out;
}

export interface DayEstimate {
  min: number;
  /** Exercises priced from a learned pace vs priced at all -- the honesty
   *  line ("learned from your last N sessions") keys off this. Conditioning
   *  blocks are in neither: they are priced from their own stated clock, not
   *  from any pace. */
  learnedCount: number;
  liftCount: number;
  /** GYM-F-07 (2026-09-05): conditioning blocks in this day, and how many of
   *  those are For Time. A For Time cap is the ceiling the clock stops at,
   *  not a forecast of the work, so the honesty line says so rather than
   *  passing it off as an estimate. */
  condCount: number;
  cappedCount: number;
}

/**
 * What this day costs in seconds under a plan. Fillers cost nothing (their
 * sets ride inside the partner's rest -- that is their whole definition).
 * Warm-up and cool-down blocks cost exactly their STATED minutes: blocks
 * without minutes contribute zero rather than an invented number.
 */
export function estimateDaySec(day: ProgramDay, history: Workout[], rack: RackConfig, plan: FitPlan = {}): number {
  let sec = 0;
  for (const ex of day.exercises) {
    if (ex.filler) continue;
    // GYM-F-07 (2026-09-05): a conditioning block is a clock, not a strip, and
    // is saved with `sets: []` (ExerciseSheet.tsx:177). Pricing this day by
    // set count alone billed a 20 minute AMRAP at zero, so the fit sheet read
    // "Cond · Plan 0 Min", "Fits: 0 min" and "Start · 0 Min", and a mixed day
    // with a 12 minute EMOM after three lifts was 12 minutes short all
    // session. The block's own cap is what it costs.
    if (ex.cond) { sec += ex.cond.capSec; continue; }
    const trimmed = Math.max(0, ex.sets.length - (plan.trims?.[ex.id] ?? 0));
    sec += trimmed * perSetSec(history, ex, plan.restCut);
    if (ex.ramp) sec += rampFor(ex, rack).length * RAMP_SEC_PER_SET;
  }
  if (plan.superset) {
    // Alternating a group shares the rest: one rest per round instead of one
    // per member. Priced from stated rests -- the saving is an estimate and
    // says so. UP-ATH-17: a group of three saves two rests a round, not one.
    for (const g of groupsIn(day)) {
      const rounds = Math.min(...g.map((x) => Math.max(0, x.sets.length - (plan.trims?.[x.id] ?? 0))));
      const rest = Math.min(...g.map((x) => effRest(x, plan.restCut)));
      sec -= rounds * rest * (g.length - 1);
    }
  }
  if (day.warmUp?.length) sec += (day.warmUpMin ?? 0) * 60;
  if (day.coolDown?.length && !plan.skipCool) sec += (day.coolDownMin ?? 0) * 60;
  return Math.max(0, sec);
}

export function estimateDay(day: ProgramDay, history: Workout[], rack: RackConfig, plan: FitPlan = {}): DayEstimate {
  const sec = estimateDaySec(day, history, rack, plan);
  let learnedCount = 0;
  let liftCount = 0;
  let condCount = 0;
  let cappedCount = 0;
  for (const ex of day.exercises) {
    if (ex.filler) continue;
    if (ex.cond) {
      condCount++;
      if (ex.cond.format === "for_time") cappedCount++;
      continue;
    }
    liftCount++;
    if (paceFor(history, ex).learned) learnedCount++;
  }
  return { min: sec === 0 ? 0 : Math.max(10, Math.round(sec / 60)), learnedCount, liftCount, condCount, cappedCount };
}

export type LeverKey = "restCut" | "superset" | "trim" | "skipCool";

export interface LeverOffer {
  key: LeverKey;
  name: string;
  sub: string;
  on: boolean;
  saveMin: number;
}

/**
 * The fit sheet's levers, in the catalog's fixed order, only the ones this
 * day actually has. Each shows its MARGINAL saving against the other levers
 * as currently set, so the numbers stay true as switches flip.
 */
export function leverOffers(day: ProgramDay, history: Workout[], rack: RackConfig, plan: FitPlan): LeverOffer[] {
  const offers: LeverOffer[] = [];
  const saveOf = (on: FitPlan, off: FitPlan) =>
    Math.max(0, Math.round((estimateDaySec(day, history, rack, off) - estimateDaySec(day, history, rack, on)) / 60));

  // 1. Shorter rests, toward the floor.
  {
    const save = saveOf({ ...plan, restCut: true }, { ...plan, restCut: false });
    if (save >= 1) {
      const rests = day.exercises.filter((e) => !e.filler && e.restSec != null).map((e) => e.restSec!);
      const uniform = rests.length > 0 && rests.every((r) => r === rests[0]);
      const name = uniform ? `Rests ${rests[0]} → ${Math.max(REST_FLOOR_SEC, rests[0]! - REST_CUT_SEC)}s` : "Shorter rests";
      offers.push({ key: "restCut", name, sub: `saves ~${save} min`, on: !!plan.restCut, saveMin: save });
    }
  }
  // 2. Superset the pairs.
  {
    const pairs = groupsIn(day);
    const save = saveOf({ ...plan, superset: true }, { ...plan, superset: false });
    if (pairs.length > 0 && save >= 1) {
      const name = pairs.length === 1 ? `Superset ${pairs[0]!.map((x) => x.name).join(" + ")}` : "Superset the groups";
      offers.push({ key: "superset", name, sub: `saves ~${save} min`, on: !!plan.superset, saveMin: save });
    }
  }
  // 3. Trim last sets of accessories. Never the main lift.
  {
    const targets = trimTargets(day);
    const ids = Object.keys(targets);
    if (ids.length > 0) {
      const save = saveOf({ ...plan, trims: targets }, { ...plan, trims: {} });
      if (save >= 1) {
        const one = ids.length === 1 ? day.exercises.find((e) => e.id === ids[0]) : null;
        const name = one ? `${one.name} ${one.sets.length} → ${one.sets.length - 1} sets` : "Trim last accessory sets";
        offers.push({
          key: "trim", name,
          sub: `saves ~${save} min · never your main lift`,
          on: Object.keys(plan.trims ?? {}).length > 0, saveMin: save,
        });
      }
    }
  }
  // 4. Skip the cool-down. Stated minutes, so no tilde.
  {
    const coolMin = day.coolDown?.length ? (day.coolDownMin ?? 0) : 0;
    if (coolMin > 0) {
      offers.push({ key: "skipCool", name: "Skip the cool-down", sub: `saves ${coolMin} min`, on: !!plan.skipCool, saveMin: coolMin });
    }
  }
  return offers;
}

/** The slice of the live session the projection reads. Matches LiveSession
 *  structurally; typed here so fit.ts stays a pure engine. */
export interface LiveFitState {
  startedAt: number;
  exercises: WorkoutExercise[];
  budgetMin?: number;
  restCut?: boolean;
  superset?: boolean;
  skipCool?: boolean;
  trims?: Record<string, number>;
  warmDone?: string[];
  warmSkipped?: boolean;
  coolDone?: string[];
  coolSkipped?: boolean;
}

function planFor(live: LiveFitState, e: WorkoutExercise, day: ProgramDay | null): { planned: number; ex: Pick<Exercise, "name" | "kind" | "restSec">; ramp: Exercise | null; cond: CondBlock | null } {
  const pe = !e.custom && day ? day.exercises.find((x) => x.id === e.exerciseId) : undefined;
  if (pe) {
    return {
      planned: Math.max(0, pe.sets.length - (live.trims?.[pe.id] ?? 0)),
      ex: pe,
      ramp: pe.ramp ? pe : null,
      cond: pe.cond ?? null,
    };
  }
  // Swapped or added mid-session: its plan strip is the whole story, plus
  // whatever program-side shape it carries with it (GYM-F-21) -- an added
  // AMRAP costs its cap and an added lift's stated rest is real rest.
  return { planned: (e.plan ?? []).length, ex: { name: e.name, kind: e.kind, restSec: e.program?.restSec }, ramp: null, cond: e.program?.cond ?? null };
}

/**
 * D5-C: "the session header shows projected finish against your budget the
 * whole time." Remaining work is priced exactly like the pre-start estimate
 * -- learned pace or named default -- from what is actually left: sets not
 * yet logged, ramps not yet climbed, blocks not yet checked off.
 */
export function projectFinishMs(live: LiveFitState, day: ProgramDay | null, history: Workout[], rack: RackConfig, now: number = Date.now()): number {
  let sec = 0;
  let anyLogged = false;
  for (const e of live.exercises) {
    if (e.skipped) continue;
    const workLogged = e.sets.filter((s) => !s.warmup && !s.skipped).length;
    if (e.sets.length > 0) anyLogged = true;
    const { planned, ex, ramp, cond } = planFor(live, e, day);
    // GYM-F-07 (2026-09-05): a clock that has not been run yet still costs its
    // whole cap; once an attempt is logged the block has happened and costs
    // nothing more. Without this the projected finish and the catch-up banner
    // ran a whole conditioning block short for the entire session.
    if (cond) {
      if (e.sets.length === 0) sec += cond.capSec;
      continue;
    }
    sec += Math.max(0, planned - workLogged) * perSetSec(history, ex, live.restCut);
    if (ramp) {
      const rampLogged = e.sets.filter((s) => s.warmup).length;
      sec += Math.max(0, rampFor(ramp, rack).length - rampLogged) * RAMP_SEC_PER_SET;
    }
  }
  if (live.superset && day) {
    for (const g of groupsIn(day)) {
      const remOf = (x: Exercise) => {
        const le = live.exercises.find((e) => e.exerciseId === x.id && !e.custom);
        if (!le || le.skipped) return 0;
        const logged = le.sets.filter((s) => !s.warmup && !s.skipped).length;
        return Math.max(0, Math.max(0, x.sets.length - (live.trims?.[x.id] ?? 0)) - logged);
      };
      const rounds = Math.min(...g.map(remOf));
      const rest = Math.min(...g.map((x) => effRest(x, live.restCut)));
      sec -= rounds * rest * (g.length - 1);
    }
  }
  if (day?.warmUp?.length && !live.warmSkipped && !anyLogged) {
    const doneAll = day.warmUp.every((b) => live.warmDone?.includes(b.id));
    if (!doneAll) sec += (day.warmUpMin ?? 0) * 60;
  }
  if (day?.coolDown?.length && !live.skipCool && !live.coolSkipped) {
    const doneAll = day.coolDown.every((b) => live.coolDone?.includes(b.id));
    if (!doneAll) sec += (day.coolDownMin ?? 0) * 60;
  }
  return now + Math.max(0, sec) * 1000;
}

/** Whole minutes over budget at the projected finish. 0 or less = on pace.
 *  No budget, no opinion: null. */
export function overBudgetMin(live: LiveFitState, day: ProgramDay | null, history: Workout[], rack: RackConfig, now: number = Date.now()): number | null {
  if (!live.budgetMin) return null;
  const finish = projectFinishMs(live, day, history, rack, now);
  return Math.ceil((finish - (live.startedAt + live.budgetMin * 60_000)) / 60_000);
}

export type NextLever =
  | { key: "restCut" }
  | { key: "trim"; exerciseId: string; name: string }
  | { key: "skipCool" }
  | null;

/**
 * The catch-up banner's one offer, in the catalog's order: rests first,
 * then a trim, then the cool-down. Supersets are never offered here -- the
 * pair row already does that job in the flow. Each lever is offered only
 * while it can still save something real.
 */
export function nextLever(live: LiveFitState, day: ProgramDay | null, _history: Workout[]): NextLever {
  if (!day) return null;
  if (!live.restCut && day.exercises.some((e) => !e.filler && e.restSec != null && e.restSec > REST_FLOOR_SEC)) {
    return { key: "restCut" };
  }
  // The LAST still-trimmable accessory, so the sacrifice lands late in the
  // day ("trim a curl set"), never on what the athlete came to do.
  for (let i = day.exercises.length - 1; i >= 1; i--) {
    const ex = day.exercises[i]!;
    if (ex.filler || isGrouped(ex, day.exercises)) continue;
    const trimmed = live.trims?.[ex.id] ?? 0;
    const planned = ex.sets.length - trimmed;
    if (ex.sets.length < 3 || planned <= 2) continue;
    const le = live.exercises.find((e) => e.exerciseId === ex.id && !e.custom);
    if (le?.skipped) continue;
    const logged = le ? le.sets.filter((s) => !s.warmup && !s.skipped).length : 0;
    if (logged >= planned) continue; // its last set already happened; nothing to save
    return { key: "trim", exerciseId: ex.id, name: ex.name };
  }
  const coolMin = day.coolDown?.length ? (day.coolDownMin ?? 0) : 0;
  if (coolMin > 0 && !live.skipCool && !live.coolSkipped) return { key: "skipCool" };
  return null;
}
