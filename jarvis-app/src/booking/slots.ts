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
/** Postgres renders a tstzrange as ["lower","upper") and the bound style is
 *  part of the value, so it is parsed rather than assumed. An unparseable
 *  range yields NaN, which every caller filters rather than rendering.
 *
 *  It lives here, in the pure module, because three callers need it now and a
 *  second copy of a parser is how two copies drift. It is also the reason it
 *  is not in api/_track3.ts: api/book.ts is the one endpoint with no auth in
 *  front of it and names no live-project credential, and importing a module
 *  that does would put those names in its bundle for the sake of four lines.
 */
export function parseRange(raw: string): { startMs: number; endMs: number } {
  const m = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(raw.trim());
  return m ? { startMs: Date.parse(m[1]!), endMs: Date.parse(m[2]!) } : { startMs: NaN, endMs: NaN };
}

export interface Busy { startMs: number; endMs: number }

export interface Slot { date: string; startMs: number; endMs: number }

export interface SlotQuery {
  rules: Rule[];
  overrides?: Override[];
  busy?: Busy[];
  /** Hours the owner has already committed to something of their own.
   *
   *  A SEPARATE LIST FROM busy, and it has to be. Both block a slot, but only
   *  busy counts toward maxPerDay: that cap is how many BOOKINGS he will take
   *  in a day, not how many things are on his calendar. Folded into one list, a
   *  cap of two plus two of his own meetings would close a day he had not been
   *  booked into at all. */
  committed?: Busy[];
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
  // A whole day off. A blocked row that names a WINDOW is not that: it is an
  // hour inside the day that is already spoken for, and it is subtracted from
  // the slots rather than taking the day out. See busyFromOverrides.
  if (over.some((o) => o.blocked && !(o.startTime && o.endTime))) return [];
  const zone = rules[0]?.timezone ?? "UTC";
  const replaced = over.filter((o) => !o.blocked && o.startTime && o.endTime);
  if (replaced.length > 0) {
    return replaced.map((o) => ({ weekday: weekdayOf(date), startTime: o.startTime!, endTime: o.endTime!, timezone: zone }));
  }
  return rules.filter((r) => r.weekday === weekdayOf(date) && toMin(r.endTime) > toMin(r.startTime));
}

// HIS OWN HOURS COUNT AS TAKEN (2026-09-19).
//
// THE BUG THIS CLOSES. The grid subtracted bookings other people had made and
// nothing else, so a link published on a Tuesday afternoon cheerfully offered
// the hour he already had a meeting in. A booking link that double-books its
// owner is worse than no booking link: two people turn up expecting him and he
// is in neither place.
//
// WHERE THE HOURS COME FROM. The app pushes them, because the public endpoint
// cannot read his calendar and must not learn how: it names no live-project
// credential, which is the whole reason a mistake in it cannot reach the app's
// data. So his committed hours arrive as rows he owns in Track 3.
//
// THE ROW SHAPE, AND WHY IT NEEDED NO MIGRATION. availability_overrides has
// is_blocked alongside an optional override_start and override_end, and a
// blocked row's times were simply ignored. They now mean what they say:
//
//   blocked, no window     the whole day is off (a holiday, and what the
//                          column already meant)
//   blocked, with a window that window is taken, the rest of the day stands
//   not blocked, a window  the day runs to THAT window instead of the usual
//                          one (what an override always was)
//
// Three readings of two columns, none of them contradicting each other, and no
// new table to migrate into a live project.

/** The hours inside a day that are already spoken for, as absolute instants.
 *
 *  The times are wall-clock in the owner's own zone, which is the zone their
 *  availability rules are set in: the app that pushed them and the rules it
 *  published were both stamped from the same device, so they agree by
 *  construction rather than by luck. */
export function busyFromOverrides(overrides: Override[], zone: string): Busy[] {
  const out: Busy[] = [];
  for (const o of overrides) {
    if (!o.blocked || !o.startTime || !o.endTime) continue;
    const startMs = fireAt(o.date, o.startTime, zone).getTime();
    const endMs = fireAt(o.date, o.endTime, zone).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    out.push({ startMs, endMs });
  }
  return out;
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
    rules, overrides = [], busy = [], committed = [], fromDate, days, durationMin,
    bufferBeforeMin = 0, bufferAfterMin = 0, minNoticeHours = 0, maxPerDay = null, nowMs,
  } = q;
  // One list for "is this hour free", two for everything else.
  const taken = committed.length > 0 ? [...busy, ...committed] : busy;
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
        if (clashes(startMs, endMs, taken, bufferBeforeMin, bufferAfterMin)) continue;
        out.push({ date, startMs, endMs });
      }
    }
  }
  // One owner, one timeline: the grid is offered in the order it happens,
  // and a duplicate start (two windows that touch) is offered once.
  out.sort((a, b) => a.startMs - b.startMs);
  return out.filter((s, i) => i === 0 || s.startMs !== out[i - 1]!.startMs);
}
