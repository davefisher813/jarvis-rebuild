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
// A proposed time block for one task. outsideWindow: landed past its
// preferred work-hours window. overSoft: landed on top of a SOFT routine
// block (named, so the UI can say "overlaps your Dinner"), which only happens
// when the day had no room anywhere else.
export interface PlanBlock { taskId: string; text: string; category: string; start: string; end: string; outsideWindow?: boolean; overSoft?: string }
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
// `blocked` seeds the busy set with HARD protected ranges (the walls) the
// planner must route around exactly like fixed events. `softBlocked`
// (2026-08-09) carries the routine's SOFT blocks, preferences from the
// hard/soft split Dave asked for: avoided while the day has room, scheduled
// over (labeled with the block's name) only when it does not. Both optional
// so every existing caller keeps its behavior.
//
// `focusZones` (2026-08-10, Dave: "work tasks during work"): time the user
// set aside FOR tasks (a Deep Work block). The opposite of blocked: instead
// of routing around it, the planner fills it FIRST, before any other open
// time, then overflows to the normal ladder. Zones are preferences, not
// walls: events and hard blocks inside a zone still win.
//
// Placement ladder per task, first rung that fits wins:
//   0. inside a focus zone (clipped to its window), clear of soft blocks
//   1. inside its window, clear of soft blocks   (the ideal slot)
//   2. inside its window, over a soft block      (window beats preference)
//   3. anywhere in the day, clear of soft blocks (spill past the window)
//   4. anywhere, over a soft block               (the day is genuinely tight)
//   5. unplaced                                  (the day is genuinely full)
export function planDay(
  tasks: PlanTask[],
  events: EventItem[],
  startMin: number,
  endMin: number,
  bufferMin = 10,
  blocked: { s: number; e: number }[] = [],
  softBlocked: { s: number; e: number; label: string }[] = [],
  focusZones: { s: number; e: number }[] = [],
): DayPlan {
  const busy = events.map((e) => ({
    s: toMin(e.data.start),
    e: e.data.end ? toMin(e.data.end) : toMin(e.data.start) + 60,
  }));
  for (const b of blocked) if (b.e > b.s) busy.push({ s: b.s, e: b.e });
  const soft = softBlocked.filter((b) => b.e > b.s);
  const blocks: PlanBlock[] = [];
  const unplaced: PlanTask[] = [];

  // Earliest start in [from, cap - dur] clear of every busy range (and, when
  // avoidSoft, every soft range too), or null.
  const fit = (dur: number, from: number, cap: number, avoidSoft: boolean): number | null => {
    let s = from;
    while (s + dur <= cap) {
      const clash =
        busy.find((b) => s < b.e && b.s < s + dur) ??
        (avoidSoft ? soft.find((b) => s < b.e && b.s < s + dur) : undefined);
      if (!clash) return s;
      s = clash.e;
    }
    return null;
  };

  const zones = focusZones
    .map((z) => ({ s: Math.max(z.s, startMin), e: Math.min(z.e, endMin) }))
    .filter((z) => z.e > z.s)
    .sort((a, b) => a.s - b.s);

  for (const t of tasks) {
    const dur = Math.max(5, t.durationMin);
    const windowed = t.windowS != null || t.windowE != null;
    const winFrom = Math.max(startMin, t.windowS ?? startMin);
    const winCap = Math.min(endMin, t.windowE ?? endMin);

    // Rung 0: focus time first. Clipped to the task's own window so a
    // windowed task landing in a zone never silently breaks its window
    // promise; when the clip empties, the normal ladder takes over.
    let s: number | null = null;
    for (const z of zones) {
      s = fit(dur, Math.max(winFrom, z.s), Math.min(winCap, z.e), true);
      if (s !== null) break;
    }
    if (s === null) s = fit(dur, winFrom, winCap, true);
    let outside = false;
    let overSoft = false;
    if (s === null && soft.length > 0) { s = fit(dur, winFrom, winCap, false); overSoft = s !== null; }
    if (s === null && windowed) { s = fit(dur, startMin, endMin, true); outside = s !== null; overSoft = false; }
    if (s === null && windowed && soft.length > 0) { s = fit(dur, startMin, endMin, false); outside = overSoft = s !== null; }
    if (s === null) {
      unplaced.push(t);
      continue;
    }
    const placedS = s;
    const softHit = overSoft ? soft.find((b) => placedS < b.e && b.s < placedS + dur) : undefined;
    blocks.push({
      taskId: t.id, text: t.text, category: t.category,
      start: fromMin(s), end: fromMin(s + dur),
      ...(outside ? { outsideWindow: true } : {}),
      ...(softHit ? { overSoft: softHit.label } : {}),
    });
    busy.push({ s, e: s + dur + bufferMin });
  }

  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return { blocks, unplaced };
}
