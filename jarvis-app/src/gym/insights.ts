import type { Workout, MeasureKind, Program } from "./types";
import { scoreOf } from "./measures";
import { liftSessions, chartValue, daysAgo, type LiftSession } from "./chartData";
import { numericValue, type MetricDef, type MetricLog } from "./metrics";
import { MUSCLE_GROUPS, HARD_SET_RANGE, type MuscleGroup, type PublishedRange } from "./muscles";
import { daysBetween } from "../upnext/upnext";
import { capAfterNumber } from "../shared/casing";

// THE HONEST VERSION, D11-C + D13-C (Training Catalog V2, approved
// 2026-08-31). The realism line given to Dave and kept literally: WHEN is
// computable (a flat e1RM across enough sessions is a fact); WHY is not, not
// from one person's logs -- every card here ends "correlation, not cause"
// and NEVER claims a causal why. Published science is restated with its
// source named on the row, never authored by this app. No readiness score,
// no predicted 1RM, no diagnosis, ever (HEALTH_CATALOG Part 9, reaffirmed by
// the override doc).
//
// SCOPE NOTE: D13's "what changed" receipt compares sets/session, session
// frequency, and any logged metric between the flat stretch and the stretch
// before it. It deliberately does NOT compare rest durations -- pacing.ts's
// learned-rest derivation (D7) works over a whole SESSION's `at` stamps, not
// one exercise sliced out of it, and slicing it here would mean guessing
// which gaps belonged to this lift. Better to omit a receipt line than fake
// one; two honest lines beat three where the third is invented.

// --- D11-C: METRIC x PERFORMANCE ------------------------------------------

/** Below this many paired sessions, a link renders as an honest ghost
 *  ("not enough days yet"), never a number. Catalog's own words. */
export const INSIGHT_MIN_PAIRED = 10;
/** Each side of the split needs its own minimum too -- ten paired sessions
 *  that are nine highs and one low says nothing about the low side. */
export const INSIGHT_MIN_GROUP = 3;

export interface CorrelationInsight {
  metricName: string;
  exerciseName: string;
  pairedSessions: number;
  /** Mean session-over-session change on the higher side minus the lower
   *  side -- signed, in the chart's own units (e1RM, or the kind's score). */
  deltaDiff: number;
  higherLabel: string;
  lowerLabel: string;
  line: string;
}

/** True direction for a kind, read off scoreOf with throwaway values -- only
 *  the KIND decides which way wins, never the numbers, so this is safe to
 *  call with placeholders just to read the flag. */
function lowerWinsFor(kind: MeasureKind): boolean {
  return scoreOf(kind, { w: 1, r: 1, v: 1, t: 1 })?.lowerWins ?? false;
}

/**
 * Session-over-session deltas (not absolutes -- a rising timeline cannot
 * fake a correlation this way), each paired with the metric's OWN logged
 * value on the session's date. Same-day pairing, uniformly, for every
 * metric: a metric-specific offset ("sleep is really about the night
 * before") would mean guessing which metrics are next-day and which are
 * same-day, and this app does not guess.
 */
function pairedDeltas(sessions: LiftSession[], kind: MeasureKind, logs: MetricLog[], def: MetricDef): { delta: number; metricValue: number }[] {
  const lowerWins = lowerWinsFor(kind);
  const out: { delta: number; metricValue: number }[] = [];
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1]!, cur = sessions[i]!;
    const log = logs.find((l) => l.data.metricId === def.id && l.data.date === cur.date);
    const mv = numericValue(def.data, log);
    if (mv == null) continue;
    const raw = chartValue(cur) - chartValue(prev);
    out.push({ delta: lowerWins ? -raw : raw, metricValue: mv }); // always "positive delta = better", direction-normalized
  }
  return out;
}

/**
 * The insight card, or null when there is nothing honest to say (too few
 * paired sessions, or a metric with only one value ever logged so there is
 * no split to make). Splits the paired sample at ITS OWN median -- a
 * threshold this app invented (7 hours, say) would be exactly the kind of
 * guess the doctrine bans; the median is computed from the athlete's actual
 * logs, never authored.
 */
export function correlate(sessions: LiftSession[], kind: MeasureKind, exerciseName: string, def: MetricDef, logs: MetricLog[]): CorrelationInsight | null {
  const pairs = pairedDeltas(sessions, kind, logs, def);
  if (pairs.length < INSIGHT_MIN_PAIRED) return null;

  const values = [...pairs.map((p) => p.metricValue)].sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;

  const isYesNo = def.data.type === "yesno";
  const higher = pairs.filter((p) => (isYesNo ? p.metricValue >= 1 : p.metricValue > median));
  const lower = pairs.filter((p) => (isYesNo ? p.metricValue < 1 : p.metricValue <= median));
  if (higher.length < INSIGHT_MIN_GROUP || lower.length < INSIGHT_MIN_GROUP) return null;

  const avg = (xs: { delta: number }[]) => xs.reduce((s, x) => s + x.delta, 0) / xs.length;
  const deltaDiff = avg(higher) - avg(lower);
  const higherLabel = isYesNo ? def.data.name : `higher ${def.data.name}`;
  const lowerLabel = isYesNo ? `no ${def.data.name}` : `lower ${def.data.name}`;
  const sign = deltaDiff >= 0 ? "+" : "";
  const line = capAfterNumber(
    `${sign}${round1(deltaDiff)} per session on ${higherLabel} days vs ${lowerLabel} · ${pairs.length} paired · Correlation, not cause`,
  );
  return { metricName: def.data.name, exerciseName, pairedSessions: pairs.length, deltaDiff, higherLabel, lowerLabel, line };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- D13-A/C: PLATEAU FLAGS -------------------------------------------------

/** Flat means no new best across this many sessions or more (tunable, per
 *  the build notes). */
export const PLATEAU_MIN_SESSIONS = 6;

export interface WhatChangedRow { label: string; flat: number; moving: number; unit?: string }

export interface PlateauFlag {
  flatSessions: number;
  peakDate: string;
  peakValue: number;
  currentValue: number;
  whatChanged: WhatChangedRow[];
}

/** Working sets logged for this exercise on this date (warmups and skipped
 *  chips excluded, LAW 16). */
function setsOn(workouts: Workout[], name: string, date: string): number | null {
  const w = workouts.find((x) => x.data.date === date);
  const ex = w?.data.exercises.find((e) => e.name === name);
  if (!ex || ex.skipped) return null;
  return ex.sets.filter((s) => !s.skipped && !s.warmup && scoreOf(ex.kind, s)).length;
}

/**
 * WHEN is computable; WHY is never claimed. Finds the most recent session
 * that was itself a new best (direction-aware), and flags a plateau when
 * PLATEAU_MIN_SESSIONS or more have passed since with no new best. The
 * what-changed receipt compares that flat stretch against an EQUAL-LENGTH
 * stretch immediately before the peak -- comparable sample sizes, and never
 * a claim about why, only what is different.
 */
export function plateauFlag(
  sessions: LiftSession[],
  kind: MeasureKind,
  exerciseName: string,
  workouts: Workout[],
  metrics: { def: MetricDef; logs: MetricLog[] }[] = [],
): PlateauFlag | null {
  if (sessions.length < PLATEAU_MIN_SESSIONS + 1) return null;
  const lowerWins = lowerWinsFor(kind);
  let peakIdx = 0;
  let peakVal = chartValue(sessions[0]!);
  for (let i = 1; i < sessions.length; i++) {
    const v = chartValue(sessions[i]!);
    if (lowerWins ? v < peakVal : v > peakVal) { peakVal = v; peakIdx = i; }
  }
  const flatCount = sessions.length - 1 - peakIdx;
  if (flatCount < PLATEAU_MIN_SESSIONS) return null;

  const flatWindow = sessions.slice(peakIdx + 1);
  const movingStart = Math.max(0, peakIdx + 1 - flatCount);
  const movingWindow = sessions.slice(movingStart, peakIdx + 1);

  const whatChanged: WhatChangedRow[] = [];

  const avgSets = (win: LiftSession[]) => {
    const counts = win.map((s) => setsOn(workouts, exerciseName, s.date)).filter((n): n is number => n != null);
    return counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : null;
  };
  const flatSets = avgSets(flatWindow), movingSets = avgSets(movingWindow);
  if (flatSets != null && movingSets != null) whatChanged.push({ label: "Sets a Session", flat: round1(flatSets), moving: round1(movingSets) });

  const avgGap = (win: LiftSession[]) => {
    if (win.length < 2) return null;
    let total = 0;
    for (let i = 1; i < win.length; i++) total += Math.abs(daysBetween(win[i - 1]!.date, win[i]!.date));
    return total / (win.length - 1);
  };
  const flatGap = avgGap(flatWindow), movingGap = avgGap(movingWindow);
  if (flatGap != null && movingGap != null) whatChanged.push({ label: "Days Between Sessions", flat: round1(flatGap), moving: round1(movingGap) });

  for (const { def, logs } of metrics) {
    const valuesIn = (win: LiftSession[]) => win
      .map((s) => numericValue(def.data, logs.find((l) => l.data.metricId === def.id && l.data.date === s.date)))
      .filter((v): v is number => v != null);
    const flatVals = valuesIn(flatWindow), movingVals = valuesIn(movingWindow);
    if (flatVals.length < 2 || movingVals.length < 2) continue; // not enough of THIS metric to compare, so it stays out rather than guessing
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    whatChanged.push({ label: def.data.name, flat: round1(mean(flatVals)), moving: round1(mean(movingVals)), unit: def.data.unit });
  }

  return {
    flatSessions: flatCount,
    peakDate: sessions[peakIdx]!.date,
    peakValue: peakVal,
    currentValue: chartValue(sessions[sessions.length - 1]!),
    whatChanged,
  };
}

// --- D13-C: PUBLISHED HARD-SET RANGE ---------------------------------------

export interface HardSetRow { muscle: MuscleGroup; sets: number; range: PublishedRange }

/** Program exercise name -> muscle, built once per render from the CURRENT
 *  program (muscleGroup is a program fact, catalog D13-C -- see
 *  gym/types.ts's Exercise.muscleGroup comment). A workout's own exercises
 *  never carry the tag, so every join here goes by name. */
export function muscleMapFromProgram(program: Program | null): Map<string, MuscleGroup> {
  const map = new Map<string, MuscleGroup>();
  if (!program) return map;
  for (const week of program.data.weeks) {
    for (const day of week.days) {
      for (const ex of day.exercises) {
        if (ex.muscleGroup) map.set(ex.name, ex.muscleGroup);
      }
    }
  }
  return map;
}

/**
 * This week's hard sets per muscle against the one published range,
 * rolling 7 days from `now` (D9's own bucketing convention). ZERO IS A
 * VERDICT (HEALTH_PREVIEW_SPEC bug list): a muscle with nothing logged this
 * week renders no row at all, never a "0 of 10-20" that reads as a miss.
 */
export function hardSetRows(workouts: Workout[], muscleByExercise: Map<string, MuscleGroup>, now: number = Date.now()): HardSetRow[] {
  const totals = new Map<MuscleGroup, number>();
  for (const w of workouts) {
    // Calendar-day-safe (see chartData.ts's daysAgo comment): a raw
    // now-vs-noon compare here used to drop TODAY's own session from this
    // week's count whenever it was checked before noon.
    const agoDays = daysAgo(w.data.date, now);
    if (agoDays < 0 || agoDays >= 7) continue;
    for (const ex of w.data.exercises) {
      if (ex.skipped) continue;
      const muscle = muscleByExercise.get(ex.name);
      if (!muscle) continue;
      const working = ex.sets.filter((s) => !s.skipped && !s.warmup && scoreOf(ex.kind, s)).length;
      if (working === 0) continue;
      totals.set(muscle, (totals.get(muscle) ?? 0) + working);
    }
  }
  return MUSCLE_GROUPS
    .filter((m) => (totals.get(m) ?? 0) > 0)
    .map((m) => ({ muscle: m, sets: totals.get(m)!, range: HARD_SET_RANGE }));
}

// --- D13-C: THE OFFER, NEVER A PRESCRIPTION --------------------------------

export interface BackOffSignal { grindsAndMisses: number; total: number }

/** How-it-moved marks (catalog §4.5) in the trailing window, counted only
 *  from sets the athlete actually marked -- an unmarked set says nothing, so
 *  it is excluded rather than assumed clean. */
export function backOffSignal(workouts: Workout[], now: number = Date.now(), days = 14): BackOffSignal | null {
  let bad = 0, total = 0;
  for (const w of workouts) {
    // Calendar-day-safe, same fix as hardSetRows above.
    const agoDays = daysAgo(w.data.date, now);
    if (agoDays < 0 || agoDays >= days) continue;
    for (const ex of w.data.exercises) {
      if (ex.skipped) continue;
      for (const s of ex.sets) {
        if (s.skipped || s.warmup || !s.moved) continue;
        total++;
        if (s.moved === "grind" || s.moved === "missed") bad++;
      }
    }
  }
  if (total < 6) return null; // too few marked sets to say anything at all
  return { grindsAndMisses: bad, total };
}

/** The share of marked sets that were a grind or a miss before the app will
 *  even OFFER a lighter week -- never a prescription, never automatic. */
export const BACK_OFF_OFFER_RATIO = 0.4;

export function shouldOfferLighterWeek(sig: BackOffSignal | null): boolean {
  return !!sig && sig.grindsAndMisses / sig.total >= BACK_OFF_OFFER_RATIO;
}

// Re-exported so a caller building a lift detail screen needs one import for
// the whole D9-D13 surface's session series.
export { liftSessions };
