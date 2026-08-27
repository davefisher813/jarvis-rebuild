// REFILL RUNWAY (catalog Part 4, ranked top 3). Pure functions, no Store.
//
// Counts down remaining doses in the CURRENT fill by counting real Took It
// taps since the fill started -- never a stored countdown field, so there is
// only ever one place doses are counted from, and "remaining" is inventory
// arithmetic on events that happened, not a fraction of anything undone.
//
// The catalog is explicit that this lands the pharmacy call as a task on the
// PARENT's list, never a badge on the athlete's. This file only computes the
// fact; refillOffer() below hands back the plain sentence a caller turns
// into that task, and never suggests a dose or a drug.

import type { MedRefillEntry, TookItEntry } from "./types";

export interface RefillState {
  hasFill: boolean;
  dosesInFill: number;
  taken: number; // Took It taps since this fill started
  remaining: number; // dosesInFill - taken, floored at 0
  // Average taps per day since the fill started, once there is at least one
  // day of real data to average over; undefined otherwise (no guess offered
  // on day one of a new fill).
  paceDosesPerDay?: number;
  // A projection FROM the observed pace, in whole days, rounded down. Absent
  // whenever there is no pace to project from.
  runwayDays?: number;
}

const MS_PER_DAY = 86400000;

/** The most recently started fill, or null if none has been logged yet. */
function currentFill(refills: MedRefillEntry[]): MedRefillEntry | null {
  if (refills.length === 0) return null;
  return refills.reduce((a, b) => (b.data.filledAt > a.data.filledAt ? b : a));
}

export function refillRunway(refills: MedRefillEntry[], tookIt: TookItEntry[], now: number = Date.now()): RefillState {
  const fill = currentFill(refills);
  if (!fill) return { hasFill: false, dosesInFill: 0, taken: 0, remaining: 0 };
  const taken = tookIt.filter((t) => t.data.at >= fill.data.filledAt && t.data.at <= now).length;
  const remaining = Math.max(0, fill.data.dosesInFill - taken);
  const daysElapsed = Math.max(0, (now - fill.data.filledAt) / MS_PER_DAY);
  if (daysElapsed < 1 || taken === 0) {
    return { hasFill: true, dosesInFill: fill.data.dosesInFill, taken, remaining };
  }
  const paceDosesPerDay = taken / daysElapsed;
  const runwayDays = paceDosesPerDay > 0 ? Math.floor(remaining / paceDosesPerDay) : undefined;
  return { hasFill: true, dosesInFill: fill.data.dosesInFill, taken, remaining, paceDosesPerDay, runwayDays };
}

// A call is worth landing on the parent's list once the runway is short
// enough that a shortage could land on top of a real week -- a fixed, small
// horizon rather than a percentage of the fill, so a 90-count fill and a
// 30-count fill both get the call at the same real-world notice.
export const REFILL_CALL_WITHIN_DAYS = 5;
export const REFILL_CALL_WITHIN_DOSES = 5;

export function needsRefillCall(state: RefillState): boolean {
  if (!state.hasFill) return false;
  if (state.remaining <= REFILL_CALL_WITHIN_DOSES) return true;
  return state.runwayDays !== undefined && state.runwayDays <= REFILL_CALL_WITHIN_DAYS;
}

/** The plain sentence a caller lands on the parent's list. Pure logistics:
 *  names the errand, never the medication, the dose, or a suggestion. */
export function refillOffer(state: RefillState): string | null {
  if (!needsRefillCall(state)) return null;
  return "Call the pharmacy about the next refill";
}
