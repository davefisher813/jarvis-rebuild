import type { Exercise, SetEntry, SetLog, Workout } from "./types";
import { fieldsFor, inUnit } from "./measures";
import { liftRef, sameLift } from "./identity";
import { lineCase } from "../shared/casing";

// THE PROGRESSION ENGINE (D6-A, Training Catalog V2, approved 2026-08-31;
// REWRITTEN 2026-10-17, section 10, PROGRESSIVE OVERLOAD).
//
// The old engine took the heaviest set of the last session and bumped it, so
// a 275 x 5 prescription opened at 255 x 1 and suggested 300 x 1. It is ONE
// published rule now, autoregulated double progression, and every suggestion
// says which of the lifter's own sets it read:
//
//   1. WORK INSIDE THE PLAN'S REP RANGE. Low to high from the plan's set
//      prescription; a single rep target is the top and top minus two the
//      bottom (never under one). Hold the load and add reps while any work
//      set at that load is below the top.
//   2. STEP WHEN EVERY SET IS AT THE TOP. About 2.5 percent, capped at 5,
//      rounded to the smallest jump the equipment can make (two of the
//      smallest plate on a bar, the stack's step on a machine, 2.5 by
//      default), and the target reps reset to the bottom of the range. When
//      the smallest jump is more than 7 percent of the load, the range top
//      grows by three reps instead.
//   3. TWO STRIKES. One missed session (a work set under the range bottom)
//      repeats the same prescription; two in a row cut the load 5 percent
//      (10 with fewer than about twelve sessions of the lift); a stall at
//      the same load again asks for a different rep range before anyone
//      swaps the exercise.
//   4. A LIGHTER WEEK. On a back-off week, or after five accumulation
//      sessions in a row, half the sets at about 10 percent less, nothing to
//      failure.
//   5. SETS CHANGE AT BLOCK LEVEL. At most one set more per week, never in
//      the week of a load step; offered as a field, never written.
//   6. HIS MARKS, IF HE MADE THEM. All Clean is easy and lets the step
//      through; a grind is right and leaves the reps to decide; a miss is
//      hard and holds. Never required.
//
// Two rules from the first engine stand: NOTHING IS WRITTEN until the lifter
// logs the suggested numbers (applySuggestion is the only writer), and a
// suggestion the evidence cannot support is silence, not a guess. Never
// called AI anywhere it is drawn.

export type SuggestionKind = "bump" | "hold" | "back" | "extend" | "scheme" | "lighter";

export interface Suggestion {
  kind: SuggestionKind;
  /** What to open the first set at, or plan next time. Only the fields this
   *  exercise's kind uses. */
  next: SetLog;
  /** What it is moving from: last session's load and its top reps. */
  from: SetLog;
  /** The one line, as its parts: what he did, what that meant, what to do.
   *  Drawn as facts so the dots between them are the stylesheet's. */
  reason: string[];
  /** The same line as one string, for the Why row and a receipt. */
  why: string;
  /** The reps to expect after a load step ("Expect 6 to 7"). */
  expect?: string;
  /** The rep range the suggestion worked inside, extended when rule 2 says. */
  range: { low: number; high: number };
  /** Rule 5: a set could be added this week (the load did not step). */
  addSet?: boolean;
  /** A lighter week's set count (half the plan's). */
  sets?: number;
  /** The basis on tap: the lift, the session read, which sets counted, the
   *  rep range, the increment, and the marks. */
  basis?: SuggestionBasis;
}

export interface SuggestionBasis {
  variant: string;
  source: string;
  role: string;
  range: string;
  increment: string;
  marks: string;
}

// Two modes (2026-10-04): a third, Program, offered "the plan as written" but
// returned nothing exactly as Manual does, so it was taken off the menu and a
// stored "program" reads as Manual (health/settings.ts).
export type ProgressionMode = "assisted" | "manual";

export interface SuggestOptions {
  mode?: ProgressionMode;
  /** The smallest real jump the equipment makes: two of the rack's smallest
   *  plate on anything plates go on, the stack's step on a machine. Absent
   *  reads as 2.5. */
  smallestJump?: number;
  equipmentLabel?: string;
  /** THE SAME SESSION THE SCREEN CALLS "LAST" (2026-09-29). Given, this
   *  workout day's own sessions are read first (prs.ts lastSessionFor). */
  preferDayId?: string;
  /** The program week is a back-off week (ProgramWeek.backOff): rule 4
   *  applies whatever the log says. */
  backOffWeek?: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayPhrase(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}` : iso;
}

const trim = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
const same = (a: number, b: number) => Math.abs(a - b) < 0.05;
const r4 = (x: number) => Number(x.toFixed(4));

/** The sessions that actually trained this exercise, oldest first, by the same
 *  identity every other gym derivation uses (GYM-F-04: the library key when
 *  both sides have one, else name and kind). Warm-ups and drops are not
 *  evidence: they are supposed to move well. Weights come back in the unit the
 *  lift is in NOW (2026-09-29). */
interface Session { date: string; dayId: string; sets: SetEntry[]; unit: string | undefined }

function sessionsOf(history: Workout[], ex: Pick<Exercise, "name" | "kind" | "unit"> & { exerciseKey?: string }): Session[] {
  const ref = liftRef(ex, ex.kind);
  const out: Session[] = [];
  for (const w of history) {
    const hit = w.data.exercises.find((e) => sameLift(ref, e));
    const work = hit?.sets.filter((s) => !s.skipped && !s.warmup && !s.drop) ?? [];
    if (!hit || !work.length) continue;
    const convert = !!ex.unit && !!hit.unit && ex.unit !== hit.unit;
    out.push({
      date: w.data.date, dayId: w.data.dayId,
      sets: convert ? work.map((s) => inUnit(ex.kind, s, hit.unit, ex.unit) as SetEntry) : work,
      unit: convert ? ex.unit : hit.unit,
    });
  }
  return out;
}

/** The working load of one session: its heaviest set. */
const loadOf = (s: Session): number => Math.max(0, ...s.sets.map((x) => x.w ?? 0));
/** The reps of the sets AT a load, in order. */
const repsAt = (s: Session, load: number): number[] => s.sets.filter((x) => same(x.w ?? 0, load) && (x.r ?? 0) > 0).map((x) => x.r!);
/** Rule 3's miss: a work set at the load under the range bottom. */
const missed = (s: Session, load: number, low: number): boolean => repsAt(s, load).some((r) => r < low);

/** The most a suggestion may lean on one session's heaviest set: 1.5 times the
 *  middle of the tops before it. Past that the number is not a trend, it is a
 *  mistyped weight or another lift's. */
const OUTLIER = 1.5;
/** Rule 4's count of accumulation sessions before a lighter week is offered. */
const ACCUMULATION_SESSIONS = 5;
/** Rule 3: the session count under which a stall cuts ten percent, not five. */
const NOVICE_SESSIONS = 12;

const roundTo = (x: number, jump: number) => r4(Math.round(x / jump) * jump);
const floorTo = (x: number, jump: number) => r4(Math.floor(x / jump + 1e-9) * jump);

/** Rule 2's step: about 2.5 percent, at least one jump, never over 5 percent
 *  once a jump fits under it. */
function loadStep(load: number, jump: number): number {
  let step = Math.max(jump, roundTo(load * 0.025, jump));
  const cap = floorTo(load * 0.05, jump);
  if (step > cap && cap >= jump) step = cap;
  return step;
}

/**
 * What to offer for the next session of `ex`, or null when the log does not
 * support offering anything.
 */
export function suggestFor(history: Workout[], ex: Exercise, opts: SuggestOptions = {}): Suggestion | null {
  const mode = opts.mode ?? "assisted";
  if (mode === "manual") return null;
  const all = sessionsOf(history, ex);
  if (all.length === 0) return null;
  const scope = opts.preferDayId && all.some((x) => x.dayId === opts.preferDayId) ? all.filter((x) => x.dayId === opts.preferDayId) : all;
  const last = scope[scope.length - 1]!;
  const before = scope.slice(0, -1);

  // RULE 1: THE PLAN'S RANGE. No range on the plan, no opinion.
  const planned = ex.sets.filter((s) => !s.warmup && !s.skipped && !s.drop).map((s) => s.r).filter((r): r is number => (r ?? 0) > 0);
  if (!planned.length) return null;
  const high = Math.max(...planned);
  const low = planned.length > 1 && Math.min(...planned) < high ? Math.min(...planned) : Math.max(1, high - 2);
  const range = { low, high };

  const keys = fieldsFor(ex.kind).map((f) => f.key);
  const weighted = keys.includes("w");
  if (!weighted && !keys.includes("r")) return null; // a time is not something to hand out as a target

  const load = weighted ? loadOf(last) : 0;
  if (weighted && load <= 0) return null;
  const reps = weighted ? repsAt(last, load) : last.sets.map((s) => s.r ?? 0).filter((r) => r > 0);
  if (!reps.length) return null;

  // THE OUTLIER GUARD (2026-09-29). With at least two earlier sessions to
  // compare, a top load more than 1.5 times their median offers nothing.
  if (weighted && before.length >= 2) {
    const tops = before.map(loadOf).filter((t) => t > 0).sort((a, b) => a - b);
    if (tops.length >= 2) {
      const mid = tops.length % 2 ? tops[(tops.length - 1) / 2]! : (tops[tops.length / 2 - 1]! + tops[tops.length / 2]!) / 2;
      if (load > mid * OUTLIER) return null;
    }
  }

  // RULE 6: HIS MARKS, on the sets that counted.
  const counted = weighted ? last.sets.filter((x) => same(x.w ?? 0, load)) : last.sets;
  const marked = counted.filter((s) => s.moved);
  const easy = marked.length > 0 && marked.every((s) => s.moved === "clean");
  const hard = marked.some((s) => s.moved === "missed");

  const allTop = reps.every((r) => r >= high);
  const miss = reps.some((r) => r < low);
  const jump = opts.smallestJump && opts.smallestJump > 0 ? opts.smallestJump : 2.5;
  const when = dayPhrase(last.date);
  const lastLine = weighted ? `Last Time ${trim(load)} × ${reps.join(", ")}` : `Last Time ${reps.join(", ")} Reps`;
  const rangeWord = low === high ? `${high}` : `${low} to ${high}`;
  const from: SetLog = weighted ? { w: load, r: Math.max(...reps) } : { r: Math.max(...reps) };
  const planSets = ex.sets.filter((s) => !s.warmup && !s.skipped && !s.drop).length;

  let kind: SuggestionKind;
  let next: SetLog;
  let verdict: string;
  let target: string;
  let expect: string | undefined;
  let incrementUsed = 0;
  let addSet = false;
  let sets: number | undefined;

  // RULE 4: A LIGHTER WEEK. The week says so, or five accumulation sessions
  // in a row did: each at least the load of the one before, none lighter, and
  // every work set inside the range (a missed session is a strike, not a
  // week of accumulation).
  const inRange = (x: Session) => !weighted || !missed(x, loadOf(x), low);
  const accumulation = (() => {
    if (!inRange(last)) return 0;
    let n = 1;
    for (let i = scope.length - 1; i > 0; i--) {
      if (inRange(scope[i - 1]!) && loadOf(scope[i]!) >= loadOf(scope[i - 1]!) * 0.95) n++; else break;
    }
    return n;
  })();
  const lighterWeek = !!opts.backOffWeek || (weighted && accumulation >= ACCUMULATION_SESSIONS);

  if (lighterWeek) {
    kind = "lighter";
    sets = Math.max(1, Math.ceil(planSets / 2));
    if (weighted) {
      const lighter = Math.max(jump, floorTo(load * 0.9, jump));
      next = { w: lighter, r: low };
      target = `Lighter Week ${trim(lighter)} × ${low}, ${sets === 1 ? "1 Set" : `${sets} Sets`}, Nothing to Failure`;
    } else {
      next = { r: low };
      target = `Lighter Week ${low} Reps, ${sets === 1 ? "1 Set" : `${sets} Sets`}, Nothing to Failure`;
    }
    verdict = opts.backOffWeek ? "Back-Off Week" : `${accumulation} Sessions Up Without a Lighter One`;
  } else if (miss) {
    // RULE 3: TWO STRIKES.
    const prev = before[before.length - 1];
    const prevMiss = !!prev && (!weighted || same(loadOf(prev), load)) && missed(prev, load, low);
    if (!prevMiss) {
      kind = "hold";
      next = weighted ? { w: load, r: low } : { r: low };
      verdict = `Under ${low} Once`;
      target = weighted ? `Same Again ${trim(load)} × ${low}` : `Same Again ${low} Reps`;
    } else {
      // A stall at this load that was already cut once asks for a new scheme.
      let stalledBefore = false;
      for (let i = 1; i < before.length; i++) {
        const a = before[i - 1]!, b = before[i]!;
        if ((!weighted || (same(loadOf(a), load) && same(loadOf(b), load))) && missed(a, load, low) && missed(b, load, low)) { stalledBefore = true; break; }
      }
      if (stalledBefore) {
        kind = "scheme";
        next = weighted ? { w: load, r: low } : { r: low };
        verdict = weighted ? `Stalled at ${trim(load)} Twice` : "Stalled Twice";
        target = "Try a Different Rep Range";
      } else {
        kind = "back";
        const cut = all.length < NOVICE_SESSIONS ? 0.1 : 0.05;
        if (weighted) {
          const lighter = Math.max(jump, Math.min(r4(load - jump), floorTo(load * (1 - cut), jump)));
          next = { w: lighter, r: low };
          target = `Back to ${trim(lighter)} × ${low}`;
        } else {
          next = { r: Math.max(1, low - 1) };
          target = `Back to ${Math.max(1, low - 1)} Reps`;
        }
        verdict = `Under ${low} Twice`;
      }
    }
  } else if ((allTop || easy) && !hard) {
    // RULE 2: THE STEP.
    if (!weighted) {
      kind = "bump";
      next = { r: high + 1 };
      verdict = allTop ? `All at the Top of ${rangeWord}` : "Marked Easy";
      target = `Step to ${high + 1} Reps`;
    } else if (jump > load * 0.07) {
      kind = "extend";
      range.high = high + 3;
      next = { w: load, r: range.high };
      verdict = allTop ? `All at the Top of ${rangeWord}` : "Marked Easy";
      target = `A ${trim(jump)} Jump Is Over 7% of ${trim(load)}, Range Now ${low} to ${range.high}`;
      addSet = planSets < 5;
    } else {
      kind = "bump";
      incrementUsed = loadStep(load, jump);
      const to = r4(load + incrementUsed);
      next = { w: to, r: low };
      verdict = allTop ? `All at the Top of ${rangeWord}` : "Marked Easy";
      target = `Step to ${trim(to)} × ${low}`;
      expect = high - 1 > low ? `Expect ${low} to ${high - 1}` : `Expect ${low}`;
    }
  } else {
    // RULE 1: HOLD AND ADD REPS.
    kind = "hold";
    next = weighted ? { w: load, r: high } : { r: high };
    verdict = hard ? "Marked Hard" : `Below the Top of ${rangeWord}`;
    target = weighted ? `Hold ${trim(load)}, Add Reps to ${high}` : `Add Reps to ${high}`;
    addSet = hard && allTop && planSets < 5;
  }

  // Every part is a fact on the session screen, so each takes the whole
  // rule's casing at the builder (Dave 2026-09-26).
  const reason = [lastLine, verdict, target].map((t) => lineCase(t));
  const why = reason.join(", ");

  const unit = last.unit ?? ex.unit ?? "";
  const clean = marked.filter((s) => s.moved === "clean").length;
  const grind = marked.filter((s) => s.moved === "grind").length;
  const miss2 = marked.filter((s) => s.moved === "missed").length;
  const basis: SuggestionBasis = {
    variant: ex.name + (opts.equipmentLabel ? ", " + opts.equipmentLabel : ""),
    // The count leads: "Aug 12, 2 working sets" read as a date with a year.
    source: lineCase(counted.length + (counted.length === 1 ? " working set" : " working sets") + " on " + when),
    role: weighted ? `Working Sets at ${trim(load)} Only, Warm-Ups and Drops Left Out` : "Completed Working Sets Only, Warm-Ups and Drops Left Out",
    range: range.low === range.high ? `${range.high} Reps` : `${range.low} to ${range.high} Reps`,
    increment: incrementUsed > 0 ? lineCase(`${trim(incrementUsed)} ${unit}`.trim()) : weighted ? lineCase(`${trim(jump)} ${unit} jump`.trim()) : "One Rep",
    marks: marked.length ? lineCase([clean ? `${clean} clean` : "", grind ? `${grind} grind` : "", miss2 ? `${miss2} missed` : ""].filter(Boolean).join(", ")) : "None Marked",
  };

  return {
    kind, next, from, reason, why, range,
    ...(expect ? { expect } : {}),
    ...(addSet ? { addSet: true } : {}),
    ...(sets !== undefined ? { sets } : {}),
    basis,
  };
}

/**
 * Accept a suggestion: write the new target across the exercise's WORKING
 * sets. Ids survive (the strip is edited, not replaced), warm-ups are left
 * alone (they re-derive from the new weight), and a skipped chip stays
 * exactly as skipped as it was. The set count is never changed here (rule 5:
 * sets move at block level, by the lifter's own hand).
 */
export function applySuggestion(ex: Exercise, s: Suggestion): Exercise {
  return {
    ...ex,
    sets: ex.sets.map((entry) => {
      if (entry.warmup || entry.skipped || entry.drop) return entry;
      const next = { ...entry };
      if (s.next.w !== undefined) next.w = s.next.w;
      if (s.next.r !== undefined) next.r = s.next.r;
      return next;
    }),
  };
}
