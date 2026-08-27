// THE MED WINDOW (catalog Part 4). One horizontal timeline per day, four
// marks: dose (Took It), food (Ate Before), session start (a calendar
// candidate), lights out. No analysis, no correlation claim, no arrow drawn
// between any two marks -- this file states the four facts and nothing
// else. It never computes a gap, a delay, or any relationship between marks;
// that reading is left entirely to the human looking at the row, which is
// the whole reason the catalog calls this legally clean.

import type { AteBeforeEntry, CallItEntry, LightsOutEntry, TookItEntry } from "./types";

export type MedWindowMarkKind = "dose" | "food" | "session" | "lights_out";

export interface MedWindowMark {
  kind: MedWindowMarkKind;
  at: number;
  label: string; // what the mark says happened, plain, no verdict
}

export interface MedWindowDay {
  date: string; // local ISO day
  marks: MedWindowMark[]; // sorted by time, whatever marks exist that day
}

function localDay(atMs: number): string {
  const d = new Date(atMs);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export interface SessionStartCandidate {
  date: string;
  at: number; // epoch ms the session began
  title?: string;
}

/** Builds one row per date that carries at least one mark. Every input list
 *  is optional so a day with only two of the four facts still renders --
 *  this never invents a mark for something that was not logged. */
export function medWindowDays(
  tookIt: TookItEntry[],
  ateBefore: AteBeforeEntry[],
  sessions: SessionStartCandidate[],
  lightsOut: LightsOutEntry[],
): MedWindowDay[] {
  const byDate = new Map<string, MedWindowMark[]>();
  const push = (date: string, mark: MedWindowMark) => {
    const list = byDate.get(date) ?? [];
    list.push(mark);
    byDate.set(date, list);
  };
  for (const t of tookIt) push(localDay(t.data.at), { kind: "dose", at: t.data.at, label: "Dose" });
  for (const a of ateBefore) {
    if (!a.data.ate) continue; // Ate Before logs no/yes; only "ate" is a food EVENT on the timeline
    push(a.data.date, { kind: "food", at: a.data.at, label: "Ate" });
  }
  for (const s of sessions) push(s.date, { kind: "session", at: s.at, label: s.title ?? "Session Start" });
  for (const l of lightsOut) push(localDay(l.data.at), { kind: "lights_out", at: l.data.at, label: "Lights Out" });

  return [...byDate.entries()]
    .map(([date, marks]) => ({ date, marks: marks.sort((a, b) => a.at - b.at) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Call It rides along as an optional fifth reference (session effort), never
// rendered as a fifth MARK on the timeline itself -- the catalog names four
// marks exactly, and RPE already has its own screen. This helper exists only
// so a caller can show "how hard" next to a session mark without this file
// pretending it belongs on the axis.
export function callItFor(entries: CallItEntry[], sessionAt: number, withinMs = 6 * 3600000): number | undefined {
  const hit = entries.find((e) => Math.abs(e.data.at - sessionAt) <= withinMs);
  return hit?.data.rpe;
}
