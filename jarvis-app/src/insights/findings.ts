import type { Workout, WorkoutExercise, MeasureKind } from "../gym/types";
import type { MetricDef, MetricLog } from "../gym/metrics";
import { chartableExercises } from "../gym/chartData";
import { liftRef, sameLift } from "../gym/identity";
import { loadStyleOf, comparable, type LoadStyle } from "../gym/equipment";
import { coverageGap, type MuscleMap } from "../gym/insights";
import { capAfterNumber } from "../shared/casing";
import { isWorkingSet, periodOverview, previousPeriod, hoursLabel, type Period } from "./analytics";
import { monthDay } from "../money/bills";

// YOUR PROGRESS (the approved Health design, 2026-09-14, "Your progress":
// up to three useful, clickable findings, in this order: a meaningful change
// in recorded performance, an observation the data supports, a data issue
// that stops the analysis being right). Every finding is a deterministic
// read of the records and opens the records behind it. Nothing here claims
// a cause.

export interface LiftId { name: string; exerciseKey?: string; kind: MeasureKind; unit?: string; timeUnit?: string }

/** A load change at the SAME rep count on the same lift, counted the same
 *  way, in the same unit (item 5: "+10 lb at 5 reps" needs all four). */
export interface RepGain {
  lift: LiftId;
  reps: number;
  from: { w: number; date: string; workoutId: string };
  to: { w: number; date: string; workoutId: string };
  /** Sessions that hold a working set at this rep count, counted this way. */
  sessions: number;
  delta: number;
}

interface SessionBest { workoutId: string; date: string; w: number; style: LoadStyle; unit?: string }

/** Per session, the best working weight at each rep count. */
function bestByReps(workouts: Workout[], lift: LiftId): Map<number, SessionBest[]> {
  const ref = liftRef(lift, lift.kind);
  const sorted = [...workouts].sort((a, b) => a.data.date.localeCompare(b.data.date) || a.data.startedAt - b.data.startedAt);
  const out = new Map<number, SessionBest[]>();
  for (const w of sorted) {
    const ex = w.data.exercises.find((e: WorkoutExercise) => sameLift(ref, e));
    if (!ex || ex.skipped || ex.kind !== "weight_reps") continue;
    const style = loadStyleOf(ex);
    const best = new Map<number, number>();
    for (const s of ex.sets) {
      if (!isWorkingSet(ex, s) || s.w == null || s.r == null || s.r <= 0) continue;
      best.set(s.r, Math.max(best.get(s.r) ?? -Infinity, s.w));
    }
    for (const [r, wgt] of best) {
      const list = out.get(r) ?? [];
      list.push({ workoutId: w.id, date: w.data.date, w: wgt, style, unit: ex.unit });
      out.set(r, list);
    }
  }
  return out;
}

/** Item 5: the same equipment context as well as the same counting. Two
 *  machines are two contexts; an unnamed equipment compares with anything so
 *  nothing logged before the menu existed goes quiet. */
export function sameContext(a: LoadStyle, b: LoadStyle): boolean {
  if (!comparable(a, b)) return false;
  if (a.equipment == null || b.equipment == null) return true;
  return a.equipment === b.equipment;
}

/** The latest session's best comparable change on this lift, or null when
 *  no rep count has a second comparable session to measure against. */
export function comparableGain(workouts: Workout[], lift: LiftId): RepGain | null {
  const byReps = bestByReps(workouts, lift);
  let pick: RepGain | null = null;
  for (const [reps, all] of byReps) {
    const latest = all[all.length - 1]!;
    // Only sessions counted the same way and logged in the same unit as the
    // latest one compare; a change of machine or of kg for lb is not a gain.
    const same = all.filter((s) => sameContext(s.style, latest.style) && (s.unit ?? "lb") === (latest.unit ?? "lb"));
    if (same.length < 2) continue;
    const first = same[0]!;
    const gain: RepGain = { lift, reps, from: { w: first.w, date: first.date, workoutId: first.workoutId }, to: { w: latest.w, date: latest.date, workoutId: latest.workoutId }, sessions: same.length, delta: latest.w - first.w };
    if (!pick || gain.sessions > pick.sessions || (gain.sessions === pick.sessions && Math.abs(gain.delta) > Math.abs(pick.delta))) pick = gain;
  }
  return pick;
}

export type FindingOpen =
  | { kind: "lift"; lift: LiftId }
  | { kind: "sleep" }
  | { kind: "sets" }
  | { kind: "assign" }
  | { kind: "duration"; workoutId: string }
  | { kind: "insights" };

export interface Finding {
  id: string;
  kind: "change" | "observation" | "issue";
  hue: "lime" | "amber" | "violet" | "cyan";
  title: string;
  /** The reading, in the finding's hue. */
  value: string;
  /** Dates, sample size, coverage: the row's own facts, ONE PER ENTRY.
   *
   *  2026-09-16 (Dave's Health screenshot). This was a single string with
   *  middots baked into it, which broke the same contract twice over.
   *  components.css: "Adjacent facts are separated by a middle dot the CSS
   *  draws, so no string ever carries one" -- and one long string cannot
   *  wrap the way a row of facts does, so on his phone it either ran off the
   *  end ("6 compa...") or wrapped and left the dot leading the new line
   *  ("· 3 exercises"), which is what he photographed. An array is the shape
   *  the .facts line was always asking for. */
  context: string[];
  open: FindingOpen;
}

export interface FindingsInput {
  workouts: Workout[];
  sleepDef: MetricDef | null;
  logs: MetricLog[];
  period: Period;
  muscleMap: MuscleMap;
  now?: number;
}

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(n);

// TWO LINES, WHICH IS WHAT A ROW GETS (2026-09-16, Dave on the Health
// overview: "too much grey subtext. Looks extremely cluttered and breaks 4
// lines rule"). Each of these ran to four: the name, the reading and a fact,
// a second fact wrapped onto its own line, and then an action label under
// that. Contract 4.1 gives a row two lines and no third.
//
// So the context is ONE fact, and the one kept is the one the finding is
// ABOUT -- the change, the coverage, the date. What went is sample size
// (comparable sessions, workouts, "Last 7 days"), which is not lost: it is on
// the page this row opens, stated in full and with room to read it.
//
// The action label went with them. Every one of these rows is already a door
// with a chevron on it, so a cyan "View Sets" under the facts was a second
// way to say the same thing, taking a whole line to say it.
export function findings(inp: FindingsInput): Finding[] {
  const out: Finding[] = [];
  const now = inp.now ?? Date.now();
  const overview = periodOverview(inp.workouts, inp.sleepDef, inp.logs, inp.period);

  // 1. A change in recorded performance, on a lift trained inside the period.
  let bestGain: RepGain | null = null;
  for (const ex of chartableExercises(inp.workouts)) {
    if (ex.kind !== "weight_reps") continue;
    const g = comparableGain(inp.workouts, ex);
    if (!g || g.delta === 0) continue;
    if (g.to.date < inp.period.from || g.to.date > inp.period.to) continue;
    if (!bestGain || g.sessions > bestGain.sessions || (g.sessions === bestGain.sessions && Math.abs(g.delta) > Math.abs(bestGain.delta))) bestGain = g;
  }
  if (bestGain) {
    const u = bestGain.lift.unit ?? "lb";
    out.push({
      id: "gain-" + (bestGain.lift.exerciseKey ?? bestGain.lift.name),
      kind: "change", hue: "lime",
      title: bestGain.lift.name,
      value: `${bestGain.to.w} ${u} × ${bestGain.reps}`,
      context: [`${sign(bestGain.delta)} ${u} since ${monthDay(bestGain.from.date)}`],
      open: { kind: "lift", lift: bestGain.lift },
    });
  }

  // 2. An observation the records support: sleep over logged nights, else
  //    working sets against the period before.
  if (overview.sleep.nights >= 3 && overview.sleep.avgHours != null) {
    out.push({
      // Lime, the Health key's logged ink: an average over nights he logged.
      // Violet means a budget or a pair, and sleep is neither (§AM).
      id: "sleep", kind: "observation", hue: "lime",
      title: "Sleep",
      value: hoursLabel(overview.sleep.avgHours),
      context: [capAfterNumber(`${overview.sleep.nights} of ${overview.period.days} nights logged`)],
      open: { kind: "sleep" },
    });
  } else if (overview.workingSets > 0) {
    const prev = periodOverview(inp.workouts, inp.sleepDef, inp.logs, previousPeriod(inp.period));
    const diff = overview.workingSets - prev.workingSets;
    out.push({
      id: "sets", kind: "observation", hue: "lime",
      title: "Working Sets",
      value: String(overview.workingSets),
      context: prev.workouts > 0
        ? [`${sign(diff)} on the ${overview.period.days} before`]
        : [capAfterNumber(`${overview.workouts} ${overview.workouts === 1 ? "workout" : "workouts"}`)],
      open: { kind: "sets" },
    });
  }

  // 3. A data issue that stops the analysis being right.
  const gap = coverageGap(inp.workouts, inp.muscleMap, now);
  if (gap) {
    out.push({
      id: "coverage", kind: "issue", hue: "amber",
      title: "Complete Your Muscle Breakdown",
      value: capAfterNumber(`${gap.hiddenSets} ${gap.hiddenSets === 1 ? "set needs" : "sets need"} a muscle assigned`),
      context: [capAfterNumber(`${gap.untagged.length} ${gap.untagged.length === 1 ? "exercise" : "exercises"}`)],
      open: { kind: "assign" },
    });
  } else if (overview.flagged.length > 0) {
    const w = overview.flagged[0]!;
    out.push({
      id: "duration-" + w.id, kind: "issue", hue: "amber",
      title: "A Session Duration Needs Review",
      value: w.data.dayName,
      context: overview.flagged.length === 1
        ? [monthDay(w.data.date)]
        : [capAfterNumber(`${overview.flagged.length} sessions`)],
      open: { kind: "duration", workoutId: w.id },
    });
  }
  return out.slice(0, 3);
}
