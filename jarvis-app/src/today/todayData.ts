// Pure aggregation helpers for the Today home. All read-only derivations over
// data produced (and already tested) by the Schedule and Tasks services.
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { partition } from "../tasks/filters";
import { capAfterNumber } from "../shared/casing";

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// The day after the given YYYY-MM-DD (handles month/year rollover).
//
// B2-3 (2026-09-04): a fixed 86,400,000ms step used to land on the clocks-
// back day's wall clock a day early, because that local day has 25 hours
// under America/New_York (and every other zone that observes DST): Plan
// Tomorrow planned today, tomorrow's section showed today's events, and the
// reminder scheduler sent today's events twice. setDate() steps a calendar
// day regardless of how many hours it actually contained.
export function tomorrowISO(today: string): string {
  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return isoOf(d);
}

// Current wall-clock as "HH:MM" (24h), to compare against event start times.
export function nowHHMM(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export interface DaySummary {
  events: number;
  due: number;
  overdue: number;
  // PICK 5 (Dave 2026-08-22): how many of today's open tasks move something
  // he said he wants. Every other number here counts work by SHAPE, which is
  // why the home page never once mentioned a goal.
  moves: number;
}

// Counts for the one-line briefing under the greeting.
export function daySummary(todayEvents: EventItem[], tasks: TaskItem[], today: string, moves = 0): DaySummary {
  const p = partition(tasks, today);
  return { events: todayEvents.length, due: p.today.length, overdue: p.overdue.length, moves };
}

// Home "Today's Tasks" = overdue first, then due-today. Done and later tasks excluded.
export function todaysTasks(tasks: TaskItem[], today: string): TaskItem[] {
  const p = partition(tasks, today);
  return [...p.overdue, ...p.today];
}

// An event is "past" once its start time is earlier than the current time.
export function isPast(ev: EventItem, now: string): boolean {
  return ev.data.start < now;
}

// Bills where the eyes are (2026-08-09). Money already knows every bill and
// its due date; Today said nothing until one became an overdue task. One
// deterministic line for anything due in the next three days, because bills
// are the category where a missed day costs actual money.
export function billsDueSoon(tasks: TaskItem[], today: string): TaskItem[] {
  const horizon = new Date(today + "T00:00:00");
  horizon.setDate(horizon.getDate() + 3);
  const cutoff = horizon.toISOString().slice(0, 10);
  return tasks
    .filter((t) => !t.data.done && !!t.data.bill && !!t.data.due && (t.data.due as string) >= today && (t.data.due as string) <= cutoff)
    .sort((a, b) => ((a.data.due as string) || "").localeCompare((b.data.due as string) || ""));
}

// TITLE AND SUB, NOT ONE SENTENCE (2026-08-24, page-by-page walk).
//
// This returned the whole thing as one string, and TodayPage passed it as the
// card TITLE with no sub. Titles ellipsize by law, so "Rent ($2200) due
// Wednesday" needed 253px in a 174px column and lost the word that made it
// urgent: the reader saw a bill and not when it is due.
//
// Every other notice card on that page is one fact in the title and the rest
// in the sub. This is now shaped the same, so nothing truncates and the day
// is the thing that survives.
export function billsLine(tasks: TaskItem[], today: string): { title: string; sub: string } | null {
  const due = billsDueSoon(tasks, today);
  if (due.length === 0) return null;

  const when = (iso: string): string => {
    if (iso === today) return "today";
    const d = new Date(iso + "T00:00:00");
    const t = new Date(today + "T00:00:00");
    if (d.getTime() - t.getTime() === 86400000) return "tomorrow";
    return d.toLocaleDateString([], { weekday: "long" });
  };
  const name = (t: TaskItem) => t.data.text.replace(/^Pay /, "");

  if (due.length === 1) {
    const t = due[0]!;
    const amt = t.data.bill?.amount;
    return {
      title: name(t),
      sub: `${amt ? `$${amt} · ` : ""}Due ${when(t.data.due as string)}`,
    };
  }
  return {
    title: capAfterNumber(`${due.length} bills due soon`),
    sub: due.map(name).join(", "),
  };
}
