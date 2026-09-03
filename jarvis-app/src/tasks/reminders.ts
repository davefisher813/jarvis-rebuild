import type { ReminderInfo, TaskData } from "../notes/types";
import type { TaskItem } from "./TasksService";

// REMINDERS (Dave 2026-08-19: "something like taking meds should just be a
// set reminder").
//
// The whole model, kept pure so it can be reasoned about and tested without a
// clock, a store, or a screen.
//
// Two decisions worth stating, because both are load-bearing:
//
// 1. DONE IS DERIVED, NOT STORED. A reminder holds the last date it was
//    ticked, and "done" means that date is today. Nothing has to run at
//    midnight to reset anything, there is no scheduled job, and a device that
//    was asleep for three days still shows the right state the moment it
//    wakes. A stored boolean would need a resetter, and a resetter that never
//    runs is how a med tracker silently lies to you.
//
// 2. A MISSED REMINDER IS NEVER "OVERDUE". It is not late, it does not
//    accumulate, and it never shows a red count. It surfaces once, quietly,
//    and tomorrow it is simply due again. Guilt is the thing that makes
//    people stop opening the app.

export interface ReminderView {
  id: string;
  text: string;
  time: string;      // the time it pings today (snooze applied)
  category: string;
  done: boolean;
  missed: boolean;   // its time has passed today and it is not done
  snoozed: boolean;
  // A missed reminder set to "let it go" stops asking (2026-08-21). It still
  // renders in the strip, quietly, because pretending it was never scheduled
  // would be a lie about the day. It simply stops chasing.
  letGo: boolean;
}

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

export const isReminder = (t: TaskData): boolean => !!t.reminder;

// Does this reminder run on this date at all? Absent `days` means every day.
export function runsOn(r: ReminderInfo, date: string): boolean {
  if (!r.days || r.days.length === 0) return true;
  // Parse as local noon so a timezone west of UTC cannot roll the date back.
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).getDay();
  return r.days.includes(wd);
}

// The time it actually pings today: a snooze only counts on the day it was
// set, so a reminder snoozed yesterday is back at its real time this morning.
export function effectiveTime(r: ReminderInfo, today: string): string {
  if (r.snoozedTo && r.snoozeDate === today) return r.snoozedTo;
  return r.time;
}

export function isDone(r: ReminderInfo, today: string): boolean {
  return r.lastDone === today;
}

// One reminder's state for a given moment. `now` is "HH:MM".
export function viewOf(item: TaskItem, today: string, now: string): ReminderView | null {
  const r = item.data.reminder;
  if (!r || !runsOn(r, today)) return null;
  const time = effectiveTime(r, today);
  const done = isDone(r, today);
  return {
    id: item.id,
    text: item.data.text,
    time,
    category: item.data.category ?? "",
    done,
    missed: !done && toMin(now) > toMin(time),
    snoozed: time !== r.time,
    letGo: !done && toMin(now) > toMin(time) && r.onMiss === "let_go",
  };
}

// Today's reminders, in the order they happen. Done ones stay in place rather
// than dropping out: a med you already took should still read as taken.
export function todaysReminders(items: TaskItem[], today: string, now: string): ReminderView[] {
  return items
    .map((it) => viewOf(it, today, now))
    .filter((v): v is ReminderView => v !== null)
    .sort((a, b) => toMin(a.time) - toMin(b.time));
}

// What Heads Up should surface: missed ones only, and at most two, because a
// list of things you did not do is the opposite of help.
export function missedReminders(items: TaskItem[], today: string, now: string): ReminderView[] {
  // "Let it go" means exactly that: it never reaches Heads Up. Chasing a
  // reminder the user already told you to drop is the app arguing with its
  // own settings, and for ADHD it is the difference between a tool and a
  // nag.
  return todaysReminders(items, today, now).filter((v) => v.missed && !v.letGo).slice(0, 2);
}

// Snooze target, clamped inside the day so a late-night snooze cannot silently
// land on tomorrow (where it would be wrong twice: wrong day, wrong state).
export function snoozeTime(from: string, mins: number): string {
  const total = Math.min(toMin(from) + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export const DAY_PRESETS: { label: string; days?: number[] }[] = [
  { label: "Every Day" },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekends", days: [0, 6] },
];

// How the repeat reads on a row. Kept here so every surface says it the same.
export function cadenceLabel(r: ReminderInfo): string {
  if (!r.days || r.days.length === 0) return "Every Day";
  const set = [...r.days].sort();
  if (set.join() === "1,2,3,4,5") return "Weekdays";
  if (set.join() === "0,6") return "Weekends";
  const N = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return set.map((d) => N[d]).join(" · ");
}
