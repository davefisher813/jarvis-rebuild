import type { Exercise, SetEntry, SetLog, Workout } from "./types";
import { fieldsFor, inUnit } from "./measures";
import { liftRef, sameLift } from "./identity";
import { lineCase } from "../shared/casing";

// THE PROGRESSION ENGINE (D6-A, Training Catalog V2, approved 2026-08-31).
//
// The app already asks the only question it can answer honestly -- how did
// that set MOVE? -- and until now it stored the answer and did nothing with
// it. Alpha Progression turns exactly this into next-session targets; so do
// we, with two rules that are not negotiable:
//
//   1. NO MARKS, NO OPINION. A session nobody marked produces no suggestion.
//      Silence is the honest output of missing evidence.
//   2. A SUGGESTION IS A GHOST. Nothing in the program changes until the
//      athlete accepts it, exactly like the app's other suggestion surfaces
//      (the ghost is offered, the write is theirs). applySuggestion is the
//      only writer, and callers hand its result to updateProgram.

export type SuggestionKind = "bump" | "hold" | "back";

export interface Suggestion {
  kind: SuggestionKind;
  /** What to plan next time. Only the fields this exercise's kind uses. */
  next: SetLog;
  /** What it is moving from, for the ghost's own line. */
  from: SetLog;
  /** Plain words, always naming the evidence: "was 225, all clean Aug 24". */
  why: string;
  /** Part 3 wave 5: the basis on tap. Every suggestion says which lift, the
   *  session it read, which sets counted, the rep range, the increment, and
   *  the marks. */
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

/** THE ASSISTED ENGINE (Part 3 wave 5, 2026-09-13; Dave's 9b and O2a).
 *  Double progression, a stated policy and not an evidence claim: the plan
 *  gives a rep range (its lowest and highest planned reps; one number is a
 *  range of one); when every completed working set clears the top of it,
 *  the next target adds the smallest real increment; inside the range, the
 *  target is the top of it at the same weight; under the bottom, a step
 *  back. Completed working sets only, never warm-ups or drops. His marks
 *  win when they exist (a miss is a step back, a grind a hold), because a
 *  set he called a grind is not a set that cleared anything. Manual offers
 *  nothing. */
export interface SuggestOptions {
  mode?: ProgressionMode;
  /** The rack's smallest plate, both sides, as the increment for a barbell. */
  smallestJump?: number;
  equipmentLabel?: string;
  /** THE SAME SESSION THE SCREEN CALLS "LAST" (2026-09-29). The live session
   *  seeds its fields and prints its Last header from this workout day's own
   *  previous session first (prs.ts lastSessionFor); the suggestion used to
   *  read the newest session of the lift on ANY day, so the card could say
   *  "Last 270 x 5" and "Suggested 595 x 2" in one breath, the second built on
   *  a different day's heavy top set. Given, the same day answers first. */
  preferDayId?: string;
}

/** The jump that fits the numbers the athlete actually lifts. A 5 lb jump on
 *  a 30 lb curl is a 17% week; the same jump on a 300 lb squat is nothing.
 *  Small loads move in the smallest real increment, bars move in fives. */
function jumpFor(weight: number, unit: string | undefined): number {
  const kg = unit === "kg";
  if (weight < 60) return kg ? 1 : 2.5;   // dumbbells and machines
  return kg ? 2.5 : 5;                     // a bar with plates on it
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayPhrase(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}` : iso;
}

/** The sessions that actually trained this exercise, oldest first, by the same
 *  identity every other gym derivation uses (GYM-F-04: the library key when
 *  both sides have one, else name and kind). Warm-ups and drops are not
 *  evidence: they are supposed to move well. Weights come back in the unit the
 *  lift is in NOW (2026-09-29): a session logged in kg used to be read as if
 *  its numbers were pounds, or the other way round. */
function sessionsOf(history: Workout[], ex: Pick<Exercise, "name" | "kind" | "unit"> & { exerciseKey?: string }) {
  const ref = liftRef(ex, ex.kind);
  const out: { date: string; dayId: string; sets: SetEntry[]; unit: string | undefined }[] = [];
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

/** The session to read and the ones before it. Same day first, else the
 *  newest, exactly as the Last header chooses (prs.ts lastSessionFor). */
function lastSession(history: Workout[], ex: Pick<Exercise, "name" | "kind" | "unit"> & { exerciseKey?: string }, preferDayId?: string) {
  const all = sessionsOf(history, ex);
  if (all.length === 0) return null;
  const scope = preferDayId && all.some((x) => x.dayId === preferDayId) ? all.filter((x) => x.dayId === preferDayId) : all;
  const last = scope[scope.length - 1]!;
  return { ...last, before: scope.slice(0, -1).slice(-3) };
}

/** The most a suggestion may lean on one session's heaviest set: 1.5 times the
 *  middle of the tops before it. Past that the number is not a trend, it is a
 *  mistyped weight or another lift's, and building next week's target on it
 *  is how a card ends up asking for double what was ever lifted. */
const OUTLIER = 1.5;

/**
 * What to offer for the next session of `ex`, or null when the log does not
 * support offering anything.
 */
export function suggestFor(history: Workout[], ex: Exercise, opts: SuggestOptions = {}): Suggestion | null {
  const mode = opts.mode ?? "assisted";
  if (mode === "manual") return null;
  const last = lastSession(history, ex, opts.preferDayId);
  if (!last) return null;

  const marked = last.sets.filter((s) => s.moved);
  const planned = ex.sets.filter((s) => !s.warmup && !s.skipped && !s.drop).map((s) => s.r).filter((r): r is number => (r ?? 0) > 0);
  const low = planned.length ? Math.min(...planned) : null;
  const high = planned.length ? Math.max(...planned) : null;
  const completed = last.sets.filter((s) => !s.skipped && (s.r ?? 0) > 0);
  let kind: SuggestionKind;
  let basisWhy: string;
  if (marked.length) {
    // The marks win: they are the only thing that says how it felt.
    const missed = marked.some((s) => s.moved === "missed");
    const ground = marked.some((s) => s.moved === "grind");
    kind = missed ? "back" : ground ? "hold" : "bump";
    basisWhy = "";
  } else if (high != null && low != null && completed.length) {
    // Double progression from completed working sets.
    const reps = completed.map((s) => s.r!);
    if (reps.every((r) => r >= high)) kind = "bump";
    else if (reps.every((r) => r >= low)) kind = "hold";
    else kind = "back";
    basisWhy = kind === "bump" ? `every set cleared ${high}` : kind === "hold" ? `inside ${low} to ${high} Reps` : `under ${low} Reps`;
  } else {
    return null; // rule 1: no marks and no range, no opinion
  }

  // Move whatever this kind actually measures. A rep-only lift gains a rep;
  // a weighted lift gains weight; a timed one is left alone (a faster time
  // is not something an app should hand out as a target).
  const keys = fieldsFor(ex.kind).map((f) => f.key);
  const top = [...last.sets].sort((a, b) => (b.w ?? b.r ?? 0) - (a.w ?? a.r ?? 0))[0]!;
  const from: SetLog = {};
  for (const k of keys) if (top[k] !== undefined) from[k] = top[k];

  // THE OUTLIER GUARD (2026-09-29). The target is built on the session's
  // heaviest set, so one absurd set (a typo, a rack pull filed under the deadlift)
  // would be carried forward and bumped. With at least two earlier sessions to
  // compare, a top set more than 1.5 times their median offers nothing: silence
  // is the honest output of evidence that contradicts itself (rule 1).
  if (keys.includes("w") && (from.w ?? 0) > 0 && last.before.length >= 2) {
    const tops = last.before.map((x) => Math.max(...x.sets.map((y) => y.w ?? 0))).filter((t) => t > 0).sort((a, b) => a - b);
    if (tops.length >= 2) {
      const mid = tops.length % 2 ? tops[(tops.length - 1) / 2]! : (tops[tops.length / 2 - 1]! + tops[tops.length / 2]!) / 2;
      if (from.w! > mid * OUTLIER) return null;
    }
  }

  const next: SetLog = { ...from };
  let jumpUsed = 0;
  if (keys.includes("w") && (from.w ?? 0) > 0) {
    const jump = opts.smallestJump && opts.smallestJump > 0 ? Math.min(opts.smallestJump, jumpFor(from.w!, last.unit ?? ex.unit)) : jumpFor(from.w!, last.unit ?? ex.unit);
    jumpUsed = jump;
    next.w = kind === "bump" ? from.w! + jump : kind === "back" ? Math.max(jump, from.w! - jump * 2) : from.w!;
    // Inside the range at the same weight, the target is the top of it.
    if (kind === "hold" && !marked.length && high != null) next.r = high;
  } else if (keys.includes("r") && (from.r ?? 0) > 0) {
    next.r = kind === "bump" ? from.r! + 1 : kind === "back" ? Math.max(1, from.r! - 1) : from.r!;
  } else {
    return null; // nothing this engine can honestly move
  }

  const when = dayPhrase(last.date);
  // Every line of the basis is a fact row on the session screen, so each
  // takes the whole rule's casing at the builder (Dave 2026-09-26).
  const why = lineCase(marked.length
    ? (kind === "bump"
      ? `Was ${describe(from, ex)}, all clean ${when}`
      : kind === "hold"
        ? `Was ${describe(from, ex)}, a grind ${when}`
        : `Was ${describe(from, ex)}, missed one ${when}`)
    : `Was ${describe(from, ex)}, ${basisWhy} ${when}`);

  const unit = last.unit ?? ex.unit ?? "";
  const clean = marked.filter((s) => s.moved === "clean").length;
  const grind = marked.filter((s) => s.moved === "grind").length;
  const miss = marked.filter((s) => s.moved === "missed").length;
  const basis: SuggestionBasis = {
    variant: ex.name + (opts.equipmentLabel ? ", " + opts.equipmentLabel : ""),
    // The count leads: "Aug 12, 2 working sets" read as a date with a year.
    source: lineCase(completed.length + (completed.length === 1 ? " working set" : " working sets") + " on " + when),
    role: "Completed Working Sets Only, Warm-Ups and Drops Left Out",
    range: high != null && low != null ? (low === high ? `${high} Reps` : `${low} to ${high} Reps`) : "No Rep Range on the Plan",
    increment: jumpUsed > 0 ? lineCase(`${jumpUsed} ${unit}`.trim()) : "One Rep",
    marks: marked.length ? lineCase([clean ? `${clean} clean` : "", grind ? `${grind} grind` : "", miss ? `${miss} missed` : ""].filter(Boolean).join(", ")) : "None Marked",
  };

  return { kind, next, from, why, basis };
}

function describe(s: SetLog, ex: Pick<Exercise, "unit">): string {
  if (s.w !== undefined) return lineCase(`${s.w}${ex.unit ? " " + ex.unit : ""}`);
  return lineCase(`${s.r} reps`);
}

/**
 * Accept a suggestion: write the new target across the exercise's WORKING
 * sets. Ids survive (the strip is edited, not replaced), warm-ups are left
 * alone (they re-derive from the new weight), and a skipped chip stays
 * exactly as skipped as it was.
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
