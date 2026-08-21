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

// M4: the open stretches of a day, so a thing can be dropped INTO one at the
// time it actually starts rather than at whatever minute the finger landed on.
export function gapsOn(items: EventItem[], date: string, dayStart = 7 * 60, dayEnd = 22 * 60): Gap[] {
  const busy = items
    .filter((e) => occursOn(e.data, date))
    .map((e) => ({ s: toMin(e.data.start), e: toMin(e.data.start) + durationOf(e.data) }))
    .sort((a, b) => a.s - b.s);
  const out: Gap[] = [];
  let cur = dayStart;
  for (const b of busy) {
    if (b.s > cur) out.push({ s: cur, e: Math.min(b.s, dayEnd) });
    cur = Math.max(cur, b.e);
  }
  if (cur < dayEnd) out.push({ s: cur, e: dayEnd });
  return out.filter((g) => g.e - g.s >= 15);
}

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

// The fix: push the SECOND one later by exactly the collision. The later
// event moves because the earlier one is the commitment already underway, and
// moving the thing you are about to start is how a plan stops being trusted.
export function fixOverlap(o: Overlap): { id: string; start: string; end?: string } {
  const dur = durationOf(o.b.data);
  const start = toMin(o.b.data.start) + o.byMin;
  return {
    id: o.b.id,
    start: fromMin(Math.round(start / 15) * 15),
    ...(o.b.data.end ? { end: fromMin(Math.round((start + dur) / 15) * 15) } : {}),
  };
}

export function overlapLine(o: Overlap): string {
  const m = o.byMin;
  const by = m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
  return `${o.a.data.title} runs into ${o.b.data.title} by ${by}`;
}
