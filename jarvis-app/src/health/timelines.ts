// TIMELINES, NOT FRACTIONS (Part 9, rail 2: no count of failures). Pure
// functions, no Store, no React: every aggregate view in this module reads
// through one of these rather than hand-rolling a done/total computation at
// the screen. That is what makes "never a fraction like 2 of 6" and "never
// you missed N doses" a property of the code path, not a reminder in a
// comment nobody re-reads six months later.
//
// The shared shape is a MARK: one entry per event that happened, with
// nothing implying how many did not. There is no `total` field anywhere in
// this file, on purpose. A screen that wants "how many did I answer" has to
// compute it itself from the marks it was actually handed, in plain sight,
// which is a very different thing from this module handing it a ratio.

import type { AteBeforeData, AteBeforeEntry, CallItEntry, PointAtItEntry, TookItEntry } from "./types";
import { daysBetween } from "../upnext/upnext";

// ---- Ate Before: marks on a timeline, never "2 of 6" ----

export interface AteBeforeMark {
  eventId?: string;
  eventTitle?: string;
  date: string;
  ate: boolean;
}

/** Sorted by date. Rendering is the caller's job (a dot per mark, colored by
 *  `ate`); this function only ever hands back one row per answered event. */
export function ateBeforeMarks(entries: AteBeforeEntry[]): AteBeforeMark[] {
  return entries
    .map((e): AteBeforeMark => ({ eventId: e.data.eventId, eventTitle: e.data.eventTitle, date: e.data.date, ate: e.data.ate }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The one summary line this module allows: which days carry an unanswered
 *  event next to them is fine to say ("3 marked") because it counts what
 *  HAPPENED, same as the rest of this file. There is deliberately no sibling
 *  function that also takes a total; pairing the two is how "3 of 6" gets
 *  built by accident at a call site. */
export function ateBeforeCountLine(marks: AteBeforeMark[]): string {
  const yes = marks.filter((m) => m.ate).length;
  // Built, never a digit-leading literal, so the number-lead-capital law
  // never has to fire here: "Day Marked Eaten" and "Days Marked Eaten" are
  // already correctly cased words, and the count is prepended at runtime.
  return yes + (yes === 1 ? " Day Marked Eaten" : " Days Marked Eaten");
}

export function ateBeforeForDate(entries: AteBeforeEntry[], date: string): AteBeforeData | undefined {
  return entries.find((e) => e.data.date === date)?.data;
}

// ---- Took It: a plain timeline, never a count of misses ----

export interface TookItMark {
  date: string; // local ISO day
  at: number;
}

/** There is no schedule concept anywhere near this function's input, so
 *  there is nothing to diff a tap against and nothing that could ever read
 *  as "missed". It answers exactly one question: when did a tap happen. */
export function tookItTimeline(entries: TookItEntry[]): TookItMark[] {
  return entries
    .map((e): TookItMark => ({ date: localDay(e.data.at), at: e.data.at }))
    .sort((a, b) => a.at - b.at);
}

// ---- Call It: plain history, feeds nothing else ----

export interface CallItPoint {
  at: number;
  rpe: number;
  durationMin?: number;
}

/** The catalog is explicit: session-RPE "feeds Week Shape and nothing else."
 *  This function is the "nothing else" part held to its word -- it returns
 *  the raw points in order and computes no rolling average, no trend, no
 *  readiness-shaped anything from them. */
export function callItHistory(entries: CallItEntry[]): CallItPoint[] {
  return entries
    .map((e): CallItPoint => ({ at: e.data.at, rpe: e.data.rpe, durationMin: e.data.durationMin }))
    .sort((a, b) => a.at - b.at);
}

// ---- Point at It: "Still There?" pattern, never a diagnosis ----

export interface StillTherePattern {
  // A rounded coordinate key, not a body-part name: naming the part in
  // English risks reading as a diagnosis ("ankle" nudges toward "sprained
  // ankle"). The screen may translate this into a plain-language spot label
  // for display, but the pattern detector itself stays coordinate-only.
  spotKey: string;
  side: "front" | "back";
  sessions: number; // distinct days the same spot was tapped
  days: number; // span from first tap to last, inclusive
  firstAt: number;
  lastAt: number;
}

// Same-spot means within this normalized distance of a previous tap. Coarse
// on purpose: a body map tapped one-handed will never land pixel-identical
// twice, and the point of this feature is noticing a PATTERN, not matching
// exact coordinates.
const SAME_SPOT_RADIUS = 0.06;

/** The narrow, legal-reviewed shape from the catalog: "state the count,
 *  offer the human, never name the injury." This counts distinct sessions
 *  and the day span for taps that cluster near each other, and nothing more
 *  -- no severity, no trend, no name. Only clusters spanning at least
 *  `minSessions` distinct days are returned, so a single sore Tuesday never
 *  surfaces as a pattern. */
export function stillThere(entries: PointAtItEntry[], minSessions = 3): StillTherePattern[] {
  type Cluster = { side: "front" | "back"; points: { x: number; y: number; at: number }[] };
  const clusters: Cluster[] = [];
  for (const e of entries) {
    const { x, y, at, side } = e.data;
    const hit = clusters.find(
      (c) => c.side === side && c.points.some((p) => Math.hypot(p.x - x, p.y - y) <= SAME_SPOT_RADIUS),
    );
    if (hit) hit.points.push({ x, y, at });
    else clusters.push({ side, points: [{ x, y, at }] });
  }
  const out: StillTherePattern[] = [];
  for (const c of clusters) {
    const days = new Set(c.points.map((p) => localDay(p.at)));
    if (days.size < minSessions) continue;
    const ats = c.points.map((p) => p.at).sort((a, b) => a - b);
    const first = ats[0]!;
    const last = ats[ats.length - 1]!;
    // HMN-F-21 (2026-09-05): the span used to be a clock difference,
    // round((last - first) / 86,400,000) + 1, while sessions is a count of
    // local days. Taps at 11:50pm Monday, 12:10am Tuesday and 12:10am
    // Wednesday are three sessions and read "over 2 days". Both facts now
    // come from the same local-day strings, so the span can never be fewer
    // than the sessions.
    const sortedDays = [...days].sort();
    const span = daysBetween(sortedDays[0]!, sortedDays[sortedDays.length - 1]!) + 1;
    const cx = c.points.reduce((s, p) => s + p.x, 0) / c.points.length;
    const cy = c.points.reduce((s, p) => s + p.y, 0) / c.points.length;
    out.push({
      spotKey: cx.toFixed(2) + "," + cy.toFixed(2),
      side: c.side,
      sessions: days.size,
      days: span,
      firstAt: first,
      lastAt: last,
    });
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

// STILL THERE?'s dated summary (catalog Part 6): "Produces a shareable dated
// summary of the taps." One line per distinct day a pattern's cluster was
// tapped, in order, nothing else -- no severity, no name, same restraint as
// stillThere() itself. This is the thing a caller hands to a human.
export interface StillThereSummaryRow {
  date: string;
  side: "front" | "back";
}

export function stillThereSummary(entries: PointAtItEntry[], pattern: StillTherePattern): StillThereSummaryRow[] {
  const SAME_SPOT = 0.06;
  const days = new Set<string>();
  const out: StillThereSummaryRow[] = [];
  for (const e of entries) {
    if (e.data.side !== pattern.side) continue;
    const [cx, cy] = pattern.spotKey.split(",").map(Number) as [number, number];
    if (Math.hypot(e.data.x - cx, e.data.y - cy) > SAME_SPOT) continue;
    const day = localDay(e.data.at);
    if (days.has(day)) continue;
    days.add(day);
    out.push({ date: day, side: e.data.side });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function localDay(atMs: number): string {
  const d = new Date(atMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}
