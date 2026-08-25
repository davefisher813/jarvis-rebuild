// Evening mode for Today (Phase 2 follow-on). After the workday ends (or 6 PM,
// whichever is later), Today shifts posture: recap what happened, lead with
// the mood check-in, show only what is left tonight, promote tomorrow, and
// soften the open tasks. Pure derivations here; TodayPage renders them.
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import type { RoutineData } from "../routine/types";
import { capAfterNumber } from "../shared/casing";

// Evening starts at the later of 6 PM and the end of work hours, and runs to
// midnight (after midnight the clock is morning again, whatever it feels like).
export function isEvening(nowMin: number, routine: RoutineData): boolean {
  return nowMin >= Math.max(18 * 60, routine.workEndMin);
}

export interface EveningStats {
  doneDue: number;    // tasks due today that actually got done
  dueTotal: number;   // tasks due today, done or not
  eventsLeft: number; // events that have not started yet
  openCount: number;  // open tasks on the plate (due today or overdue)
  thingsDone: number; // the close-out number: completions today + events attended
}

export function eveningStats(
  events: EventItem[],
  tasks: TaskItem[],
  today: string,
  nowHHMM: string,
  completionsToday = 0,
): EveningStats {
  const dueToday = tasks.filter((t) => t.data.due === today);
  const open = tasks.filter((t) => !t.data.done && t.data.due && t.data.due <= today);
  const doneDue = dueToday.filter((t) => t.data.done).length;
  // Events attended: fully over by now (end, or start + an hour).
  const endOf = (e: EventItem) => e.data.end ?? addHour(e.data.start);
  const attended = events.filter((e) => endOf(e) <= nowHHMM).length;
  return {
    doneDue,
    dueTotal: dueToday.length,
    eventsLeft: events.filter((e) => e.data.start >= nowHHMM).length,
    openCount: open.length,
    // Time Sense counts every completion today (passed in); fall back to the
    // due-today dones when the collector has nothing (fresh device).
    thingsDone: Math.max(completionsToday, doneDue) + attended,
  };
}

function addHour(hhmm: string): string {
  const p = hhmm.split(":");
  const h = Math.min(23, Number(p[0] ?? 0) + 1);
  return `${String(h).padStart(2, "0")}:${p[1] ?? "00"}`;
}

// The close-out line under the evening greeting (roadmap v2: "You did 6 things
// today." One line, no charts). Leads with the win; never mentions what did
// not happen.
//
// PICK 4 (Dave 2026-08-22): and what it MOVED. Six things done is a number
// about volume; the goal it advanced is the only part of the day worth
// remembering, and the app has never said it. The segment is passed in
// already built (today/goalPulse) and is null when Time Sense saw nothing,
// because device-local evidence can be absent without being negative: this
// line never claims a goal did not move.
//
// Casing: routed through capAfterNumber, which the number-lead law has asked
// of every count-led line since 2026-08-20. This one predated the rule and
// slipped its detector, because the detector keys on a property literally
// named `done` and this one is `thingsDone`.
export function eveningSummary(s: EveningStats, moved?: string | null): string {
  const parts: string[] = [];
  if (s.thingsDone > 0) parts.push(`${s.thingsDone} done today`);
  if (moved) parts.push(moved);
  if (s.eventsLeft > 0) parts.push(`${s.eventsLeft} left tonight`);
  if (parts.length === 0) return "A clear evening";
  return capAfterNumber(parts.join(" · "));
}

// --- The weekly close-out card (Sundays only; the Insights page folds into
// this in the consolidation session). Two lines, no charts. ---

export interface WeekRecap {
  things: number; // completions this week (Time Sense)
  events: number; // events that happened this week
  bestDay: string | null; // weekday name with the most completions
}

const DOW_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Null unless `today` is a Sunday evening surface (callers gate on evening).
// Week = Monday through today. Speaks only with something to say.
export function weekRecap(
  samples: { t: number; dow: number }[],
  events: EventItem[],
  today: string,
): WeekRecap | null {
  const d = new Date(today + "T00:00:00");
  if (d.getDay() !== 0) return null; // Sundays only
  const monday = new Date(d);
  monday.setDate(d.getDate() - 6);
  const from = monday.getTime();
  const to = d.getTime() + 86400000;
  const week = samples.filter((s) => s.t >= from && s.t < to);
  const mondayIso = monday.toISOString().slice(0, 10);
  const evCount = events.filter((e) => e.data.date >= mondayIso && e.data.date <= today).length;
  if (week.length === 0 && evCount === 0) return null;
  let bestDay: string | null = null;
  if (week.length > 0) {
    const byDow = new Map<number, number>();
    for (const s of week) byDow.set(s.dow, (byDow.get(s.dow) ?? 0) + 1);
    const top = [...byDow.entries()].sort((a, b) => b[1] - a[1])[0]!;
    bestDay = top[1] >= 2 ? DOW_NAME[top[0]]! : null;
  }
  return { things: week.length, events: evCount, bestDay };
}

// Shown under the Still Open card. Tone: permission, not pressure.
export const EVENING_TASKS_NOTE = "Waits for tomorrow · Tonight is yours";
