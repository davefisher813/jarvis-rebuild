import type { EventItem } from "./types";

// A task the user wants to fit into today, with an estimated length.
export interface PlanTask { id: string; text: string; category: string; durationMin: number }
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
export function planDay(
  tasks: PlanTask[],
  events: EventItem[],
  startMin: number,
  endMin: number,
  bufferMin = 10,
): DayPlan {
  const busy = events.map((e) => ({
    s: toMin(e.data.start),
    e: e.data.end ? toMin(e.data.end) : toMin(e.data.start) + 60,
  }));
  const blocks: PlanBlock[] = [];
  const unplaced: PlanTask[] = [];
  let cursor = startMin;

  for (const t of tasks) {
    const dur = Math.max(5, t.durationMin);
    let s = cursor;
    let placed = false;
    while (s + dur <= endMin) {
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
