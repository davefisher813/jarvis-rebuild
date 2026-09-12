// Evening mode for Today (Phase 2 follow-on). After the workday ends (or 6 PM,
// whichever is later), Today shifts posture: recap what happened, lead with
// the mood check-in, show only what is left tonight, promote tomorrow, and
// soften the open tasks. Pure derivations here; TodayPage renders them.
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import type { RoutineData } from "../routine/types";
import { capAfterNumber } from "../shared/casing";
import { todayISO as isoOf } from "../schedule/calendar";
import { dayRing, countsDoneToday } from "./todayData";

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
  // TODAY-F-09 (2026-09-05): the same count the ring uses, from the same
  // place, so the evening cannot report a smaller day than the morning did:
  // a recurring task completed today is recorded as lastDone with its due
  // rolled forward, and counting by due date alone dropped it out of both
  // halves of the fraction.
  const { done: doneDue, total: dueTotal } = dayRing(tasks, today);
  const open = tasks.filter((t) => !t.data.done && t.data.due && t.data.due <= today);
  // Events attended: fully over by now (end, or start + an hour).
  const endOf = (e: EventItem) => e.data.end ?? addHour(e.data.start);
  const attended = events.filter((e) => endOf(e) <= nowHHMM).length;
  return {
    doneDue,
    dueTotal,
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
  // The week ends at Monday's midnight, stepped as a calendar day: the
  // clocks-back Sunday has 25 hours and a fixed step would drop its last one.
  const end = new Date(d); end.setDate(d.getDate() + 1);
  const to = end.getTime();
  const week = samples.filter((s) => s.t >= from && s.t < to);
  // TODAY-F-12 (2026-09-05): read from local getters, not toISOString();
  // east of Greenwich the UTC day is Sunday and the recap counted the
  // previous Sunday's events into this week.
  const mondayIso = isoOf(monday);
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

// --- HOW TODAY WENT (Dave, on the list since 2026-09-07: "'How did I do
// today' never re-evaluated"; unblocked 2026-09-09) ---
//
// Plan My Day commits picks every morning. recordPicks writes them, midnight
// scores them into plan.outcome events, and planCap reads the score to size
// the NEXT plan. Nothing in between ever tells him how the day he is IN is
// going against the day he chose. The plan was a decision he made and then
// never heard about again.
//
// This is the join, and it is a pure function on purpose: picks in, tasks as
// they are at this instant, answer out. Nothing is cached and nothing is
// stamped, so the card re-derives every time Today renders. Tick a pick off
// at 9 PM and the answer changes at 9 PM. That is the whole of what
// "re-evaluated" has to mean.
//
// It reads the tasks rather than the outcome log because the log is
// deliberately empty for today: a pick is scored on whether it was done by the
// end of its own local day, and that fact does not exist yet. The live view
// and the settled score therefore cannot disagree; they answer at different
// times, from the same evidence.

export interface PlanPick {
  id: string;
  text: string;
  done: boolean;
}

export interface TodayPlan {
  picks: PlanPick[];
  done: number;
  total: number;
}

/**
 * Today's committed picks joined to their tasks right now. Null when no plan
 * was committed today, or when every pick has since been deleted: a card about
 * a plan that does not exist would be a card about nothing.
 *
 * A pick whose task was deleted drops out entirely rather than counting as a
 * miss. The app cannot tell a task deleted because it was handled another way
 * from one deleted because it was abandoned, and guessing punitively is the
 * one reading it must not take.
 */
export function todayPlan(pickIds: string[], tasks: TaskItem[], today: string = isoOf()): TodayPlan | null {
  if (pickIds.length === 0) return null;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const picks: PlanPick[] = [];
  for (const id of pickIds) {
    const t = byId.get(id);
    if (!t) continue;
    // 2026-09-11: a ticked recurring pick rolls its due and stamps lastDone
    // rather than done, so it is counted the way the ring counts (TODAY-F-09).
    picks.push({ id, text: t.data.text, done: countsDoneToday(t, today) });
  }
  if (picks.length === 0) return null;
  return { picks, done: picks.filter((p) => p.done).length, total: picks.length };
}

// The line over the card. It leads with what got done, which is the standing
// tone law on this page (see eveningSummary above), and it never names a
// number of misses: the picks themselves are listed under it, and an unticked
// one says what it says without being counted at him.
//
// The all-done case gets its own sentence rather than "5 of 5", because a
// finished plan is not a fraction, it is a finished plan.
export function todayPlanLine(p: TodayPlan): string {
  if (p.done === p.total) return p.total === 1 ? "The one you picked, done" : "Everything you picked, done";
  if (p.done === 0) return capAfterNumber(`${p.total} picked this morning`);
  // "2 of 5 Done" is the house form for a measurement (shared/casing.ts uses
  // this exact example), so the line is written to land on it.
  return capAfterNumber(`${p.done} of ${p.total} done`);
}
