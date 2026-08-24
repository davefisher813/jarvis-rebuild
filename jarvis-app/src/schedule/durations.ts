// HOW LONG IS THIS (B5, 2026-08-23).
//
// The duration choices were declared twice: ProposedRow.tsx exported them and
// PlanDaySheet.tsx re-declared its own identical copy. Same list, same order,
// nothing keeping them the same, which is how two surfaces that must agree
// quietly stop agreeing.
//
// The decision this encodes is already recorded in PlanDaySheet: durations
// are CHIPS, not a stepper. 45m to 2h was five taps on a stepper and chips do
// it in one. shared/Stepper.tsx carries the other half of the same rule.
//
// The arithmetic deliberately does NOT live here. calendar.ts already owns
// every HH:MM operation in the app, including the midnight clamp, and a
// second copy of that in a file about durations is precisely the duplication
// this file exists to end. This module is the LIST and its labels; the clock
// stays where the clock lives.

import { addMinutes } from "./calendar";

export const DUR_CHOICES = [15, 30, 45, 60, 90, 120];

export const durLabel = (d: number): string =>
  d < 60 ? `${d}m` : d % 60 === 0 ? `${d / 60}h` : `${Math.floor(d / 60)}h ${d % 60}m`;

// Start plus a duration. calendar's addMinutes already clamps inside
// 00:00..23:59, so a block stretched past midnight stops at the end of the
// day rather than wrapping to a small number and sorting to the TOP of the
// list, reading as first thing in the morning.
export const endFor = (start: string, minutes: number): string => addMinutes(start, minutes);

export { minutesBetween } from "./calendar";
