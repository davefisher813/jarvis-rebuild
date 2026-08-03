import type { EventItem } from "./types";

// A task the user wants to fit into today, with an estimated length.
// windowS/windowE (6.7): an optional placement window WITHIN the day. Used by
// work-hours org categories: their tasks only land inside work hours, so an
// evening plan stops proposing work into the user's night. A task that cannot
// fit its window comes back unplaced, honestly.
export interface PlanTask { id: string; text: string; category: string; durationMin: number; windowS?: number; windowE?: number }
// A proposed time block for one task.
export interface PlanBlock { taskId: string; text: string; category: string; start: string; end: string }
export interface DayPlan { blocks: PlanBlock[]; unplaced: PlanTask[] }

function toMin(hhmm: string): number {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
}
function fromMin(total: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, total));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Place tasks into the open time of a day, in order, around existing events.
// Each task lands in the earliest free gap at or after a running cursor, with a
// buffer after it. Tasks that can't fit before the window closes come back as
// `unplaced` (no overcommitting, no silent overlaps).
//
// `blocked` seeds the busy set with protected ranges (gym, meals, deep work)
// the planner must route around exactly like fixed events. Optional so every
// existing caller keeps its behavior. Phase 2.
export function planDay(
  tasks: PlanTask[],
  events: EventItem[],
  startMin: number,
  endMin: number,
  bufferMin = 10,
  blocked: { s: number; e: number }[] = [],
): DayPlan {
  const busy = events.map((e) => ({
    s: toMin(e.data.start),
    e: e.data.end ? toMin(e.data.end) : toMin(e.data.start) + 60,
  }));
  for (const b of blocked) if (b.e > b.s) busy.push({ s: b.s, e: b.e });
  const blocks: PlanBlock[] = [];
  const unplaced: PlanTask[] = [];
  let cursor = startMin;

  for (const t of tasks) {
    const dur = Math.max(5, t.durationMin);
    const cap = Math.min(endMin, t.windowE ?? endMin);
    let s = Math.max(cursor, t.windowS ?? cursor);
    let placed = false;
    while (s + dur <= cap) {
      const clash = busy.find((b) => s < b.e && b.s < s + dur);
      if (!clash) {
        blocks.push({ taskId: t.id, text: t.text, category: t.category, start: fromMin(s), end: fromMin(s + dur) });
        busy.push({ s, e: s + dur });
        cursor = s + dur + bufferMin;
        placed = true;
        break;
      }
      s = clash.e; // jump past the conflicting event and try again
    }
    if (!placed) unplaced.push(t);
  }

  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return { blocks, unplaced };
}
