import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import type { GoalReach } from "./reach";
import { daysBetween } from "../upnext/upnext";
import { capAfterNumber } from "../shared/casing";

// ---------------------------------------------------------------------------
// A GOAL WITH A FINISH LINE (Dave's picks 13, 14, 15, built 2026-08-24).
//
// "Run three times a week" had no idea what three times a week meant. "Read
// twelve books" did not know about twelve. Every goal in the app was a title
// and a bar derived from whatever tasks happened to sit under it, so a goal
// could be at 100% of its tasks and nowhere near the thing it named.
//
// Four finish lines, and each is DERIVED from evidence the app already has:
//   count     a number of things done       ("read 12 books")
//   cadence   N times per week or month     ("run 3 times a week")
//   projects  every project under it done   ("ship the launch")
//   amount    a dollar target               (Money v1's moneyTarget, older
//             than this module and left exactly where it is)
//
// THE HISTORY PROBLEM, AND WHY `since` EXISTS
// Architecture C established that a tag may never feed done/total, because an
// ordinary task carries no completion date and a freshly tagged goal would
// inherit every task in that category ever closed. A count measure has the
// same exposure from the other direction: set "read 12 books" on a goal that
// watches Reading and it would open at 40 of 12. So a count measure stamps
// the day it was set and counts TAGGED completions from that day forward,
// using the Time Sense samples that already carry timestamps. Filed work
// counts in full, because filing a task under a project is deliberate.
//
// Cadence needs no stamp: a window is a window.
// Projects needs no stamp: the record itself says done or not.
// ---------------------------------------------------------------------------

export type Cadence = "week" | "month";

export interface CountMeasure { kind: "count"; target: number; since?: string }
export interface CadenceMeasure { kind: "cadence"; times: number; per: Cadence }
export interface ProjectsMeasure { kind: "projects" }
export type Measure = CountMeasure | CadenceMeasure | ProjectsMeasure;

export const CADENCE_LABEL: Record<Cadence, string> = { week: "Week", month: "Month" };

export interface MeasureState {
  done: number;
  target: number;
  pct: number;      // 0-100
  met: boolean;
  /** The one honest line. Never a percentage of an invented denominator. */
  line: string;
}

export interface MeasureContext {
  reach: GoalReach;
  tasks: TaskItem[];
  projects: Project[];   // filed under this goal
  /** Time Sense completions. Device-local: absence is not evidence of absence. */
  samples: { id?: string; t: number }[];
  today: string;
  now: number;
}

const DAY = 86400000;

/** Start of the cadence window holding `now`. Weeks run Monday to Sunday. */
export function windowStart(per: Cadence, now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (per === "month") { d.setDate(1); return d.getTime(); }
  const dow = d.getDay();              // 0 Sun .. 6 Sat
  const back = dow === 0 ? 6 : dow - 1; // Monday-first
  return d.getTime() - back * DAY;
}

/** Task ids this goal reaches, both routes. */
export function reachedIds(reach: GoalReach): Set<string> {
  return new Set([...reach.filedIds, ...reach.taggedIds]);
}

/**
 * How many of this goal's tasks were completed inside [from, now]. Counts only
 * what Time Sense actually SAW, which is the whole reason a cadence measure
 * can be trusted: it is evidence, not a status.
 */
export function completionsIn(ctx: MeasureContext, from: number): number {
  const ids = reachedIds(ctx.reach);
  let n = 0;
  for (const s of ctx.samples) {
    if (!s.id || s.t < from || s.t > ctx.now) continue;
    if (ids.has(s.id)) n++;
  }
  return n;
}

export function measureState(m: Measure | undefined, ctx: MeasureContext): MeasureState | null {
  if (!m) return null;

  if (m.kind === "cadence") {
    const done = completionsIn(ctx, windowStart(m.per, ctx.now));
    const target = Math.max(1, m.times);
    const met = done >= target;
    return {
      done, target, met,
      pct: Math.min(100, Math.round((done / target) * 100)),
      line: capAfterNumber(`${done} of ${target} this ${m.per}`),
    };
  }

  if (m.kind === "projects") {
    const target = ctx.projects.length;
    if (target === 0) return { done: 0, target: 0, pct: 0, met: false, line: "No projects under it yet" };
    const done = ctx.projects.filter((p) => p.data.status === "done").length;
    return {
      done, target, met: done >= target,
      pct: Math.round((done / target) * 100),
      line: capAfterNumber(`${done} of ${target} projects done`),
    };
  }

  // count: filed completions in full, tagged completions from `since` forward.
  const target = Math.max(1, m.target);
  const filedDone = ctx.reach.progress?.done ?? 0;
  let taggedDone = 0;
  if (m.since) {
    const from = new Date(m.since + "T00:00:00").getTime();
    const tagged = new Set(ctx.reach.taggedIds);
    for (const s of ctx.samples) {
      if (!s.id || s.t < from || s.t > ctx.now) continue;
      if (tagged.has(s.id)) taggedDone++;
    }
  }
  const done = filedDone + taggedDone;
  // TO-DATE FOR NEW GOALS, TO-GO FOR COMMITTED ONES (Life View pick 8,
  // 2026-08-25). While commitment is still forming, what is banked proves
  // the goal is real; once it is established, what remains creates the pull
  // that finishes it (Koo & Fishbach 2008). The measure's own `since` stamp
  // is the age; a measure without one keeps the neutral line.
  const line = (() => {
    if (done >= target) return capAfterNumber(`${done} of ${target} done`);
    if (m.since) {
      const age = (ctx.now - new Date(m.since + "T00:00:00").getTime()) / 86400000;
      if (age < COMMIT_DAYS) {
        if (done > 0) return capAfterNumber(`${done} done already`);
      } else {
        return capAfterNumber(`${target - done} to go`);
      }
    }
    return capAfterNumber(`${done} of ${target} done`);
  })();
  return {
    done, target, met: done >= target,
    pct: Math.min(100, Math.round((done / target) * 100)),
    line,
  };
}

// --- PICK 14: A GOAL WITH A DATE ------------------------------------------
//
// A date on its own is a wish. A date plus a finish line is arithmetic, and
// arithmetic is the only thing that can tell him on a Tuesday in September
// whether December is still real.

/**
 * The pace line, or null when there is nothing to pace: no date, no measure,
 * already met, or a cadence goal (a cadence has no end, it has a rhythm).
 */
export function paceLine(
  state: MeasureState | null,
  m: Measure | undefined,
  by: string | undefined,
  today: string,
): string | null {
  if (!by || !state || !m || m.kind === "cadence") return null;
  if (state.met) return null;
  const left = state.target - state.done;
  const days = daysBetween(today, by);
  // Each segment is phrased so the number-lead law reads as English. "2 a
  // week" becomes "2 A week" under the rule, and "6 days left" becomes
  // "6 Days left", which is the capitalized UNIT the rule's own exemption
  // list exists to avoid. Leading with a word instead costs nothing.
  if (days < 0) return capAfterNumber(`${left} to go · Past its date`);
  if (days === 0) return capAfterNumber(`${left} to go · Due today`);
  if (days === 1) return capAfterNumber(`${left} to go · Due tomorrow`);
  if (days <= 14) return capAfterNumber(`${left} to go · Due in ${days} days`);
  const weeks = days / 7;
  const per = Math.ceil((left / weeks) * 10) / 10;
  const rate = Number.isInteger(per) ? String(per) : per.toFixed(1);
  return capAfterNumber(`${left} to go · About ${rate} a week`);
}

// --- PICK 15: HEALTH IS DERIVED, NEVER TYPED ------------------------------
//
// GoalData.state has held "on_track" since Session 6 and nothing has ever
// updated it: it is whatever the goal was created with, months ago. A
// self-reported dashboard decays into confident nonsense, which is the oldest
// rule on this surface, and this was the last place still breaking it.
//
// Nothing here is written back to the record. It is computed at read time
// from the same evidence everything else on the page uses.

export type Health = "done" | "on_track" | "behind" | "idle" | "unmeasured";

export const HEALTH_LABEL: Record<Health, string> = {
  done: "Done", on_track: "On Track", behind: "Behind", idle: "Idle", unmeasured: "No Measure",
};
// Reuses the fact classes the app already ships; invents no colour.
export const HEALTH_CLASS: Record<Health, string> = {
  done: "fact-good", on_track: "fact-good", behind: "fact-warn", idle: "fact-warn", unmeasured: "",
};

/** Days before a young measure starts speaking to-go instead of to-date. */
export const COMMIT_DAYS = 21;

/** Days without a seen completion before a goal with open work reads idle. */
export const IDLE_DAYS = 14;

export function healthOf(
  goal: Goal,
  state: MeasureState | null,
  m: Measure | undefined,
  ctx: MeasureContext,
  openWork: number,
): Health {
  if (goal.data.state === "achieved") return "done";
  if (state?.met) return "done";

  // Behind is only claimable against a date AND a finish line. Without both,
  // there is no pace to be behind of, and saying so would be a guess.
  if (goal.data.by && state && m && m.kind !== "cadence" && state.target > 0) {
    const total = state.target;
    const days = daysBetween(ctx.today, goal.data.by);
    if (days < 0) return "behind";
    // Straight-line: the share of the run that should be finished by now is
    // unknowable without a start, so this compares what is LEFT against what
    // is left of the time, in the same unit.
    const left = total - state.done;
    if (days > 0 && left > 0) {
      const needPerDay = left / days;
      const seenPerDay = seenRate(ctx);
      if (seenPerDay > 0 && seenPerDay < needPerDay * 0.6) return "behind";
    }
  }

  // A cadence goal is behind when the window is more than half gone and it is
  // not yet half done. Nothing else about a rhythm can be late.
  if (m?.kind === "cadence" && state) {
    const from = windowStart(m.per, ctx.now);
    const span = m.per === "week" ? 7 * DAY : 30 * DAY;
    const through = (ctx.now - from) / span;
    if (through > 0.5 && state.done / state.target < through - 0.2) return "behind";
  }

  if (openWork === 0 && !state) return "unmeasured";
  if (idle(ctx)) return "idle";
  if (!state) return "unmeasured";
  return "on_track";
}

/** Completions per day this goal has actually been seen making, last 28 days. */
export function seenRate(ctx: MeasureContext): number {
  const from = ctx.now - 28 * DAY;
  return completionsIn(ctx, from) / 28;
}

/**
 * True with POSITIVE evidence of neglect: the goal reaches work, Time Sense
 * has seen completions on it before, and the latest is older than IDLE_DAYS.
 * Silence with no history says nothing, exactly as isStalled does for
 * projects: absence of evidence on a device-local log is not evidence.
 */
export function idle(ctx: MeasureContext): boolean {
  const ids = reachedIds(ctx.reach);
  if (ids.size === 0) return false;
  let latest = 0;
  for (const s of ctx.samples) {
    if (s.id && ids.has(s.id) && s.t > latest) latest = s.t;
  }
  if (latest === 0) return false;
  return ctx.now - latest > IDLE_DAYS * DAY;
}

/** The measure in words, for the edit sheet and the goal's eyebrow. */
export function measureLabel(m: Measure | undefined, moneyTarget?: number): string {
  if (moneyTarget) return "Dollar Target";
  if (!m) return "No Finish Line";
  if (m.kind === "count") return capAfterNumber(`${m.target} to Finish`);
  if (m.kind === "cadence") return capAfterNumber(`${m.times} a ${m.per}`);
  return "Every Project Done";
}

/**
 * PICK 28: the one line the Brain is told about a goal.
 *
 * The AI context has sent `Run three times a week (on_track)` since Session 5,
 * where "on_track" is the stored state nothing has ever updated: the model has
 * been reasoning about statuses that were typed once, months ago. It gets the
 * DERIVED reading now, plus the finish line, which is the half that lets it say
 * something useful instead of something agreeable.
 */
export function goalStatusForAI(health: Health, state: MeasureState | null): string {
  const label = HEALTH_LABEL[health].toLowerCase();
  return state ? `${label}, ${state.line.toLowerCase()}` : label;
}
