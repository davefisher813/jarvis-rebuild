import type { Workout, Exercise, MeasureKind } from "./types";

// LEARNED PACING, D5/D7 (Training Catalog V2, approved 2026-08-31).
// "Build: L · needs D7 for honest numbers."
//
// The estimate's whole worth is that it never pretends. Every logged set
// carries an `at` stamp (D7), so the gap between two consecutive stamps is
// what one set of that lift ACTUALLY costs this athlete -- execution plus
// the rest they really take, not the rest they wrote down. The median of
// those gaps is the lift's pace, and the UI must always say which world a
// number came from: "learned from your last N sessions" or "default pace ·
// improves as you log". A default never dresses up as a measurement.
//
// What is deliberately NOT here: no per-set regression, no fatigue models,
// no readiness scores. A median over a window is as far as n-of-1 data
// honestly goes (HEALTH_PREVIEW_SPEC 2026-08-31).

/** Doing the set itself, when no pace is learned. The sealed preview's
 *  estimate model: perSet = WORK_SEC + rest target. */
export const WORK_SEC = 40;
/** Rest floor (D5-A: "shorten rests toward a floor"). Cuts never go below. */
export const REST_FLOOR_SEC = 45;
/** Rest target assumed when an exercise states none. */
export const DEFAULT_REST_SEC = 60;
/** One derived warm-up set (D3-A ramp): light bar, short rest, by design.
 *  A stated default, never presented as learned. */
export const RAMP_SEC_PER_SET = 60;

/** A gap shorter than this is two taps on one walk back to the bench, not a
 *  set; longer is a water fountain conversation, a phone call, a spot given
 *  to a stranger. Neither is pace. */
export const MIN_GAP_MS = 20_000;
export const MAX_GAP_MS = 10 * 60_000;
/** Newest sessions considered. Pace drifts with programs and seasons; last
 *  month's superset block should not price next month's straight sets. */
export const PACE_WINDOW = 5;
/** Evidence bar: fewer valid gaps than this stays a default. Two gaps from
 *  one lucky session are an anecdote, not a pace. */
export const MIN_GAPS = 3;

export interface LiftPace {
  /** Seconds one set of this lift costs, rest included. */
  secPerSet: number;
  /** True only when secPerSet is a median of real logged gaps. */
  learned: boolean;
  /** Sessions that contributed gaps (0 when default). */
  sessions: number;
}

/**
 * Valid working gaps for one lift, newest sessions first, and how many
 * sessions contributed. Skips backdated workouts entirely -- their stamps
 * say when the numbers were TYPED, not when the work happened (D7's own
 * documented rule). A gap belongs to the set that ENDS it, so a gap ending
 * at a warm-up chip is warm-up pace, not working pace, and stays out.
 */
export function workGaps(history: Workout[], name: string, kind: MeasureKind): { gaps: number[]; sessions: number } {
  const gaps: number[] = [];
  let sessions = 0;
  for (let i = history.length - 1; i >= 0 && sessions < PACE_WINDOW; i--) {
    const w = history[i]!;
    if (w.data.backdated) continue;
    const ex = w.data.exercises.find((e) => e.name === name && e.kind === kind);
    if (!ex) continue;
    let took = 0;
    let prevAt: number | null = null;
    for (const s of ex.sets) {
      if (s.skipped || !s.at) continue;
      if (prevAt != null && !s.warmup) {
        const gap = s.at - prevAt;
        if (gap >= MIN_GAP_MS && gap <= MAX_GAP_MS) { gaps.push(gap); took++; }
      }
      prevAt = s.at;
    }
    if (took > 0) sessions++;
  }
  return { gaps, sessions };
}

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

/** The pace one set of this exercise is priced at. Learned when the
 *  evidence clears MIN_GAPS; otherwise the stated model, named as such. */
export function paceFor(history: Workout[], ex: Pick<Exercise, "name" | "kind" | "restSec">): LiftPace {
  const { gaps, sessions } = workGaps(history, ex.name, ex.kind);
  if (gaps.length >= MIN_GAPS) {
    return { secPerSet: Math.round(median(gaps) / 1000), learned: true, sessions };
  }
  return { secPerSet: WORK_SEC + (ex.restSec ?? DEFAULT_REST_SEC), learned: false, sessions: 0 };
}

/** The honesty line the estimate wears. Never claims learning it didn't do. */
export function paceLine(p: LiftPace): string {
  if (!p.learned) return "default pace · improves as you log";
  return p.sessions === 1 ? "learned from your last session" : `learned from your last ${p.sessions} sessions`;
}
