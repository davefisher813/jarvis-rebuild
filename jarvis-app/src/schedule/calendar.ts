import type { EventItem, EventData } from "./types";

// Pure calendar logic shared by the service and the UI. No engine, no state.

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 12h display: "13:00" -> { time: "1:00", ap: "PM" }.
export function fmtTime(hhmm: string): { time: string; ap: string } {
  const [hRaw, mRaw] = hhmm.split(":");
  let h = Number(hRaw);
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return { time: `${h}:${(mRaw ?? "00").padStart(2, "0")}`, ap };
}

function toMin(hhmm: string): number {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
}

function fromMin(total: number): string {
  const t = Math.max(0, Math.min(24 * 60 - 1, total));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// "13:00" + 90 -> "14:30". Clamps within 00:00..23:59.
export function addMinutes(hhmm: string, mins: number): string {
  return fromMin(toMin(hhmm) + mins);
}

// SCHED-F-18 (2026-09-05): does this event still fit in the day after a shift
// of `mins`? addMinutes CLAMPS at 23:59, which is right for arithmetic and
// wrong for a move: Running Late +1 hour on a 23:15-23:45 event pinned both
// ends to 23:59 and left a zero-length row. The event sheet refuses the same
// move rather than clamping it (EventSheet's move chips, "a move control
// that resizes the event is a bug, not a nudge"); the row actions and the
// day-wide shift ask this before they write.
export function shiftFitsDay(start: string, end: string | undefined, mins: number): boolean {
  const s = toMin(start) + mins;
  const dur = end ? toMin(end) - toMin(start) : 0;
  return s >= 0 && s + dur <= 24 * 60 - 1;
}

// "13:00","14:30" -> "1:00 - 2:30 PM" (shares the meridiem when both match).
// Minutes from one HH:MM to another, same day. Used to preserve an event's
// length when it moves (2026-08-19).
export function minutesBetween(from: string, to: string): number {
  const m = (t: string) => { const p = t.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
  return m(to) - m(from);
}

export function fmtRange(start: string, end?: string): string {
  const s = fmtTime(start);
  if (!end) return `${s.time} ${s.ap}`;
  const e = fmtTime(end);
  return s.ap === e.ap ? `${s.time} - ${e.time} ${e.ap}` : `${s.time} ${s.ap} - ${e.time} ${e.ap}`;
}

// End of an event, defaulting to 60 minutes when no explicit end is set.
function endMin(e: EventData): number {
  return e.end ? toMin(e.end) : toMin(e.start) + 60;
}

// Does a (possibly recurring) event land on `date`? Recurrence runs forward from
// the event's anchor date only.
export function occursOn(e: EventData, date: string): boolean {
  if (e.exdates?.includes(date)) return false;
  if (e.date === date) return true;
  const rec = e.recurrence;
  if (!rec || rec === "none") return false;
  if (date < e.date) return false;
  // N3: a series can END. `until` is inclusive, and it never hides the first
  // occurrence: an end date before the start is a mistake in the data, not a
  // reason to make the event vanish entirely.
  if (e.until && date > e.until) return false;
  const base = new Date(e.date + "T00:00:00");
  const day = new Date(date + "T00:00:00");
  if (rec === "daily") return true;
  if (rec === "weekly") {
    // UP-CORE-11 (2026-09-05): a weekly series can name its own weekdays and
    // can run every other week. Absent `days` means the anchor's weekday,
    // which is what weekly has always meant, so nothing already on the
    // calendar moves. This is the ONE place weekly is decided, so the week
    // view, the Repeats list, the plan dedupe and every day list follow.
    const days = weekdaysOf(e);
    if (!days.includes(day.getDay())) return false;
    if (e.interval === 2 && weeksBetween(base, day) % 2 !== 0) return false;
    return true;
  }
  // B2-5 (2026-09-04): an unclamped day-of-month check meant a series
  // anchored on the 29th, 30th or 31st simply had no matching day at all in
  // a shorter month, and the Repeats list still showed it as standing. Rent
  // due "on the 31st" is understood everywhere else as "the last day", so a
  // target month with no 31st clamps to its own last day instead of skipping.
  if (rec === "monthly") {
    const wantDay = base.getDate();
    const lastDayOfTargetMonth = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    return day.getDate() === Math.min(wantDay, lastDayOfTargetMonth);
  }
  return false;
}


// The weekdays a weekly series lands on: the ones it names, or the anchor's
// own. A corrupt list (out of range, empty) falls back to the anchor rather
// than making the event vanish or appear on days nobody chose.
export function weekdaysOf(e: Pick<EventData, "date" | "days">): number[] {
  const anchor = new Date(e.date + "T00:00:00").getDay();
  const clean = (e.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return clean.length ? [...new Set(clean)] : [anchor];
}

// Whole weeks between two dates, counted from each one's Sunday, so "every
// other week" means alternate CALENDAR weeks rather than every fourteenth
// day from the anchor. Local noon on both sides keeps a DST change from
// rounding a week away.
function weeksBetween(a: Date, b: Date): number {
  const sunday = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay(), 12).getTime();
  return Math.round((sunday(b) - sunday(a)) / (7 * 86400000));
}

// SCHED-F-03 (2026-09-05): the first day on or after `from` that this event
// actually lands on. A series edited from a list with no day behind it (the
// Repeats view) has to be opened on a real occurrence, or "This Event" has
// nothing to point at and skips whatever day happened to be selected. Walks
// day by day rather than solving each cadence, which keeps the exdates and
// the `until` rule in one place (occursOn). Null when the series has already
// run out.
export function nextOccurrence(e: EventData, from: string): string | null {
  let day = from < e.date ? e.date : from;
  // A month plus a leap day is enough for every cadence stored here; past
  // that the series has ended or been skipped away entirely.
  for (let i = 0; i <= 366; i++) {
    if (occursOn(e, day)) return day;
    if (e.until && day > e.until) return null;
    day = addDays(day, 1);
  }
  return null;
}

// Events on a given day, earliest first.
export function eventsForDate(items: EventItem[], date: string): EventItem[] {
  return items
    .filter((e) => occursOn(e.data, date))
    .map((e) => (e.data.date === date ? e : { ...e, data: { ...e.data, date } }))
    .sort((a, b) => a.data.start.localeCompare(b.data.start));
}

// SCHED-F-17 (2026-09-05): findConflicts returned a bare set of colliding
// ids and had no caller. dayEdit.overlapsOn is what the day actually reads:
// it names the pair and by how much, which is what "Fix It" needs to say
// which event moves and where.
// Earliest 30-min-aligned slot on `date` that fits `durationMin` without
// overlapping existing events. Starts at now (if today) or 9am, caps at 22:00.
export function nextFreeSlot(
  items: EventItem[], date: string, now: Date = new Date(), durationMin = 60, dayStart = "09:00",
): string {
  const evs = eventsForDate(items, date);
  let slot = toMin(dayStart);
  if (todayISO(now) === date) {
    const nowMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
    slot = Math.max(slot, nowMin);
  }
  const cap = 22 * 60;
  const clash = (s: number) => evs.some((e) => s < endMin(e.data) && toMin(e.data.start) < s + durationMin);
  while (slot <= cap && clash(slot)) slot += 30;
  if (slot > cap) slot = toMin(dayStart);
  return fromMin(slot);
}

export interface FreeSlot { start: string; end: string }

// Open gaps on a single day's event list, within waking hours. Used to let the
// user tap a free block and create an event starting there. extraBusy
// (2026-08-10) carries the routine's protected ranges: before it, the day
// list drew "Protected" rows and then an Open row spanning straight across
// them (Dave's 2:42 AM screenshot: five protected blocks, "Open 8:00 AM -
// 9:00 PM"), because open time only knew about events. Callers pass the same
// locked ranges the list renders, so the two can never disagree again.
export function openSlots(
  items: EventItem[], dayStart = "08:00", dayEnd = "21:00", minMin = 30,
  extraBusy: { s: number; e: number }[] = [],
): FreeSlot[] {
  const lo = toMin(dayStart), hi = toMin(dayEnd);
  const busy = [
    ...items.map((e) => ({ s: toMin(e.data.start), e: e.data.end ? toMin(e.data.end) : toMin(e.data.start) + 60 })),
    ...extraBusy.map((b) => ({ s: b.s, e: b.e })),
  ]
    .filter((b) => b.e > lo && b.s < hi)
    .sort((a, b) => a.s - b.s);
  const out: FreeSlot[] = [];
  let cursor = lo;
  for (const b of busy) {
    if (b.s - cursor >= minMin) out.push({ start: fromMin(cursor), end: fromMin(Math.min(b.s, hi)) });
    cursor = Math.max(cursor, b.e);
    if (cursor >= hi) break;
  }
  if (hi - cursor >= minMin) out.push({ start: fromMin(cursor), end: fromMin(hi) });
  return out;
}

// For the month grid: day-of-month -> the categories with events that day, so
// the cell can draw colored dots. month is 0-based.
export function dotsForMonth(items: EventItem[], year: number, month: number): Record<number, string[]> {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const days = new Date(year, month + 1, 0).getDate();
  const out: Record<number, string[]> = {};
  for (let d = 1; d <= days; d++) {
    const iso = `${prefix}-${String(d).padStart(2, "0")}`;
    for (const e of items) {
      if (occursOn(e.data, iso)) (out[d] ??= []).push(e.data.category);
    }
  }
  return out;
}

export interface MonthCell {
  date: string;
  day: number;
  inMonth: boolean;
}

// A 6-week (42 cell) grid starting on Sunday, with leading/trailing days from
// the adjacent months. month is 0-based.
export function monthMatrix(year: number, month: number): MonthCell[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: isoOf(d), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return cells;
}

// Monday-anchored 7 ISO dates for the week containing `iso`.
//
// B2-1/B2-2 (2026-09-04): both of these used to serialise with
// toISOString().slice(0,10), which reads UTC. East of UTC that rolls the
// date forward before local midnight, which under Europe/Berlin made
// addDays("2026-09-04", 1) return "2026-09-04" itself and weekOf anchor a
// day early. isoOf (line 12) already existed and was already correct;
// these two just were not calling it.
export function weekOf(iso: string): string[] {
  const d = new Date(iso + "T00:00:00");
  const dow = (d.getDay() + 6) % 7;
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return isoOf(x); });
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoOf(d);
}

// SCHED-F-11 (2026-09-05): whole days from one local day to another, the
// inverse of addDays. Rounded, because a day that crosses a DST boundary is
// 23 or 25 hours long and a truncating divide would lose it.
export function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Time as distance (roadmap v2): "in 40m", "in 2h 10m". Time blindness reads
// distances, not clocks. Returns null when the moment has passed.
export function fmtDistance(startHHMM: string, nowHHMM: string): string | null {
  const diff = toMin(startHHMM) - toMin(nowHHMM);
  if (diff <= 0) return null;
  if (diff < 60) return `in ${diff}m`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

// Minutes-from-midnight <-> "HH:MM", shared by the locked-block rows.
export function minToHHMM(min: number): string {
  const t = Math.max(0, Math.min(24 * 60 - 1, min));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
