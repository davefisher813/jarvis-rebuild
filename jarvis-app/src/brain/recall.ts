import type { Strand } from "./strands/types";

// STRENGTHEN AND FADE (Brain build handoff item 9, spec 5.8, decision m1).
//
// This one had a note waiting for it in the code. strands/types.ts, written
// 2026-08-24, says of lastConfirmed:
//
//   "Nothing expires. No code anywhere reads this date and acts on it, and a
//    strand from March is exactly as loud today as one confirmed this
//    morning. Corrected rather than implemented because an expiry policy is a
//    decision about JARVIS quietly forgetting things it was told, and how
//    long is long enough is Dave's call, not a number to invent in a type."
//
// Dave made that call on 2026-08-31 (m1, "facts strengthen with use, fade
// without it: BUILD IT"), so the field gets its reader. The handoff's own
// wording is the specification, and both halves of it are refusals:
//
//   "a fact that keeps proving useful gains retrieval priority; a fact
//    unconfirmed for months fades toward a re-confirm question, NEVER a
//    silent deletion, NEVER a silent staleness."
//
// So fading is a change of ORDER plus a QUESTION. Nothing is ever removed
// here, and nothing goes quiet without saying so. The one number I had to
// choose is below, named and alone, because it is the part of this that is a
// judgement rather than a mechanism.

/**
 * How long a fact sits unconfirmed before JARVIS asks whether it still holds.
 *
 * The handoff says "months", which is a floor of two. Ninety days is a
 * season: long enough that a quiet fact is genuinely quiet rather than merely
 * unmentioned, short enough that a life change surfaces the same quarter it
 * happens. It errs toward not asking, which is the direction this app errs in
 * everywhere else.
 *
 * This is the one invented number in the feature. Changing it is a one-line
 * change, and nothing else in this file depends on its value.
 */
export const FADE_AFTER_DAYS = 90;

const DAY_MS = 86400000;

/** Whole days between two local YYYY-MM-DD dates, midnight-anchored both sides. */
export function daysSince(iso: string, today: string): number {
  const a = Date.parse(iso + "T00:00:00");
  const b = Date.parse(today + "T00:00:00");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

// Source rank, the Aug 3 doctrine, unchanged: told is EARNED (typed, or
// corrected in the app) and outranks watched; asked is a half-attention
// self-report that watched data may later challenge.
const SOURCE_RANK: Record<string, number> = { told: 3, watched: 2, uploaded: 1, asked: 0 };

/**
 * Strength right now: higher is louder.
 *
 * Two inputs, both already in the record, neither of them new schema:
 *   - what KIND of fact it is (a rule the user stated outranks a pattern
 *     JARVIS noticed, which outranks something they half-answered once), and
 *   - how recently it was confirmed.
 *
 * The decay is deliberately gentle and bounded. A fact never falls below its
 * own floor, so an old told fact still outranks a fresh asked one: age
 * reorders within a rank, it does not overturn the doctrine.
 */
export function strengthOf(s: Strand, today: string): number {
  const base = SOURCE_RANK[s.data.source] ?? 0;
  const age = daysSince(s.data.lastConfirmed, today);
  // Full weight for the first month, then sliding to half over the fade
  // window. Bounded at 0.5 so the floor above holds.
  const freshness = age <= 30 ? 1 : Math.max(0.5, 1 - (age - 30) / (FADE_AFTER_DAYS * 2));
  return base + freshness;
}

/**
 * The order facts are read to the AI in.
 *
 * Retrieval priority is the whole of "strengthen" (5.8): the context builder
 * takes them in this order, so what JARVIS leans on first is what has most
 * recently been proved right, not simply what was typed most recently.
 * Ties keep the existing newest-first order, so this can only ever reorder
 * within a genuine tie-break, never shuffle equal facts around at random.
 */
export function rankForRecall(strands: Strand[], today: string): Strand[] {
  return [...strands].sort((a, b) => {
    const d = strengthOf(b, today) - strengthOf(a, today);
    if (Math.abs(d) > 1e-9) return d;
    return b.data.createdAt.localeCompare(a.data.createdAt);
  });
}

/**
 * The facts that have gone quiet long enough to be worth asking about.
 *
 * Oldest first: if several are due, the one that has been unconfirmed
 * longest is the one worth a question. WATCHED facts only by default is
 * tempting and wrong -- a told fact can go stale too ("family dinner is
 * non-negotiable" survives a house move or it does not), and asking is
 * cheap while silently trusting a dead fact is not.
 *
 * Paused strands are excluded: the user already told JARVIS to stop using
 * that one, and asking whether a paused fact still holds is a nag about a
 * decision they already made.
 */
export function fadedStrands(strands: Strand[], today: string): Strand[] {
  return strands
    .filter((s) => s.data.status === "active")
    .filter((s) => daysSince(s.data.lastConfirmed, today) >= FADE_AFTER_DAYS)
    .sort((a, b) => a.data.lastConfirmed.localeCompare(b.data.lastConfirmed));
}
