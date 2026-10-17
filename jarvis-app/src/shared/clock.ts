import { fmtTime, minToHHMM } from "../schedule/calendar";

// THE ONE CLOCK (2026-10-17). Nineteen call sites spelled a time of day with
// toLocaleTimeString, which is 12-hour only when the locale is pinned and
// which, in every modern engine, joins the number to its AM or PM with a
// NARROW NO-BREAK SPACE (U+202F): "8:32 PM". The same time built by the
// schedule's fmtTime read "8:32 PM" with a plain space, so a copied line, a
// test and bindMeridiem (which looked for the plain space) all saw two
// different strings for one moment. One formatter, built on fmtTime, so a
// time of day has one shape everywhere: "8:32 PM", 12-hour, a normal space,
// local time.

/** "8:32 PM" for a Date, an epoch in ms, an ISO string or an "HH:MM" clock
 *  string. An unreadable value gives "", so a line with nothing to say stays
 *  empty rather than printing "Invalid Date". */
export function clock12(at: Date | number | string): string {
  const hhmm = typeof at === "string" && /^\d{1,2}:\d{2}$/.test(at) ? at : localHHMM(at);
  if (!hhmm) return "";
  const t = fmtTime(hhmm);
  return `${t.time} ${t.ap}`;
}

function localHHMM(at: Date | number | string): string | null {
  const d = at instanceof Date ? at : new Date(at);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  return minToHHMM(d.getHours() * 60 + d.getMinutes());
}
