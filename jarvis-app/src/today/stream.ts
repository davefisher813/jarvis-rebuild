// FORM FOLLOWS DECISION (Law 3, option E, approved 2026-08-22).
//
// The reason Today read as noise was never the words: a failing task, a
// bookkeeping fact, and a learned insight all wore the same card, so the eye
// had to READ to triage. Form does the triage now:
//
//   - THE HEADLINER. Exactly one per visit: the highest-weight notice, in
//     big type with its verbs. Everything else physically defers to it.
//   - VERB ROWS. Every other actionable notice: one line, fact plus capsule.
//   - THE RECEIPT LINE. Notices that need nothing from him collapse into one
//     quiet mono line. Facts without decisions don't get furniture.
//
// The ranker's rule, approved with the law: a thing that is FAILING beats a
// thing that is WAITING beats a thing that is NEW. Producers pick the band;
// this module only sorts and cuts. Pure, so the law is testable.

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

export const FAILING = 90;   // sliding tasks, broken sweeps, an overloaded day
// THE DEALT TASK'S OWN WEIGHT (2026-08-26, Dave: "the logic behind all of
// this needs to be sound"). Your Move's dealt task was always MEANT to lead
// its band -- "added first so it leads its band... everything else defers"
// (Your Move, same day) -- but that was true only because it was spliced
// first into rankStream's input array and won the stable sort's
// arrival-order tie-break. Nothing enforced it; a future reordering of the
// concatenation would have silently dropped it behind a same-weight notice.
// A named weight above WAITING says outright what was already the design,
// so it holds no matter how the caller assembles the array.
export const DEALT = 71;
export const WAITING = 70;   // things waiting on him: revisits, slipped plans, money
export const NEW = 50;       // new arrivals: moved tasks, fresh offers
export const RESUME = 40;    // pick-up-where-you-left-off
const DEFAULT_WEIGHT = 30;
// AMBIENT ASKS (2026-08-26): opportunistic, no urgency of their own -- the
// weather permission offer is the only member today. It used to carry no
// weight at all, which meant it rode DEFAULT_WEIGHT by omission: correct by
// accident, indistinguishable from a producer that simply forgot to declare
// one. A named tier below the fallback makes "deliberately the least urgent
// thing in the stream" an explicit claim instead of a gap.
export const AMBIENT = 20;

export interface Ranked {
  headliner: ReactElement | null;
  rows: ReactElement[];
  receipts: ReactElement[];
}

export function rankStream(children: ReactNode): Ranked {
  const ranked: { el: ReactElement; w: number; i: number; anchor: boolean }[] = [];
  const receipts: ReactElement[] = [];
  let i = 0;
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const p = c.props as { weight?: number; receipt?: boolean; "data-receipt"?: unknown; anchor?: boolean };
    if (p.receipt || p["data-receipt"] !== undefined) { receipts.push(c); return; }
    // Stable sort by weight, arrival order breaking ties, so two same-band
    // notices keep the producer's own priority.
    ranked.push({ el: c, w: p.weight ?? DEFAULT_WEIGHT, i: i++, anchor: p.anchor === true });
  });
  const byWeight = (a: { w: number; i: number }, b: { w: number; i: number }) => b.w - a.w || a.i - b.i;

  // AN ANCHOR NEVER WEDGES (Dave 2026-08-26, from a screenshot: "I don't
  // want a task wedged in between 2 arrows"). Plain weight order put the
  // dealt task wherever its weight fell that day, and DEALT sits BETWEEN
  // WAITING and FAILING on purpose -- so on any day with one notice heavier
  // and one notice lighter than it, the task lands in the middle. That is
  // not a sorting bug, it is what a fixed point in the middle of a range
  // does; no amount of tie-break tuning fixes it, because it is not a tie.
  //
  // The rule an anchor gets instead: does ANYTHING here outrank it today?
  // If nothing does, it leads and every notice follows as one weight-sorted
  // block. If anything does, the whole block moves above it, not just the
  // one notice that outranks it, and the anchor trails. It sits at one
  // edge of the stream, never between two others; which edge is the only
  // thing the day decides.
  const anchor = ranked.find((r) => r.anchor);
  if (anchor) {
    const others = ranked.filter((r) => r !== anchor).sort(byWeight);
    const outranked = others.some((o) => o.w > anchor.w);
    const rows = outranked ? [...others, anchor] : [anchor, ...others];
    return { headliner: null, rows: rows.map((r) => r.el), receipts };
  }
  ranked.sort(byWeight);
  // EVERY NOTICE IS A ROW (Dave 2026-08-25, from a screenshot of three cards
  // at three heights: "Why are the heads up containers different sizes? They
  // should all be the size of update workout feature").
  //
  // The headliner is retired. It existed so the heaviest notice could
  // physically beat the others, and it had already been compressed once
  // ("THE HEADLINER PAYS RENT", 2026-08-22) after he asked twice in one day
  // why a notice was rendering so large. Compressing it again would be the
  // third pass at the same complaint.
  //
  // The emphasis it was buying is already free: this function SORTS by
  // weight, so the heaviest notice is the first thing under the head. Order
  // says "this one first" at no cost, and the headliner was spending about
  // 46px saying it a second time, in a shape that also put the verb on its
  // own line and made the most important notice the hardest to scan.
  //
  // A lone notice already rowed down for exactly this reason, which is the
  // same argument arriving one screenshot early.
  return { headliner: null, rows: ranked.map((r) => r.el), receipts };
}
