import type { EventItem } from "./types";

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

// Events on a given day, earliest first.
export function eventsForDate(items: EventItem[], date: string): EventItem[] {
  return items
    .filter((e) => e.data.date === date)
    .sort((a, b) => a.data.start.localeCompare(b.data.start));
}

// For the month grid: day-of-month -> the categories with events that day, so
// the cell can draw colored dots. month is 0-based.
export function dotsForMonth(items: EventItem[], year: number, month: number): Record<number, string[]> {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const out: Record<number, string[]> = {};
  for (const e of items) {
    if (!e.data.date.startsWith(prefix)) continue;
    const day = Number(e.data.date.slice(8, 10));
    (out[day] ??= []).push(e.data.category);
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
