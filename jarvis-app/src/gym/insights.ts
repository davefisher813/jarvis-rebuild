import type { Workout, MeasureKind, Program } from "./types";
import { scoreOf } from "./measures";
import { sameLiftAnyKind, type LiftLike } from "./identity";
import { liftSessions, chartValue, daysAgo, type LiftSession } from "./chartData";
import { numericValue, type MetricDef, type MetricLog } from "./metrics";
import { MUSCLE_GROUPS, HARD_SET_RANGE, type MuscleGroup, type PublishedRange } from "./muscles";
import { readClass } from "./classify";
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

// THE EVIDENCE BEHIND A FINDING (Part 3 wave 3, 2026-09-13; Dave's answers
// 11a and 12a). Every finding this file produces now carries its own
// receipt: what kind of finding it is, the dates it read, how many records,
// how the number was made, what it shows and does not show, and the minimum
// it had to clear. Nothing new is computed; the derivation that already made
// the number writes down what it did. And every minimum in this file is a
// named constant with its reason beside it, so none of them is a threshold
// anyone has to take on faith, and nothing short of one is ever a guess.
export type FindingLabel = "Observation" | "Exploratory Pattern" | "Program Comparison";

export interface Minimum { name: string; value: number; reason: string }

export const MINIMUMS = {
  pairedSessions: { name: "Paired sessions", value: INSIGHT_MIN_PAIRED, reason: "fewer than ten same-day pairs is noise dressed as a pattern" } as Minimum,
  groupSide: { name: "Sessions on each side", value: INSIGHT_MIN_GROUP, reason: "a split with one or two days on a side says nothing about that side" } as Minimum,
  plateauSessions: { name: "Sessions without a new best", value: 6, reason: "a short flat stretch is an ordinary week, not a plateau" } as Minimum,
  backOffShare: { name: "Share of marked sets that ground or missed", value: 0.4, reason: "under that, a hard set is a hard set and not a trend" } as Minimum,
};

export interface Evidence {
  label: FindingLabel;
  from: string; // local ISO day
  to: string;
  records: number;
  method: string;
  supports: string;
  doesNot: string;
  minimum?: Minimum;
  /** 2026-09-14: a counting rule this app chose, where the cited work does
   *  not settle it. Named separately from `method` so a convention is never
   *  read as a finding. */
  convention?: string;
}

/** How close a metric and a lift are to the paired-session minimum, for the
 *  honest "not enough days yet" line. Null once the minimum is met (the card
 *  itself speaks then) or when there is nothing paired at all. */
export function correlationProgress(sessions: LiftSession[], kind: MeasureKind, def: MetricDef, logs: MetricLog[]): { paired: number; needed: number } | null {
  const paired = pairedDeltas(sessions, kind, logs, def).length;
  if (paired === 0 || paired >= INSIGHT_MIN_PAIRED) return null;
  return { paired, needed: INSIGHT_MIN_PAIRED };
}

export interface CorrelationInsight {
  metricName: string;
  exerciseName: string;
  pairedSessions: number;
  evidence: Evidence;
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
    `${sign}${round1(deltaDiff)} per session on ${higherLabel} days vs ${lowerLabel}, over ${pairs.length} paired sessions (Correlation, not cause)`,
  );
  const evidence: Evidence = {
    label: "Exploratory Pattern",
    from: sessions[1]?.date ?? sessions[0]!.date,
    to: sessions[sessions.length - 1]!.date,
    records: pairs.length,
    method: `Change in ${exerciseName} from one session to the next, paired with ${def.data.name} logged the same day, split at your own median`,
    supports: `A difference in how ${exerciseName} moved on ${higherLabel} days against ${lowerLabel} days`,
    doesNot: "Cause, or what to change",
    minimum: MINIMUMS.pairedSessions,
  };
  return { metricName: def.data.name, exerciseName, pairedSessions: pairs.length, deltaDiff, higherLabel, lowerLabel, line, evidence };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- D13-A/C: PLATEAU FLAGS -------------------------------------------------

/** Flat means no new best across this many sessions or more (tunable, per
 *  the build notes). The reason sits in MINIMUMS.plateauSessions. */
export const PLATEAU_MIN_SESSIONS = MINIMUMS.plateauSessions.value;

export interface WhatChangedRow { label: string; flat: number; moving: number; unit?: string }

export interface PlateauFlag {
  flatSessions: number;
  peakDate: string;
  peakValue: number;
  currentValue: number;
  whatChanged: WhatChangedRow[];
  evidence: Evidence;
}

/** Working sets logged for this exercise on this date (warmups and skipped
 *  chips excluded, LAW 16).
 *
 *  GYM-F-30 (2026-09-05): it took the FIRST workout on the date and stopped,
 *  so a day with two sessions (a backdated log landing on a day that already
 *  had one, or the same lift trained twice) had half its work invisible to
 *  the plateau card's "Sets a session" row. Every workout on that day counts;
 *  null still means the lift is not in that day at all, which is what keeps
 *  the row from claiming a zero. */
function setsOn(workouts: Workout[], lift: LiftLike, date: string): number | null {
  let total: number | null = null;
  for (const w of workouts) {
    if (w.data.date !== date) continue;
    const ex = w.data.exercises.find((e) => sameLiftAnyKind(lift, e));
    if (!ex || ex.skipped) continue;
    total = (total ?? 0) + ex.sets.filter((s) => !s.skipped && !s.warmup && !s.drop && scoreOf(ex.kind, s)).length;
  }
  return total;
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
  // GYM-F-04 (2026-09-05): the lift, not just its current name, so a rename
  // does not cost the plateau card its series.
  exerciseName: LiftLike,
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
    evidence: {
      label: "Observation",
      from: sessions[movingStart]!.date,
      to: sessions[sessions.length - 1]!.date,
      records: sessions.length - movingStart,
      method: `The best session, then every session since with no new best, set against the equal stretch before the best`,
      supports: "That the number has not moved, and what else differed between the two stretches",
      doesNot: "Why, or what to change",
      minimum: MINIMUMS.plateauSessions,
    },
  };
}

// --- D13-C: PUBLISHED HARD-SET RANGE ---------------------------------------

export interface HardSetRow { muscle: MuscleGroup; sets: number; range: PublishedRange }

/** The Weekly Volume card's receipt: one for the card, since every row is
 *  the same seven-day count against the same band. */
export function hardSetEvidence(rows: HardSetRow[], now: number = Date.now(), band?: PublishedRange): Evidence {
  const day = (ms: number) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  return {
    label: "Program Comparison",
    from: day(now - 6 * 86400000),
    to: day(now),
    records: rows.reduce((n, r) => n + r.sets, 0),
    method: "Working sets in the last 7 days per muscle, warm-ups and drops left out, against the band",
    supports: "Where each muscle's weekly sets sit against " + (band ? "your own band" : "the studied range"),
    doesNot: "Whether that is right for you this week",
    // 2026-09-14. The half is OURS, not the meta-analysis's, and saying so
    // belongs in the receipt rather than in a footnote nobody opens. The
    // cited work counts sets per muscle and does not settle how a row's
    // biceps should be counted; splitting the difference is a convention.
    // The row's own label, Our Convention, already says whose rule this
    // is, so the value is the rule alone (§AM R6, 2026-09-26: it carried a
    // second clause after a baked middot that only restated the label).
    convention: "First muscle a whole set, the others half",
  };
}

// --- WHAT IS BEHIND THE NUMBER ---------------------------------------------

export interface VolumeLift { name: string; exerciseKey?: string; sets: number; date: string; primary: boolean }

/**
 * THE LIFTS BEHIND ONE MUSCLE'S WEEKLY COUNT (Dave, 2026-09-14: "insights are
 * providing virtually nothing and I can't even click on them").
 *
 * A bare "Quads 6" is a number with nowhere to go: it cannot be checked,
 * argued with, or acted on, and if it looks wrong there is no way to find out
 * why. This is the receipt in the literal sense -- which lift, on which day,
 * for how many sets, and whether it counted whole or half. Newest first,
 * because the question behind the tap is almost always "what have I done
 * lately".
 */
export function volumeBreakdown(
  workouts: Workout[],
  muscleByExercise: MuscleMap,
  muscle: MuscleGroup,
  now: number = Date.now(),
): VolumeLift[] {
  const out: VolumeLift[] = [];
  for (const w of workouts) {
    const agoDays = daysAgo(w.data.date, now);
    if (agoDays < 0 || agoDays >= 7) continue;
    for (const ex of w.data.exercises) {
      if (ex.skipped) continue;
      const roles = rolesFor(muscleByExercise, ex, w.data.date);
      const isPrimary = roles.primary.includes(muscle);
      if (!isPrimary && !roles.secondary.includes(muscle)) continue;
      const working = ex.sets.filter((s) => !s.skipped && !s.warmup && !s.drop && scoreOf(ex.kind, s)).length;
      if (working === 0) continue;
      out.push({
        name: ex.name,
        ...(ex.exerciseKey ? { exerciseKey: ex.exerciseKey } : {}),
        sets: isPrimary ? working : working / 2,
        date: w.data.date,
        primary: isPrimary,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.sets - a.sets);
}

export interface CoverageGap {
  /** Lifts trained in the last 7 days that carry no muscle at all. */
  untagged: { name: string; exerciseKey?: string; sets: number }[];
  /** Working sets those lifts account for, and which Weekly Volume therefore
   *  cannot see. */
  hiddenSets: number;
  /** Lifts trained this week that DO carry a muscle, for the ratio. */
  tagged: number;
}

/**
 * WHY THE CARD IS THIN.
 *
 * Weekly Volume has one hard requirement -- a lift has to be tagged with a
 * muscle by hand -- and when almost nothing is tagged it renders one row and
 * says nothing about the silence. From the outside that reads as "insights
 * are providing virtually nothing"; from the inside it is a feature waiting
 * on a two-tap setup nobody was ever asked for.
 *
 * So the app says so. This is not a finding about training, it is a finding
 * about the app's own blind spot, and it is the one insight that is useful on
 * day one and useless by design once the work is done: with nothing untagged
 * it returns null and the card never appears again.
 */
export function coverageGap(
  workouts: Workout[],
  muscleByExercise: MuscleMap,
  now: number = Date.now(),
): CoverageGap | null {
  const untagged = new Map<string, { name: string; exerciseKey?: string; sets: number }>();
  let tagged = 0;
  for (const w of workouts) {
    const agoDays = daysAgo(w.data.date, now);
    if (agoDays < 0 || agoDays >= 7) continue;
    for (const ex of w.data.exercises) {
      if (ex.skipped) continue;
      const working = ex.sets.filter((s) => !s.skipped && !s.warmup && !s.drop && scoreOf(ex.kind, s)).length;
      if (working === 0) continue;
      const roles = rolesFor(muscleByExercise, ex, w.data.date);
      if (roles.primary.length + roles.secondary.length > 0) { tagged++; continue; }
      const id = ex.exerciseKey ?? ex.name;
      const prev = untagged.get(id);
      untagged.set(id, {
        name: ex.name,
        ...(ex.exerciseKey ? { exerciseKey: ex.exerciseKey } : {}),
        sets: (prev?.sets ?? 0) + working,
      });
    }
  }
  if (untagged.size === 0) return null;
  const list = [...untagged.values()].sort((a, b) => b.sets - a.sets);
  return { untagged: list, hiddenSets: list.reduce((n, x) => n + x.sets, 0), tagged };
}

/** A lift's muscles, as two named roles plus the window the assignment
 *  speaks for. 2026-09-14 second pass: PRIMARY IS A LIST. "Multiple primary
 *  muscles. Multiple secondary muscles. Clearly distinguish primary from
 *  secondary" -- a deadlift has more than one prime mover, and the old
 *  position-carries-the-meaning array could not say so. */
export interface MuscleRoles {
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
  /** classify.ts's scope window. A set logged outside it does not carry
   *  these muscles, which is what makes a "from here on" correction real
   *  rather than a label on a radio button. */
  from?: string;
  until?: string;
}

/** A lift's muscles: the primary first, then whatever else it works.
 *  Keyed by library key where there is one, and by name only as a fallback,
 *  which is the join the weekly row used to have to make for everything.
 *
 *  The bare array is the OLD shape and still legal everywhere: first entry
 *  primary, the rest secondary, which is exactly what it always meant. Every
 *  read goes through asRoles, so one call site had to change rather than
 *  twenty, and nothing that built a map before this reads differently now. */
export type MuscleEntry = MuscleGroup[] | MuscleRoles;
export type MuscleMap = Map<string, MuscleEntry>;

const NO_ROLES: MuscleRoles = { primary: [], secondary: [] };

/** One reading of either shape. */
export function asRoles(e: MuscleEntry | undefined): MuscleRoles {
  if (!e) return NO_ROLES;
  if (Array.isArray(e)) return { primary: e.slice(0, 1), secondary: e.slice(1) };
  return e;
}

/** Does this assignment speak for a record logged on `date`? Same rule as
 *  classify.coversDate, kept here so insights.ts stays readable on its own. */
function inScope(r: MuscleRoles, date: string): boolean {
  if (r.from && date < r.from) return false;
  if (r.until && date > r.until) return false;
  return true;
}

/** The roles for one logged exercise: by library key first, by name second
 *  (a lift that predates the library has no key), and nothing at all when
 *  the assignment does not cover the day this was logged. */
export function rolesFor(map: MuscleMap, ex: { name: string; exerciseKey?: string }, date: string): MuscleRoles {
  const found = (ex.exerciseKey ? map.get(ex.exerciseKey) : undefined) ?? map.get(ex.name);
  const roles = asRoles(found);
  return inScope(roles, date) ? roles : NO_ROLES;
}

/**
 * WHICH MUSCLES A LIFT WORKS, from every place the athlete can say so.
 *
 * Until 2026-09-14 this read one field on one program's exercises, which
 * meant a lift tagged in an archived program, added mid-session, or simply
 * renamed contributed nothing, and the Weekly Volume card sat at one row
 * saying almost nothing (Dave: "insights are providing virtually nothing").
 * Three fixes, all here:
 *
 *   - EVERY program is read, not `programs[0]`;
 *   - the per-lift tags set on Your Lifts (settings.muscleByKey) are read
 *     too, and they win, because they are keyed to the lift's stable
 *     identity and so survive a rename that silently emptied the old map;
 *   - a lift can work SEVERAL muscles, which is how bodies work.
 *
 * Both the library key and the name are indexed, so a logged workout joins
 * by key when it has one and by name when it does not.
 */
export function muscleMapFrom(
  programs: Program[],
  muscleByKey: Record<string, string[]> = {},
  classByKey: Record<string, unknown> = {},
): MuscleMap {
  const map: MuscleMap = new Map();
  const put = (k: string | undefined, v: MuscleEntry) => {
    if (!k) return;
    const r = asRoles(v);
    if (r.primary.length + r.secondary.length) map.set(k, v);
  };
  for (const program of programs) {
    for (const week of program.data.weeks) {
      for (const day of week.days) {
        for (const ex of day.exercises) {
          if (!ex.muscleGroup) continue;
          put(ex.name, [ex.muscleGroup]);
          put(ex.exerciseKey, [ex.muscleGroup]);
        }
      }
    }
  }
  // The per-lift tags are the athlete's most deliberate statement of this,
  // so they overwrite anything a program day happens to say.
  for (const [key, list] of Object.entries(muscleByKey)) {
    const clean = list.filter((m): m is MuscleGroup => (MUSCLE_GROUPS as readonly string[]).includes(m));
    put(key, clean);
  }
  // And the full classification wins over both: it is the same statement
  // said in the newer shape, with primary as a LIST and with the scope
  // window the athlete picked when they corrected it. Read through
  // classify.readClass, so a hand-edited or older blob cannot put a value in
  // here that no menu can show. Still hand-set, still never inferred from
  // the name -- see LAW 18.
  for (const [key, raw] of Object.entries(classByKey)) {
    const c = readClass(raw);
    put(key, {
      primary: c.primary,
      secondary: c.secondary,
      ...(c.from ? { from: c.from } : {}),
      ...(c.until ? { until: c.until } : {}),
    });
  }
  return map;
}

/** The old single-program, single-muscle builder, kept so existing callers
 *  and tests keep working. Prefer muscleMapFrom above. */
export function muscleMapFromProgram(program: Program | null): MuscleMap {
  return muscleMapFrom(program ? [program] : []);
}

/**
 * This week's hard sets per muscle against the one published range,
 * rolling 7 days from `now` (D9's own bucketing convention). ZERO IS A
 * VERDICT (HEALTH_PREVIEW_SPEC bug list): a muscle with nothing logged this
 * week renders no row at all, never a "0 of 10-20" that reads as a miss.
 */
export function hardSetRows(workouts: Workout[], muscleByExercise: MuscleMap, now: number = Date.now(), range: PublishedRange = HARD_SET_RANGE): HardSetRow[] {
  const totals = new Map<MuscleGroup, number>();
  for (const w of workouts) {
    // Calendar-day-safe (see chartData.ts's daysAgo comment): a raw
    // now-vs-noon compare here used to drop TODAY's own session from this
    // week's count whenever it was checked before noon.
    const agoDays = daysAgo(w.data.date, now);
    if (agoDays < 0 || agoDays >= 7) continue;
    for (const ex of w.data.exercises) {
      if (ex.skipped) continue;
      // By key first, by name second (2026-09-14): a lift that has been
      // renamed keeps its tags, which the name-only join could not do.
      const roles = rolesFor(muscleByExercise, ex, w.data.date);
      if (roles.primary.length + roles.secondary.length === 0) continue;
      const working = ex.sets.filter((s) => !s.skipped && !s.warmup && !s.drop && scoreOf(ex.kind, s)).length;
      if (working === 0) continue;
      // DIRECT SETS COUNT WHOLE, INDIRECT COUNT HALF. A row is a back
      // exercise that also works biceps, and calling those biceps sets whole
      // would have anyone who rows twice a week reading 20+ biceps sets they
      // never did. The half is a COUNTING CONVENTION and is labelled as one
      // in the card's Evidence -- it is not part of the cited meta-analysis,
      // which counts sets per muscle without settling this question.
      //
      // AND NO SET IS EVER COUNTED TWICE (handoff §4: "Do not count a set
      // multiple times in total working-set counts"). These are PER-MUSCLE
      // totals: one set of rows puts a whole set under Back and half a set
      // under Biceps, and the session still contains exactly one set. The
      // sum down this column is not a set count and is never rendered as
      // one -- the exercise's own working-set number is.
      for (const m of roles.primary) totals.set(m, (totals.get(m) ?? 0) + working);
      for (const m of roles.secondary) {
        if (roles.primary.includes(m)) continue;
        totals.set(m, (totals.get(m) ?? 0) + working / 2);
      }
    }
  }
  return MUSCLE_GROUPS
    .filter((m) => (totals.get(m) ?? 0) > 0)
    // The studied range by default; the band he set in Health Settings when
    // he set one (Dave 2026-09-13: nothing hard wired that should not be).
    .map((m) => ({ muscle: m, sets: Math.round(totals.get(m)! * 2) / 2, range }));
}

// --- D13-C: THE OFFER, NEVER A PRESCRIPTION --------------------------------

export interface BackOffSignal { grindsAndMisses: number; total: number; evidence: Evidence }

/** How-it-moved marks (catalog §4.5) in the trailing window, counted only
 *  from sets the athlete actually marked -- an unmarked set says nothing, so
 *  it is excluded rather than assumed clean. */
function dayOf(ms: number): string {
  const d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function backOffSignal(workouts: Workout[], now: number = Date.now(), days = 14): BackOffSignal | null {
  let bad = 0, total = 0;
  for (const w of workouts) {
    // Calendar-day-safe, same fix as hardSetRows above.
    const agoDays = daysAgo(w.data.date, now);
    if (agoDays < 0 || agoDays >= days) continue;
    for (const ex of w.data.exercises) {
      if (ex.skipped) continue;
      for (const s of ex.sets) {
        if (s.skipped || s.warmup || s.drop || !s.moved) continue;
        total++;
        if (s.moved === "grind" || s.moved === "missed") bad++;
      }
    }
  }
  if (total < 6) return null; // too few marked sets to say anything at all
  return {
    evidence: {
      label: "Observation",
      from: dayOf(now - days * 86400000),
      to: dayOf(now),
      records: total,
      method: `Marked working sets in the last ${days} days, counting the ones marked a grind or a miss`,
      supports: "How many recent hard sets were marked hard",
      doesNot: "Fatigue, illness or anything else about how you are; only what you marked",
      minimum: MINIMUMS.backOffShare,
    }, grindsAndMisses: bad, total };
}

/** The share of marked sets that were a grind or a miss before the app will
 *  even OFFER a lighter week -- never a prescription, never automatic. */
export const BACK_OFF_OFFER_RATIO = MINIMUMS.backOffShare.value;

export function shouldOfferLighterWeek(sig: BackOffSignal | null): boolean {
  return !!sig && sig.grindsAndMisses / sig.total >= BACK_OFF_OFFER_RATIO;
}

// Re-exported so a caller building a lift detail screen needs one import for
// the whole D9-D13 surface's session series.
export { liftSessions };
