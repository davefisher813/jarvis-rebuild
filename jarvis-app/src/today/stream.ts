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
export const WAITING = 70;   // things waiting on him: revisits, slipped plans, money
export const NEW = 50;       // new arrivals: moved tasks, fresh offers
export const RESUME = 40;    // pick-up-where-you-left-off
const DEFAULT_WEIGHT = 30;

export interface Ranked {
  headliner: ReactElement | null;
  rows: ReactElement[];
  receipts: ReactElement[];
}

export function rankStream(children: ReactNode): Ranked {
  const ranked: { el: ReactElement; w: number; i: number }[] = [];
  const receipts: ReactElement[] = [];
  let i = 0;
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const p = c.props as { weight?: number; receipt?: boolean; "data-receipt"?: unknown };
    if (p.receipt || p["data-receipt"] !== undefined) { receipts.push(c); return; }
    // Stable sort by weight, arrival order breaking ties, so two same-band
    // notices keep the producer's own priority.
    ranked.push({ el: c, w: p.weight ?? DEFAULT_WEIGHT, i: i++ });
  });
  ranked.sort((a, b) => b.w - a.w || a.i - b.i);
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
