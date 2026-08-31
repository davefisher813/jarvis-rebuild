import type { Exercise, SetLog, Workout } from "./types";
import { fieldsFor } from "./measures";

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

/** The last session that actually trained this exercise, by the same
 *  name+kind identity every other gym derivation uses. */
function lastSession(history: Workout[], ex: Pick<Exercise, "name" | "kind">) {
  for (let i = history.length - 1; i >= 0; i--) {
    const w = history[i]!;
    const hit = w.data.exercises.find((e) => e.name === ex.name && e.kind === ex.kind);
    // Warm-ups are not evidence: they are supposed to move well.
    const work = hit?.sets.filter((s) => !s.skipped && !s.warmup) ?? [];
    if (hit && work.length) return { date: w.data.date, sets: work, unit: hit.unit };
  }
  return null;
}

/**
 * What to offer for the next session of `ex`, or null when the log does not
 * support offering anything.
 */
export function suggestFor(history: Workout[], ex: Exercise): Suggestion | null {
  const last = lastSession(history, ex);
  if (!last) return null;

  const marked = last.sets.filter((s) => s.moved);
  if (!marked.length) return null; // rule 1: no marks, no opinion

  const missed = marked.some((s) => s.moved === "missed");
  const ground = marked.some((s) => s.moved === "grind");
  const kind: SuggestionKind = missed ? "back" : ground ? "hold" : "bump";

  // Move whatever this kind actually measures. A rep-only lift gains a rep;
  // a weighted lift gains weight; a timed one is left alone (a faster time
  // is not something an app should hand out as a target).
  const keys = fieldsFor(ex.kind).map((f) => f.key);
  const top = [...last.sets].sort((a, b) => (b.w ?? b.r ?? 0) - (a.w ?? a.r ?? 0))[0]!;
  const from: SetLog = {};
  for (const k of keys) if (top[k] !== undefined) from[k] = top[k];

  const next: SetLog = { ...from };
  if (keys.includes("w") && (from.w ?? 0) > 0) {
    const jump = jumpFor(from.w!, last.unit ?? ex.unit);
    next.w = kind === "bump" ? from.w! + jump : kind === "back" ? Math.max(jump, from.w! - jump * 2) : from.w!;
  } else if (keys.includes("r") && (from.r ?? 0) > 0) {
    next.r = kind === "bump" ? from.r! + 1 : kind === "back" ? Math.max(1, from.r! - 1) : from.r!;
  } else {
    return null; // nothing this engine can honestly move
  }

  const when = dayPhrase(last.date);
  const why = kind === "bump"
    ? `Was ${describe(from, ex)}, all clean ${when}`
    : kind === "hold"
      ? `Was ${describe(from, ex)}, a grind ${when}`
      : `Was ${describe(from, ex)}, missed one ${when}`;

  return { kind, next, from, why };
}

function describe(s: SetLog, ex: Pick<Exercise, "unit">): string {
  if (s.w !== undefined) return `${s.w}${ex.unit ? " " + ex.unit : ""}`;
  return `${s.r} reps`;
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
      if (entry.warmup || entry.skipped) return entry;
      const next = { ...entry };
      if (s.next.w !== undefined) next.w = s.next.w;
      if (s.next.r !== undefined) next.r = s.next.r;
      return next;
    }),
  };
}
