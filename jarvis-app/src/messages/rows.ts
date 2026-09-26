// HOW A ROW SAYS IT WANTS YOU (E3 + E5, 2026-08-24).
//
// THE RAIL. Three things used to occupy the row's left column or its badge
// slot: an unread dot, an age number, and a tone color on that number. One
// element carries all of it now, in the vocabulary the schedule already
// taught: solid means real and pressing, hollow means quiet.
//
// Its colours are the Colour Key's (§AM, settled 2026-09-26). Unread has no
// key colour, so solid against hollow carries it; heat is solid in the key's
// ink and outranks unread.
//
//   solid white    unread, and nothing else known about urgency
//   amber          due soon: a deadline the sender stated (today through
//                  this week), or waiting weeks
//   red            overdue: a wait past the point another email helps
//   hollow         read and calm
//
// A stated deadline is DUE, never LATE. byRank cannot tell a date that
// passed yesterday from today (both rank 0), so a triaged row never earns
// red; only the ladder's firm tone, which does know, is overdue.
//
// ONE AUTHORITY PER SECTION, deliberately. A waiting row's heat comes from
// the escalation ladder's tone (decideFor), because that is what picks the
// verb printed beside it; a second threshold set here could disagree with
// the button on its own row. A triaged row's heat comes from byRank on the
// deadline the SENDER stated, which is the same ranking that orders the
// section. This file converts those judgements to paint; it makes none.
//
// THE BANDS. Grouping Waiting On by age answers "which of these are the same
// kind of decision" without printing a number on every row. The thresholds
// are the ones Today's mail notices already use (7 and 21 days), plus 30
// for the pile old enough that email itself stopped being the tool.

import { byRank } from "./triage";

export type RailTone = "hot" | "warm" | null;

// Waiting rows: the ladder's tone, translated. Firm (past the point another
// email helps) is overdue, red; direct (a week or more, or already nudged)
// is due, amber; gentle is calm.
export function railToneForWaiting(tone: string): RailTone {
  return tone === "firm" ? "hot" : tone === "direct" ? "warm" : null;
}

// Triaged rows: the sender's stated deadline, translated. byRank returns 0-1
// for today/tomorrow (and 0 for a date that passed yesterday, which it
// cannot tell from today), single digits for named days this week, 500 for
// unreadable, 900 for "no rush"; only real nearness earns heat, and that
// heat is due (amber), never late (red).
export function railToneForDeadline(by: string | undefined, now = new Date()): RailTone {
  if (!by) return null;
  const r = byRank(by, now);
  if (r <= 7) return "warm";
  return null;
}

// The rail's full class string. `wants` = solid (unread, or any heat).
export function railClass(unread: boolean, tone: RailTone): string {
  const solid = unread || tone !== null;
  return "msg-rail" + (solid ? " on" : "") + (tone ? " " + tone : "");
}

export interface AgeBand<T> { label: string; rows: T[] }

// Oldest first, which is the order the section already sorts in.
const BANDS: { min: number; label: string }[] = [
  { min: 30, label: "Over a Month" },
  { min: 21, label: "Weeks Now" },
  { min: 7, label: "Past a Week" },
  { min: 0, label: "Recent" },
];

export function ageBands<T>(rows: T[], days: (r: T) => number): AgeBand<T>[] {
  const out: AgeBand<T>[] = [];
  for (const { min, label } of BANDS) {
    const hit = rows.filter((r) => days(r) >= min && !out.some((b) => b.rows.includes(r)));
    if (hit.length) out.push({ label, rows: hit });
  }
  return out;
}

// Heads are information, not decoration: one band means the label would be
// restating the section, so it renders bare.
export function showBandHeads<T>(bands: AgeBand<T>[]): boolean {
  return bands.length > 1;
}
