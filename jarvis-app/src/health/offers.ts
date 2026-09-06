// UP-ATH-10 (2026-09-06): AN OFFER IS A THING, NOT A SENTENCE.
//
// Every screen in this module ends in an offer (health rail 6), and every one
// of them handed its offer over as a STRING. HMN-F-06 wired that string to a
// task, which made the receipt honest but flattened five different actions
// into one: Add Wind Down, Place a Rest Block, Protect a Gap, Pack It and the
// pharmacy call all produced the same untimed row on a list. Protecting an
// hour tonight is not a to-do, and a rest day on Thursday is not one either.
//
// So an offer says what KIND of thing it is, and the wiring layer
// (brain/CategoryDetail's applyHealthOffer) makes that thing. The `line`
// rides along on every variant: it is the athlete's own words for the offer,
// it is what a task or a block gets named, and it is the fallback when the
// app cannot make the richer thing.
//
// Nothing in this file decides anything about a body. The offers are all
// calendar and list shapes; the health screens are what compute them.

export type HealthOffer =
  /** A protected block tonight, starting at `at`, so the wind-down is time
   *  the planner will not fill. */
  | { kind: "windDown"; at: number; line: string }
  /** A block on a day the week left open (twoDaysOff.ts's suggestedDate). */
  | { kind: "restDay"; date: string; line: string }
  /** The three-org day: an hour held between the commitments already on it.
   *  `date` is that local day; the wiring layer finds the gap on it. */
  | { kind: "protectGap"; date: string; orgs: string[]; line: string }
  /** A reminder that pings before a fixed thing, e.g. Pack It before leave
   *  time. `at` is when it should ping. */
  | { kind: "reminder"; at: number; line: string }
  /** Everything with no time and no day attached: it is a task, honestly. */
  | { kind: "task"; line: string };

/** The receipt each kind earns once the write lands. Sentence case: a toast
 *  talks. Deliberately says what was made, not that it was a good idea. */
export const OFFER_RECEIPT: Record<HealthOffer["kind"], string> = {
  windDown: "Wind Down added to your routine",
  restDay: "Rest day added to your calendar",
  protectGap: "Gap protected on your calendar",
  reminder: "Reminder set",
  task: "Added to your list",
};

/** What a wiring layer answers with when the offer really made something and
 *  the athlete can take it back. Returned instead of `true`; `false` still
 *  means the write failed and the receipt says so. */
export interface OfferUndo { undo: () => void }
