import type { MetricLog } from "./metrics";
import { capAfterNumber } from "../shared/casing";

// A GOAL ON A READING (Dave 2026-09-12, from the Health category page: "I
// had said I wanted actual health goals elsewhere... wherever you can enter
// data would be a better idea. So like the list of exercises there's a goal
// option. When you enter your weight there's an option").
//
// D12-A/C already answered this for the bar: a lift goal is set on the lift
// (gym/goalMeasures.ts's LiftMeasure), not from a generic dashboard sheet.
// This is the same idea for a metric like bodyweight -- "reach 180 lb" is
// not a count of completions or a cadence, it is one reading somewhere in
// the log that meets or beats a number, read off MetricLog[] the way
// LiftMeasure reads Workout[]. Same shape as every measure in
// bigger/measure.ts: a plain object, a pure state function, no store of its
// own.
//
// PRIVACY: this rides gym/metrics.ts's D10-B override, not health/'s
// vocabulary law -- a user's own metric, with the user's own number on it,
// the identical idea LiftMeasure already carries for "225 lb x 5". Nothing
// here is a readiness score or an app-issued expectation; `target` is the
// same field name LiftMeasure already uses for exactly that reason.

export type MetricDirection = "up" | "down";

export interface MetricMeasure {
  kind: "metric";
  metricId: string;
  /** Stamped at creation, the same reason LiftMeasure stamps `exercise`: a
   *  goal set on "Bodyweight" still names what it is about if the metric is
   *  later renamed or hidden (HIDE, NEVER DELETE). */
  metricName: string;
  unit?: string;
  /** "up" to reach a number from below (a step count, a lift number some
   *  other app tracks as a metric), "down" to reach it from above (losing
   *  weight). Chosen once, at creation. */
  direction: MetricDirection;
  target: number;
  /** The reading logged when the goal was set, stamped once and kept as-is
   *  through an edit (the same rule count's `since` follows). Without a
   *  baseline, a goal moving the wrong way from a big starting number has no
   *  honest percentage to show: "14 of 20 lb gone" needs to know there WERE
   *  20 lb to go. Absent when nothing had been logged yet when the goal was
   *  set; the state then reports the reading against the target and claims
   *  no percentage rather than inventing a start. */
  startValue?: number;
}

export interface MetricMeasureState { done: number; target: number; met: boolean; pct: number; line: string }

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * Pure function of the metric's own logs, same contract as
 * liftMeasureState/trainingMeasureState in gym/goalMeasures.ts: no store,
 * nothing async, reads the whole log list and finds today's own answer.
 */
export function metricMeasureState(m: MetricMeasure, logs: MetricLog[]): MetricMeasureState {
  const mine = logs.filter((l) => l.data.metricId === m.metricId).sort((a, b) => a.data.date.localeCompare(b.data.date));
  const latest = mine[mine.length - 1];
  const current = latest?.data.value;
  const unitTxt = m.unit ? ` ${m.unit}` : "";

  if (current == null) {
    return {
      done: 0, target: m.target, met: false, pct: 0,
      line: capAfterNumber(`Log ${m.metricName.toLowerCase()} to track it toward ${fmtNum(m.target)}${unitTxt}`),
    };
  }

  const met = m.direction === "up" ? current >= m.target : current <= m.target;
  const line = capAfterNumber(`${fmtNum(current)} of ${fmtNum(m.target)}${unitTxt}`);

  // No baseline, or a baseline that already sat past the target (the
  // direction changed, or the goal was set after the fact against a number
  // already on the far side): the reading against the target is the honest
  // thing to say, and pct only ever claims 0 or 100 -- there is no "share of
  // the distance closed" without a real start to close it from.
  const span = m.startValue == null ? 0 : m.direction === "up" ? m.target - m.startValue : m.startValue - m.target;
  if (m.startValue == null || span <= 0) {
    return { done: current, target: m.target, met, pct: met ? 100 : 0, line };
  }

  const moved = m.direction === "up" ? current - m.startValue : m.startValue - current;
  const pct = Math.max(0, Math.min(100, Math.round((moved / span) * 100)));
  return { done: current, target: m.target, met, pct, line };
}
