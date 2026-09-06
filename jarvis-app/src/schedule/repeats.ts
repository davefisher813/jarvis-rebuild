import type { EventItem, EventData, EventRecurrence } from "./types";
import { occursOn, weekdaysOf } from "./calendar";

// THE REPEATS VIEW AND ITS PLAIN ENGLISH (W1/W2/N3, wave 4).
//
// Repeating events were invisible as a SET. You could see Tuesday's copy of a
// thing on Tuesday, but nowhere in the app could you ask "what is standing on
// my calendar forever, and when does it stop". Since recurrence had no end
// date, the honest answer was usually "never", and nobody knew.

export interface RepeatRow {
  id: string;
  title: string;
  category: string;
  start: string;
  recurrence: EventRecurrence;
  cadence: string;   // "Every Tuesday"
  ends: string;      // "Through Nov 8" or "No end date"
  endless: boolean;  // the ones worth reviewing
  skipped: number;   // occurrences removed one at a time
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

// Said the way a person would say it, from the event's own start date.
export function cadenceOf(e: EventData): string {
  const rec = e.recurrence;
  if (!rec || rec === "none") return "";
  if (rec === "daily") return "Every day";
  const d = new Date(e.date + "T12:00:00");
  if (rec === "weekly") {
    // UP-CORE-11 (2026-09-05): a weekly series can name several weekdays and
    // can run every other week, so the plain-English line has to be able to
    // say both. One day on every week is still "Every Tuesday", exactly as
    // it read before.
    const days = weekdaysOf(e);
    const every2 = e.interval === 2;
    const names = days.map((n) => DAYS[n]!);
    const list = names.length === 1 ? names[0]!
      : names.length === 2 ? names.join(" and ")
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    if (every2) return "Every 2 weeks on " + list;
    return names.length === 1 ? "Every " + list : list + " every week";
  }
  return "Monthly on the " + ordinal(d.getDate());
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

// The honest end. "No end date" is stated plainly rather than left blank,
// because a blank reads as "I checked and there is nothing", and the whole
// point of this view is noticing the things that never stop.
export function endsLabel(e: EventData): string {
  return e.until ? "Through " + monthDay(e.until) : "No end date";
}

export function repeatRows(items: EventItem[]): RepeatRow[] {
  return items
    .filter((e) => e.data.recurrence && e.data.recurrence !== "none")
    .map((e) => ({
      id: e.id,
      title: e.data.title,
      category: e.data.category,
      start: e.data.start,
      recurrence: e.data.recurrence!,
      cadence: cadenceOf(e.data),
      ends: endsLabel(e.data),
      endless: !e.data.until,
      skipped: e.data.exdates?.length ?? 0,
    }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

// SCHED-F-17 (2026-09-05): repeatDays went with the repeatMarks prop it fed.
// W2's day marks were superseded by the row-based Week (D2): repeatRows above
// draws each standing thing as its own row, which says what is standing there
// rather than only that something is.

// A series ending BEFORE it starts is a data mistake, and the fix is to
// refuse it at the edit rather than let the event disappear from the app.
export function untilIsValid(startDate: string, until: string): boolean {
  return !until || until >= startDate;
}

export function untilError(startDate: string, until: string): string | null {
  return untilIsValid(startDate, until) ? null : "Ends before it starts";
}
