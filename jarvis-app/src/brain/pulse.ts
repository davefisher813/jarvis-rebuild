import { numericValue, logOn, type MetricDef, type MetricLog } from "../gym/metrics";

// THE BRAIN READS THE PULSE (handoff item 11, second half of Dave's option A:
// "and let the Brain read them").
//
// The first half, grouping four library presets so they come on in one tap,
// is in gym/metrics.ts. This is the half that makes logging them worth doing.
//
// What was actually missing. Metric logs have been durable since D10-B and
// they are read by exactly two places: the gym's correlation insights and the
// Health area page's own tiles. Nothing in ai/, brain/ or review/ has ever
// seen one. So a user could log sleep and soreness every morning for a month
// and JARVIS would plan their day as if it had never been told. That is the
// same shape as the training window the detectors just picked up: the data
// was captured, durable, and read by nobody.
//
// THREE REFUSALS, all of them the health doctrine, not new rules:
//
//   NO SCORE. Each metric reports itself, in its own units. There is no
//   composite "readiness", no percentage, no single number standing for a
//   person. D10-B forbids it and this is exactly the surface that would be
//   tempted to invent one.
//
//   NO TARGET, NO VERDICT. The lines are counts and averages. Nothing says
//   low, poor, bad, or "you missed". A model reading "sleep 6.2 hrs" can
//   reason about it; a model reading "sleep: poor" has been handed a judgment
//   the app promised never to make.
//
//   SILENCE OVER GUESSING. A metric with too few days says nothing at all.
//   Absence is legal here (EMPTY IS LEGAL); a fabricated zero or an average
//   over two days is worse than no line.

/** Days of history the lines are computed over. A fortnight: long enough to
 *  survive a bad week, short enough to describe the person now. */
export const PULSE_WINDOW_DAYS = 14;

/** Below this many logged days in the window a metric says nothing. Three is
 *  the floor at which an average is a pattern rather than an anecdote, and it
 *  matches the floor the strand derivations already use. */
export const PULSE_MIN_DAYS = 3;

// LOCAL DAYS, NOT UTC ONES, and stepped with setDate rather than by
// subtracting milliseconds. Both halves matter: toISOString would hand back
// the previous day for every user east of UTC, and a fixed 86,400,000 would
// repeat or skip a day across a daylight-saving boundary. This is the same
// pair of bugs the 2026-09-04 audit found in schedule/calendar.ts and
// today/todayData.ts, so it is not repeated here.
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBack(today: string, n: number): string[] {
  const base = new Date(today + "T00:00:00");
  if (Number.isNaN(base.getTime())) return [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(isoOf(d));
  }
  return out;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

/**
 * One line per metric with enough history, in the metric's own units.
 *
 * Example output: "Sleep: 6.8 hrs on average over the last 12 days",
 * "Soreness: 3.4 out of 5 over the last 9 days".
 *
 * Hidden metrics are excluded. A hidden metric is one the user took off their
 * own strip, and quietly feeding it to the model anyway would make hiding a
 * lie about where the data goes.
 */
export function pulseLines(defs: MetricDef[], logs: MetricLog[], today: string): string[] {
  const days = daysBack(today, PULSE_WINDOW_DAYS);
  if (days.length === 0) return [];
  const out: string[] = [];
  for (const d of defs) {
    if (d.data.hidden) continue;
    const vals: number[] = [];
    for (const day of days) {
      const v = numericValue(d.data, logOn(logs, d.id, day));
      if (v != null) vals.push(v);
    }
    if (vals.length < PULSE_MIN_DAYS) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const n = vals.length;
    const over = `over the last ${n} ${n === 1 ? "day" : "days"}`;
    if (d.data.type === "yesno") {
      // A yes/no average is a rate, and reading it back as "0.4" would be
      // meaningless. It is reported as the count it actually is.
      const yes = vals.filter((v) => v === 1).length;
      out.push(`${d.data.name}: yes on ${yes} of ${n} logged ${n === 1 ? "day" : "days"}`);
    } else if (d.data.type === "scale5") {
      out.push(`${d.data.name}: ${trim(avg)} out of 5 ${over}`);
    } else if (d.data.type === "minutes") {
      out.push(`${d.data.name}: ${trim(avg)} minutes on average ${over}`);
    } else {
      out.push(`${d.data.name}: ${trim(avg)}${d.data.unit ? " " + d.data.unit : ""} on average ${over}`);
    }
  }
  return out;
}
