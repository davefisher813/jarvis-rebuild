import type { PlanRecord } from "../events/planOutcome";

// THE FINISH RATE (P4, Dave 2026-08-20).
//
// The sheet used to say "Lately · 2 of 7 picks done same-day". That is a
// number telling him he is failing, sitting directly above the thing he is
// about to fail at again, with no way to act on it.
//
// The same measurement pointed forward is a setting: if two a day is what
// actually happens, plan two and stop pretending. Nobody with ADHD needs a
// scoreboard. They need the plan to match the person.
//
// Laws:
//   - Silent until there is enough evidence to be fair. Three scored picks is
//     noise; the offer needs a fortnight of real days behind it.
//   - It never says a number under one. "Plan zero tasks" is not advice.
//   - It is an OFFER, never applied on its own. The cap he chooses is his.

export const CAP_MIN_PICKS = 6;

export interface CapOffer {
  n: number;      // the number of picks his history supports
  title: string;
  sub: string;
}

// Picks per plan that actually got done the same day, rounded to a whole
// task. Rounding is deliberately generous (half rounds up): the app should
// never lowball what someone is capable of on the evidence.
export function finishRate(r: PlanRecord, plans: number): number | null {
  if (r.picks < CAP_MIN_PICKS || plans <= 0) return null;
  const per = r.done / plans;
  if (per < 0.5) return null; // under one a day: nothing kind to say here
  return Math.max(1, Math.round(per));
}

const WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];

export function capOffer(r: PlanRecord, plans: number): CapOffer | null {
  const n = finishRate(r, plans);
  if (n === null) return null;
  const w = WORD[n] ?? String(n);
  return {
    n,
    title: `You Finish About ${w.charAt(0).toUpperCase() + w.slice(1)} a Day`,
    sub: `Want me to plan for ${w} and leave the rest?`,
  };
}
