import { fireAt } from "../tasks/reminders";

// OPEN SLOTS (Track 3, 2026-09-19). The arithmetic behind a public booking
// link, kept pure so it can be tested without a network, a clock or a
// database: the server calls it with rows and gets slots back.
//
// It answers one question: given what the owner said they are available for,
// what is already on their calendar, and what the bookable type costs in
// time, which starts can a stranger actually pick?
//
// The three things that make this harder than slicing a day into pieces, and
// all three are why a booking system is worth testing:
//
//   1. A ZONE IS NOT AN OFFSET. "09:00 in America/New_York" is a different
//      instant in June and December, and a slot grid computed in offsets is
//      wrong twice a year. Every wall-clock time here resolves through the
//      zone, by the same route a reminder's fire time does (tasks/reminders
//      fireAt), so the two cannot disagree about what 9 AM means.
//   2. A BUFFER IS NOT PART OF THE MEETING. A 30-minute call with a
//      10-minute tail occupies 40 minutes of the owner's day but is still
//      offered, and still written, as 30. Buffers widen what COUNTS as a
//      clash; they never widen the slot.
//   3. THE DATABASE IS THE ARBITER, NOT THIS. Two strangers can load the
//      same grid and pick the same slot in the same second. The exclusion
//      constraint on `bookings` is what makes the second one fail; this
//      function only decides what to OFFER. It never promises.

/** A weekly window the owner takes bookings in. `weekday` is JavaScript's
 *  own numbering (Sunday 0), which is what Date.getDay returns; the Booking
 *  settings screen stores Monday-first and converts at its edge. */
export interface Rule { weekday: number; startTime: string; endTime: string; timezone: string }

/** One date that departs from the weekly rules: blocked outright, or open
 *  with different hours. */
export interface Override { date: string; blocked: boolean; startTime?: string; endTime?: string }

/** Something already on the owner's calendar, as instants. */
export interface Busy { startMs: number; endMs: number }

export interface Slot { date: string; startMs: number; endMs: number }

export interface SlotQuery {
  rules: Rule[];
  overrides?: Override[];
  busy?: Busy[];
  /** The first date to offer, ISO, in the owner's zone. */
  fromDate: string;
  /** How many days forward to offer, including fromDate. */
  days: number;
  durationMin: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  /** A stranger cannot book inside this many hours from now. */
  minNoticeHours?: number;
  /** At most this many confirmed bookings on any one day. */
  maxPerDay?: number | null;
  nowMs: number;
}

const MIN = 60_000;

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}
function hhmm(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n));
  return dt.toISOString().slice(0, 10);
}
/** The day of the week a date falls on, read off the calendar rather than
 *  off a local clock, so the answer does not change with the machine. */
function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** The windows a given date is open for, after the overrides have had their
 *  say. A blocked date has none; an override with times replaces the day's
 *  rules rather than adding to them. */
export function windowsFor(date: string, rules: Rule[], overrides: Override[] = []): Rule[] {
  const over = overrides.filter((o) => o.date === date);
  if (over.some((o) => o.blocked)) return [];
  const zone = rules[0]?.timezone ?? "UTC";
  const replaced = over.filter((o) => !o.blocked && o.startTime && o.endTime);
  if (replaced.length > 0) {
    return replaced.map((o) => ({ weekday: weekdayOf(date), startTime: o.startTime!, endTime: o.endTime!, timezone: zone }));
  }
  return rules.filter((r) => r.weekday === weekdayOf(date) && toMin(r.endTime) > toMin(r.startTime));
}

/** Does a slot, once its buffers are added, run into anything already
 *  booked? The buffers belong to the owner's day, not to the meeting. */
function clashes(startMs: number, endMs: number, busy: Busy[], beforeMin: number, afterMin: number): boolean {
  const from = startMs - beforeMin * MIN;
  const to = endMs + afterMin * MIN;
  return busy.some((b) => b.startMs < to && from < b.endMs);
}

export function openSlots(q: SlotQuery): Slot[] {
  const {
    rules, overrides = [], busy = [], fromDate, days, durationMin,
    bufferBeforeMin = 0, bufferAfterMin = 0, minNoticeHours = 0, maxPerDay = null, nowMs,
  } = q;
  if (durationMin <= 0 || days <= 0 || rules.length === 0) return [];
  const earliest = nowMs + minNoticeHours * 60 * MIN;
  const out: Slot[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const windows = windowsFor(date, rules, overrides);
    if (windows.length === 0) continue;

    // The cap counts what is already booked that day, in the owner's zone,
    // so a full day offers nothing rather than offering a slot that the
    // database would then refuse.
    if (maxPerDay !== null && maxPerDay !== undefined) {
      const zone = windows[0]!.timezone;
      const dayStart = fireAt(date, "00:00", zone).getTime();
      const dayEnd = fireAt(addDays(date, 1), "00:00", zone).getTime();
      const onDay = busy.filter((b) => b.startMs < dayEnd && dayStart < b.endMs).length;
      if (onDay >= maxPerDay) continue;
    }

    for (const w of windows) {
      const from = toMin(w.startTime), to = toMin(w.endTime);
      // Starts sit on the duration's own grid from the window's start, so a
      // 30-minute type offers 9:00 and 9:30 rather than whatever is left
      // over after the last booking.
      for (let m = from; m + durationMin <= to; m += durationMin) {
        const startMs = fireAt(date, hhmm(m), w.timezone).getTime();
        const endMs = startMs + durationMin * MIN;
        if (!Number.isFinite(startMs)) continue;
        if (startMs < earliest) continue;
        if (clashes(startMs, endMs, busy, bufferBeforeMin, bufferAfterMin)) continue;
        out.push({ date, startMs, endMs });
      }
    }
  }
  // One owner, one timeline: the grid is offered in the order it happens,
  // and a duplicate start (two windows that touch) is offered once.
  out.sort((a, b) => a.startMs - b.startMs);
  return out.filter((s, i) => i === 0 || s.startMs !== out[i - 1]!.startMs);
}
