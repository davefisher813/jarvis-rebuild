// THE COUNTDOWN LADDER (B1, approved 2026-08-20).
//
// JARVIS fired ONE alert, fifteen minutes out. That is a single moment you
// can be mid-something and miss, and then the event simply arrives.
//
// The clinical recommendation for time blindness is a ladder rather than a
// ping: alerts at 60, 30, 15 and 5 build the psychological reality of the
// event before it lands, so it stops being an abstraction and starts being a
// thing that is nearly happening. (Strong on the principle that time has to
// be externalised; the exact rungs are clinical convention, not trial-proven,
// and are stated as such wherever this is explained.)
//
// Laws:
//   - RUNGS ARE SKIPPED, NEVER STACKED. An event scheduled 20 minutes from
//     now gets the 15 and the 5, not four alerts at once. Firing a "60
//     minutes" alert for something happening in 20 is a lie.
//   - THE TONE CHANGES AS IT CLOSES. Sixty minutes out is information; five
//     minutes out is an instruction. Identical copy at every rung trains you
//     to ignore all of them.
//   - IT IS OFF FOR THE LADDER'S UPPER RUNGS BY DEFAULT ON SHORT EVENTS: a
//     fifteen-minute reminder does not need an hour of warning.

export const LADDER = [60, 30, 15, 5] as const;
export type Rung = (typeof LADDER)[number];

export interface LadderAlert {
  leadMin: Rung;
  title: string;
  body: string;
  atMs: number;
}

// Which rungs are real for an event this far away. Anything whose lead time
// has already passed is dropped rather than fired late.
export function rungsFor(minutesUntil: number): Rung[] {
  return LADDER.filter((r) => r < minutesUntil);
}

// The copy shifts from information to instruction as the event closes. This
// is the part that stops the ladder becoming four identical pings.
export function ladderBody(lead: Rung, where?: string): string {
  const place = where?.trim() ? " · " + where.trim() : "";
  if (lead === 60) return "In an hour" + place;
  if (lead === 30) return "In half an hour" + place;
  if (lead === 15) return "Fifteen minutes" + place;
  return "Leave what you're doing" + place;
}

export function buildLadder(
  title: string,
  startMs: number,
  nowMs: number,
  where?: string,
): LadderAlert[] {
  const minutesUntil = (startMs - nowMs) / 60000;
  return rungsFor(minutesUntil).map((leadMin) => ({
    leadMin,
    title,
    body: ladderBody(leadMin, where),
    atMs: startMs - leadMin * 60000,
  }));
}
