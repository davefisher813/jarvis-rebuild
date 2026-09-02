import type { EventItem } from "./types";
import { eventsForDate, openSlots, minToHHMM } from "./calendar";
import { durationOf } from "./dayEdit";
import type { RoutineData } from "../routine/types";
import { planWindowFor, protectedRangesFor, isFocusRange } from "../routine/types";

// THE WEEK (D2, approved 2026-09-01: "Week becomes seven day-rows with
// capacity bars, not a seven-column grid and not a day picker"; the bar,
// ruled the same day: "one track, placed by time", an available container
// "a hollow outline"). This is the derivation behind each row: the day's
// waking window from the routine (the same window the Day view counts open
// time in), every block placed on it by time, protected ranges as hollow
// outlines, and the open minutes left, from the same openSlots the Day
// view uses so the two modes can never disagree about a day.

export interface WeekBlock { s: number; e: number; category: string; title: string; hollow?: boolean }

export interface WeekRow {
  date: string;
  day: number;           // the date number, 1..31
  dow: number;           // Mon=0..Sun=6, the schedule's own convention
  windowS: number;       // waking window, minutes from midnight
  windowE: number;
  blocks: WeekBlock[];
  count: number;         // blocks that occupy time (events plus non-focus containers)
  openMin: number;       // open minutes inside the window
}

const toMin = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
const dowOf = (date: string) => (new Date(date + "T00:00:00").getDay() + 6) % 7;

export function weekRowsFor(dates: string[], events: EventItem[], routine: RoutineData, today?: { date: string; nowMin: number }): WeekRow[] {
  return dates.map((date) => {
    const dow = dowOf(date);
    const win = planWindowFor(routine, dow);
    // Today's open time starts now, the way the Day view counts it; a day
    // ahead counts its whole waking window.
    const openFrom = today && today.date === date ? Math.max(win.wakeMin, today.nowMin) : win.wakeMin;
    const evs = eventsForDate(events, date);
    const locked = protectedRangesFor(routine, dow);
    const blocks: WeekBlock[] = [
      // Containers first, so an event inside one paints over its outline.
      ...locked.map((l) => ({ s: l.s, e: l.e, category: "", title: l.label, hollow: true })),
      ...evs.map((e) => ({ s: toMin(e.data.start), e: toMin(e.data.start) + durationOf(e.data), category: e.data.category ?? "", title: e.data.title })),
    ].sort((a, b) => a.s - b.s);
    const busyLocked = locked.filter((l) => !isFocusRange(l)).map((l) => ({ s: l.s, e: l.e }));
    const openMin = openFrom >= win.endMin ? 0 : openSlots(evs, minToHHMM(openFrom), minToHHMM(win.endMin), 30, busyLocked)
      .reduce((acc, sl) => acc + (toMin(sl.end) - toMin(sl.start)), 0);
    return {
      date, day: new Date(date + "T00:00:00").getDate(), dow,
      windowS: win.wakeMin, windowE: win.endMin,
      blocks, count: evs.length + busyLocked.length, openMin,
    };
  });
}

/** "11h 15m", "45m", "12h". */
export function spanShort(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return `${m}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}
