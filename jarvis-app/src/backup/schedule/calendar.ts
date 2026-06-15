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

// "13:00","14:30" -> "1:00 - 2:30 PM" (shares the meridiem when both match).
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
  const base = new Date(e.date + "T00:00:00");
  const day = new Date(date + "T00:00:00");
  if (rec === "daily") return true;
  if (rec === "weekly") return base.getDay() === day.getDay();
  if (rec === "monthly") return base.getDate() === day.getDate();
  return false;
}


// Events on a given day, earliest first.
export function eventsForDate(items: EventItem[], date: string): EventItem[] {
  return items
    .filter((e) => occursOn(e.data, date))
    .map((e) => (e.data.date === date ? e : { ...e, data: { ...e.data, date } }))
    .sort((a, b) => a.data.start.localeCompare(b.data.start));
}

// Conflicting event ids on a single day: any pair whose time ranges overlap.
export function findConflicts(items: EventItem[]): Set<string> {
  const out = new Set<string>();
  const sorted = [...items].sort((a, b) => a.data.start.localeCompare(b.data.start));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const ei = sorted[i], ej = sorted[j];
      if (!ei || !ej) continue;
      if (toMin(ej.data.start) < endMin(ei.data) && toMin(ei.data.start) < endMin(ej.data)) {
        out.add(ei.id); out.add(ej.id);
      }
    }
  }
  return out;
}

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
// user tap a free block and create an event starting there.
export function openSlots(items: EventItem[], dayStart = "08:00", dayEnd = "21:00", minMin = 30): FreeSlot[] {
  const lo = toMin(dayStart), hi = toMin(dayEnd);
  const busy = items
    .map((e) => ({ s: toMin(e.data.start), e: e.data.end ? toMin(e.data.end) : toMin(e.data.start) + 60 }))
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
export function weekOf(iso: string): string[] {
  const d = new Date(iso + "T00:00:00");
  const dow = (d.getDay() + 6) % 7;
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x.toISOString().slice(0, 10); });
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
}
