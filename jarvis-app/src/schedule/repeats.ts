import type { EventItem, EventData, EventRecurrence } from "./types";
import { occursOn } from "./calendar";

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
  if (rec === "weekly") return "Every " + DAYS[d.getDay()];
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

// W2: which days of a week already carry a repeating thing, so the week view
// can mark them. Returns the set of dates, not a count: the mark says "there
// is something standing here", and a number would just be another thing to read.
export function repeatDays(items: EventItem[], weekDates: string[]): Set<string> {
  const out = new Set<string>();
  for (const date of weekDates) {
    for (const e of items) {
      if (!e.data.recurrence || e.data.recurrence === "none") continue;
      if (occursOn(e.data, date)) { out.add(date); break; }
    }
  }
  return out;
}

// A series ending BEFORE it starts is a data mistake, and the fix is to
// refuse it at the edit rather than let the event disappear from the app.
export function untilIsValid(startDate: string, until: string): boolean {
  return !until || until >= startDate;
}

export function untilError(startDate: string, until: string): string | null {
  return untilIsValid(startDate, until) ? null : "Ends before it starts";
}
