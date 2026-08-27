// THE NIGHT BEFORE (catalog Part 1, top-5). Reads tomorrow's first fixed
// calendar commitment and offers a real bedtime the evening before -- never
// states a shortfall. This file computes ONE thing: a wind-down time, backed
// out from the earliest commitment by a fixed target, clamped to something
// achievable. It never renders "you'll only get N hours"; the screen built
// on this only ever shows the offer.

export interface FixedCommitment {
  title: string;
  at: number; // epoch ms the commitment starts
}

export interface NightBeforeOffer {
  commitmentTitle: string;
  commitmentAt: number;
  windDownAt: number; // the offered wind-down time
}

// Adolescents need 8-10 hours (catalog Part 1, citing the sleep literature).
// The offer backs out from the LOW end of that range plus a getting-ready
// buffer, so the number is a floor to protect, never an ideal to chase.
export const TARGET_SLEEP_HOURS = 8;
export const WIND_DOWN_BUFFER_MIN = 30;

/** The earliest commitment strictly after `now`, or null if the calendar has
 *  nothing fixed coming up -- in which case there is nothing to offer. */
export function firstFixedCommitment(commitments: FixedCommitment[], now: number): FixedCommitment | null {
  const upcoming = commitments.filter((c) => c.at > now);
  if (upcoming.length === 0) return null;
  return upcoming.reduce((a, b) => (b.at < a.at ? b : a));
}

/** The wind-down offer for tomorrow's earliest commitment. Pure backward
 *  arithmetic: commitment time minus (target sleep + getting-ready buffer),
 *  the exact thing the catalog says a 15-year-old cannot reliably do in
 *  their head at 10:40pm. Returns null when there is no fixed commitment to
 *  anchor on -- an unanchored bedtime offer would just be a guess. */
export function nightBeforeOffer(commitments: FixedCommitment[], now: number): NightBeforeOffer | null {
  const first = firstFixedCommitment(commitments, now);
  if (!first) return null;
  const windDownAt = first.at - TARGET_SLEEP_HOURS * 3600000 - WIND_DOWN_BUFFER_MIN * 60000;
  return { commitmentTitle: first.title, commitmentAt: first.at, windDownAt };
}
