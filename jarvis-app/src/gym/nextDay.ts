import type { Program, ProgramDay, Workout } from "./types";
import { nextPinnedDay, pinnedTo, WEEKDAY_ABBR } from "./pins";

// UP NEXT, one derivation (PINS, D4, approved 2026-08-31; lifted out of
// GymFlow 2026-09-02 so the Health page can lead with the same session the
// gym would offer). "Up Next follows the pins; unpinned programs keep the
// current rotation." A day pinned to today wins outright; a program with
// pins but none today offers the soonest pinned day; a program with no pins
// keeps rotating from the last session. Multi-week blocks return null: which
// day comes next across weeks is a product decision the catalog left open.

export interface NextDay {
  day: ProgramDay;
  /** "today" when pinned to today, "tomorrow", a weekday abbreviation when
   *  pinned further out, or null when the rotation offered it. */
  when: "today" | "tomorrow" | string | null;
}

export function nextDayFor(program: Program | null, workouts: Workout[], dow: number): NextDay | null {
  if (!program) return null;
  const weeks = program.data.weeks;
  if (weeks.length !== 1) return null;
  const week = weeks[0]!;
  if (week.days.length === 0) return null;
  const pinnedToday = pinnedTo(week.days, dow);
  if (pinnedToday) return { day: pinnedToday, when: "today" };
  const upcoming = nextPinnedDay(week.days, dow);
  if (upcoming) return { day: upcoming.day, when: upcoming.inDays === 1 ? "tomorrow" : (WEEKDAY_ABBR[(dow + upcoming.inDays) % 7] ?? null) };
  // The rotation reads the newest session of any program, as the gym page
  // always has; a session from another program simply restarts at day one.
  const recent = [...workouts].sort((a, b) => b.data.date.localeCompare(a.data.date) || b.data.startedAt - a.data.startedAt);
  const last = recent[0];
  if (!last) return { day: week.days[0]!, when: null };
  const i = week.days.findIndex((d) => d.id === last.data.dayId);
  return { day: week.days[(i + 1) % week.days.length] ?? week.days[0]!, when: null };
}
