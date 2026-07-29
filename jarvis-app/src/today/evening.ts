// Evening mode for Today (Phase 2 follow-on). After the workday ends (or 6 PM,
// whichever is later), Today shifts posture: recap what happened, lead with
// the mood check-in, show only what is left tonight, promote tomorrow, and
// soften the open tasks. Pure derivations here; TodayPage renders them.
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import type { RoutineData } from "../routine/types";

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
}

export function eveningStats(events: EventItem[], tasks: TaskItem[], today: string, nowHHMM: string): EveningStats {
  const dueToday = tasks.filter((t) => t.data.due === today);
  const open = tasks.filter((t) => !t.data.done && t.data.due && t.data.due <= today);
  return {
    doneDue: dueToday.filter((t) => t.data.done).length,
    dueTotal: dueToday.length,
    eventsLeft: events.filter((e) => e.data.start >= nowHHMM).length,
    openCount: open.length,
  };
}

// The one-line recap under the evening greeting. Leads with the win when there
// is one; never mentions what did not happen.
export function eveningSummary(s: EveningStats): string {
  const parts: string[] = [];
  if (s.doneDue > 0) parts.push(`${s.doneDue} ${s.doneDue === 1 ? "task" : "tasks"} done today`);
  if (s.eventsLeft > 0) parts.push(`${s.eventsLeft} ${s.eventsLeft === 1 ? "thing" : "things"} left tonight`);
  if (parts.length === 0) return "A clear evening.";
  return parts.join(" · ");
}

// Shown under the Still Open card. Tone: permission, not pressure.
export const EVENING_TASKS_NOTE = "These can wait for tomorrow's plan. Tonight is yours.";
