import type { EventItem } from "./types";

// A task the user wants to fit into today, with an estimated length.
// windowS/windowE (6.7, softened 2026-08-09): an optional PREFERRED window
// within the day, used by work-hours org categories. Soft, not a wall: the
// planner tries the window first, and only when the window has no room does
// the task spill outside it, labeled outsideWindow so the UI can say so.
// Hard windows were the single biggest "this feature sucks" driver (Dave's
// screenshot 2026-08-09): after 5 PM every org-category task read "No room"
// while the whole evening sat open, because the window made evening placement
// illegal by definition. Dave's own brainstorm called this exact failure:
// blocking off "work" must not make work tasks impossible for someone with
// no set hours. "No room" now means the DAY is full, nothing else.
export interface PlanTask { id: string; text: string; category: string; durationMin: number; windowS?: number; windowE?: number }
// A proposed time block for one task.
export interface PlanBlock { taskId: string; text: string; category: string; start: string; end: string; outsideWindow?: boolean }
export interface DayPlan { blocks: PlanBlock[]; unplaced: PlanTask[] }

function toMin(hhmm: string): number {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
}
function fromMin(total: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, total));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Place tasks into the open time of a day, around existing events.
//
// Each task first-fits into the EARLIEST free gap of the whole day, not a gap
// after the previously placed task. The old version ran a forward-only
// cursor, so pick order silently decided time order and a later pick could
// never use a morning gap the earlier picks skipped: days read "full" while
// visibly open (2026-08-09). Pick order still matters where it should, as
// priority: earlier picks claim the better slots first.
//
// The buffer is baked into the busy range of each placed block, so planned
// blocks keep breathing room between themselves however later tasks land.
// Events and protected ranges stay exact: the buffer is for transitions
// between planned work, not a claim that a meeting runs long.
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

  // Earliest start in [from, cap - dur] clear of every busy range, or null.
  const fit = (dur: number, from: number, cap: number): number | null => {
    let s = from;
    while (s + dur <= cap) {
      const clash = busy.find((b) => s < b.e && b.s < s + dur);
      if (!clash) return s;
      s = clash.e;
    }
    return null;
  };

  for (const t of tasks) {
    const dur = Math.max(5, t.durationMin);
    const windowed = t.windowS != null || t.windowE != null;
    // Inside the preferred window first...
    let s = fit(dur, Math.max(startMin, t.windowS ?? startMin), Math.min(endMin, t.windowE ?? endMin));
    let outside = false;
    // ...and only when the window is genuinely full, anywhere in the day.
    if (s === null && windowed) {
      s = fit(dur, startMin, endMin);
      outside = s !== null;
    }
    if (s === null) {
      unplaced.push(t);
      continue;
    }
    blocks.push({
      taskId: t.id, text: t.text, category: t.category,
      start: fromMin(s), end: fromMin(s + dur),
      ...(outside ? { outsideWindow: true } : {}),
    });
    busy.push({ s, e: s + dur + bufferMin });
  }

  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return { blocks, unplaced };
}
