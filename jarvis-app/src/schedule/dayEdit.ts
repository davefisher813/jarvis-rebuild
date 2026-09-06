import type { EventItem, EventData } from "./types";
import { occursOn } from "./calendar";

// WAVE 3/4 EDITING: drop into a gap, duplicate, copy a day, fix an overlap.
//
// Everything here answers the same complaint: moving and reusing time cost
// too much. Each function is pure and returns a PROPOSAL; the flow writes it,
// so every one of these is undoable by construction.

const toMin = (t: string) => Number(t.split(":")[0] ?? 0) * 60 + Number(t.split(":")[1] ?? 0);
const fromMin = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

export function durationOf(e: EventData): number {
  return e.end ? Math.max(15, toMin(e.end) - toMin(e.start)) : 60;
}

export interface Gap { s: number; e: number }

// SCHED-F-17 (2026-09-05): gapsOn had no caller. The planner finds its own
// room through planDay's window arithmetic, which also honours the routine's
// protected blocks; a 7-to-22 day with a flat 15-minute floor did not.

// The gap a dropped minute belongs to, and where inside it the event should
// land: snapped to the quarter hour and pulled back so it FITS rather than
// hanging off the end. Null when no gap can hold it.
export function dropInto(gaps: Gap[], minute: number, durationMin: number): string | null {
  const snapped = Math.round(minute / 15) * 15;
  const holding = gaps.find((g) => snapped >= g.s && snapped < g.e && g.e - g.s >= durationMin);
  const fallback = gaps.find((g) => g.e - g.s >= durationMin);
  const g = holding ?? fallback;
  if (!g) return null;
  const start = Math.max(g.s, Math.min(snapped, g.e - durationMin));
  return fromMin(Math.round(start / 15) * 15);
}

// E2: duplicate. A copy of a thing is a NEW one-off, never a second member of
// a series: silently duplicating a repeat would multiply it forever.
export function duplicateOf(e: EventData, date = e.date): EventData {
  const copy: EventData = { ...e, date, recurrence: "none" };
  delete copy.exdates;
  delete copy.until;
  delete copy.gcalId;      // a copy is not the imported original
  delete copy.sourceTaskId; // and it did not come from that task
  delete copy.taskIds;      // links live on the event and die with it
  return copy;
}

// N7: copy a day. Only the one-offs travel: a repeating thing already appears
// on the target day by itself, and copying it would double it.
export function copyDay(items: EventItem[], from: string, to: string): EventData[] {
  return items
    .filter((e) => e.data.date === from)
    .filter((e) => !e.data.recurrence || e.data.recurrence === "none")
    .map((e) => duplicateOf(e.data, to))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export interface Overlap { a: EventItem; b: EventItem; byMin: number }

// N5: the overlaps on a day, with how badly they collide.
export function overlapsOn(items: EventItem[], date: string): Overlap[] {
  const day = items
    .filter((e) => occursOn(e.data, date))
    .sort((a, b) => a.data.start.localeCompare(b.data.start));
  const out: Overlap[] = [];
  for (let i = 0; i < day.length; i++) {
    for (let j = i + 1; j < day.length; j++) {
      const a = day[i]!, b = day[j]!;
      const aEnd = toMin(a.data.start) + durationOf(a.data);
      const bStart = toMin(b.data.start);
      const by = aEnd - bStart;
      if (by > 0) out.push({ a, b, byMin: by });
    }
  }
  return out;
}

// SCHED-F-17 (2026-09-05): fixOverlap had no caller. "Fix It" on the day
// opens the real move sheet through ScheduleFlow.openOverlapFix, so the
// person sees and confirms where the later event lands instead of having it
// silently pushed by exactly the collision.

export function overlapLine(o: Overlap): string {
  const m = o.byMin;
  const by = m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
  return `${o.a.data.title} runs into ${o.b.data.title} by ${by}`;
}
