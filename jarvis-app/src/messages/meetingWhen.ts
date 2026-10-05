import { dayPhrase, monthDay } from "../money/bills";
import { fmtTime, todayISO } from "../schedule/calendar";
import { spanLabel } from "../shared/duration";
import type { MeetingCandidate } from "./mailContracts";
import { convertWall, deviceZone, instantAt, zoneShortName } from "./zoneTime";

// A MEETING, IN THE APP'S OWN CLOCK WORDS (2026-09-29).
//
// Moved out of ThreadStateCard when the actionable meeting UI left that card
// (it is MeetingFinishCard now), with the two additions the new shapes need: a
// candidate may be missing a start or an end, and it may be stated in a zone
// that is not the reader's.

type Slot = { date: string; start: string; end?: string };

/** The day and the hours as two facts. Today and tomorrow keep their words; anything else carries the date it will be filed under, which is the number that has to be right. */
export function whenParts(m: Slot, today = todayISO()): { day: string; time: string } {
  const s = fmtTime(m.start);
  const phrase = dayPhrase(m.date, today);
  const named = phrase === "Today" || phrase === "Tomorrow" || phrase === "Yesterday";
  const day = named || phrase === monthDay(m.date) ? phrase : phrase + ", " + monthDay(m.date);
  if (!m.end) return { day, time: s.time + " " + s.ap };
  const e = fmtTime(m.end);
  return { day, time: s.time + " " + s.ap + " to " + e.time + " " + e.ap };
}

/** The one-string form, for a receipt: the day and the hours joined with a comma. */
export function whenLine(m: Slot, today = todayISO()): string {
  const w = whenParts(m, today);
  return w.day + ", " + w.time;
}

/** The length as the app's one duration formatter says it: "1h", "1h 30m", "45 Min" (shared/duration). Empty for no length. */
export function lengthLabel(startHHMM: string, endHHMM: string): string {
  const mins = (Number(endHHMM.slice(0, 2)) * 60 + Number(endHHMM.slice(3, 5))) - (Number(startHHMM.slice(0, 2)) * 60 + Number(startHHMM.slice(3, 5)));
  return mins > 0 ? spanLabel(mins) : "";
}

/**
 * The candidate as the calendar will hold it: the sender's own zone (when the
 * sentence named one) converted to the reader's. Null when the candidate is not
 * complete, or its wall clock is not a single real moment in its own zone.
 */
export function inReadersZone(c: MeetingCandidate, zone = deviceZone()): { date: string; start: string; end: string } | null {
  if (!c.date || !c.start) return null;
  const from = c.timeZone ?? zone;
  const s = convertWall(c.date, c.start, from, zone);
  if (!s) return null;
  // No end at all is the default length, inside the day, exactly as a
  // candidate built by the reader carries it.
  const startMin = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5));
  const fallback = Math.min(24 * 60 - 1, startMin + 60);
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  if (!c.end) return { date: s.date, start: s.time, end: hh(fallback) };
  // The end is converted from the same day as the start; an event never runs past its own day here.
  const e = convertWall(c.date, c.end, from, zone);
  if (!e) return null;
  // A conversion that carries the end onto another day than the start would draw a block across midnight. That is not drawn.
  const sameDay = e.date === s.date && e.time > s.time;
  return { date: s.date, start: s.time, end: sameDay ? e.time : hh(fallback) };
}

export interface MeetingFacts {
  day: string | null;
  time: string | null;
  /** The zone the time is in: the sender's when they named one, the reader's otherwise, always labelled. */
  zoneLabel: string;
  /** The time in the reader's zone, only when the sender's zone differs. */
  yours: string | null;
  /** The reader's day for that time, only when it is not the sender's day. Its own fact, never glued to `yours` with a dot (2026-10-05). */
  yoursDay: string | null;
  /** "About 1h" when the length is the app's own, the stated length when it is theirs. No dot and no "Default": the card draws it as a white length fact (2026-10-05). */
  length: string | null;
}

/** What a finish card prints. Anything the sentence did not settle is null, and the card asks for it. */
export function meetingFacts(c: MeetingCandidate, today = todayISO(), zone = deviceZone()): MeetingFacts {
  const day = c.date ? whenParts({ date: c.date, start: c.start ?? "00:00" }, today).day : null;
  let time: string | null = null;
  if (c.start) {
    const p = whenParts({ date: c.date ?? today, start: c.start, ...(c.durationSource === "stated" && c.end ? { end: c.end } : {}) }, today);
    time = p.time;
  }
  const at = c.date && c.start ? instantAt(c.date, c.start, c.timeZone ?? zone) : Date.now();
  const stated = c.timeZone && c.timeZone !== zone;
  // 2026-10-05 (the catalog gate): these strings render into a .facts line, and
  // a middle dot baked into a fact is the CSS's job (R6), so none is built here.
  const zoneLabel = zoneShortName(c.timeZone ?? zone, at) + (c.timeZone ? "" : " Your Time");
  let yours: string | null = null;
  let yoursDay: string | null = null;
  if (stated && c.date && c.start) {
    const conv = convertWall(c.date, c.start, c.timeZone!, zone);
    if (conv) {
      const f = fmtTime(conv.time);
      yours = f.time + " " + f.ap + " Your Time";
      if (conv.date !== c.date) yoursDay = dayPhrase(conv.date, today);
    }
  }
  let length: string | null = null;
  if (c.start && c.end) {
    const l = lengthLabel(c.start, c.end);
    // The app's own length is labelled as the app's, never as the sender's.
    if (l) length = c.durationSource === "default" ? "About " + l : l;
  }
  return { day, time, zoneLabel, yours, yoursDay, length };
}
