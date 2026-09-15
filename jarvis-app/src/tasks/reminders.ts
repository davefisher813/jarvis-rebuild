import type { ReminderInfo, TaskData, RepeatRule, FollowUpConfig, ReminderEvent } from "../notes/types";
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
  time: string;      // the time it pings today (snooze applied); "" when unscheduled
  unscheduled: boolean;
  paused: boolean;
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

// LIFE-F-22 (2026-09-05): isReminder had no caller; every reader tests
// t.reminder directly, which is the same check with one fewer hop.

// Parse as local noon so a timezone west of UTC cannot roll the date back.
function localNoon(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}
const isoOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayDiff = (a: string, b: string): number => Math.round((localNoon(b).getTime() - localNoon(a).getTime()) / 86400000);

// THE REMINDERS REBUILD (2026-09-15): whether a reminder is timed at all is
// said explicitly. A reminder written before the field exists is timed,
// which is what every one of them was.
export function scheduleKindOf(r: ReminderInfo): "timed" | "unscheduled" {
  return r.scheduleKind ?? "timed";
}

// The rule a reminder runs by. One written before rules existed reads its
// days[] as the rule it always meant: no days is every day, days is those.
export function repeatRuleOf(r: ReminderInfo): RepeatRule {
  if (r.repeat) return r.repeat;
  if (r.days && r.days.length > 0) return { kind: "weekdays", days: r.days };
  return { kind: "daily" };
}

// Does this reminder run on this date at all? Unscheduled never runs; paused
// never runs; a skipped date does not; otherwise the rule decides against
// the start date (the day it was set, when no start is written).
export function runsOn(r: ReminderInfo, date: string): boolean {
  if (scheduleKindOf(r) === "unscheduled" || r.paused) return false;
  if (r.skippedDates?.includes(date)) return false;
  if (r.extraDates?.includes(date)) return true;
  const rule = repeatRuleOf(r);
  const start = r.startDate ?? null;
  if (start && date < start) return false;
  switch (rule.kind) {
    case "once": return start ? date === start : true;
    case "daily": return true;
    case "weekdays": return rule.days.length === 0 ? true : rule.days.includes(localNoon(date).getDay());
    case "weekly": return start ? dayDiff(start, date) % 7 === 0 : true;
    case "monthly": {
      if (!start) return true;
      const want = localNoon(start).getDate();
      const d = localNoon(date);
      const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      // A month without the date (Jan 31 in February) runs on its last day.
      return d.getDate() === Math.min(want, lastOfMonth);
    }
    case "everyNDays": {
      const n = Math.max(1, rule.n);
      return start ? dayDiff(start, date) % n === 0 : true;
    }
    case "afterCompletion": {
      // Genuinely different from every N days: the next one is counted from
      // the last completion, not from the clock. With nothing completed yet
      // it runs from the start date (or today).
      // it runs from the start date (or today), and keeps its rhythm from
      // whichever anchor it has, so a missed one comes round again.
      const anchor = r.lastDone ?? start;
      if (!anchor) return true;
      if (r.lastDone && date <= r.lastDone) return false;
      const gap = dayDiff(anchor, date);
      return gap >= 0 && gap % Math.max(1, rule.days) === 0;
    }
  }
}

// The time it actually pings today: a snooze only counts on the day it was
// set, so a reminder snoozed yesterday is back at its real time this morning.
export function effectiveTime(r: ReminderInfo, today: string): string {
  if (r.snoozedTo && r.snoozeDate === today) return r.snoozedTo;
  // One occurrence moved (Reschedule this occurrence): that date, that time.
  const moved = r.movedTimes?.[today];
  if (moved) return moved;
  return r.time;
}

export function isDone(r: ReminderInfo, today: string): boolean {
  return r.lastDone === today;
}

// One reminder's state for a given moment. `now` is "HH:MM".
export function viewOf(item: TaskItem, today: string, now: string): ReminderView | null {
  const r = item.data.reminder;
  if (!r) return null;
  // An unscheduled reminder is on the day's list with no clock: it is never
  // missed, never snoozed, and reads as done only on the day it was ticked.
  if (scheduleKindOf(r) === "unscheduled") {
    if (r.paused) return null;
    const done = isDone(r, today);
    return { id: item.id, text: item.data.text, time: "", unscheduled: true, paused: false, category: item.data.category ?? "", done, missed: false, snoozed: false, letGo: false };
  }
  if (!runsOn(r, today)) return null;
  const time = effectiveTime(r, today);
  const done = isDone(r, today);
  return {
    id: item.id,
    text: item.data.text,
    time,
    unscheduled: false,
    paused: false,
    category: item.data.category ?? "",
    done,
    missed: !done && toMin(now) > toMin(time),
    snoozed: time !== r.time,
    letGo: !done && toMin(now) > toMin(time) && followUpOf(r) === null,
  };
}

// Today's reminders, in the order they happen. Done ones stay in place rather
// than dropping out: a med you already took should still read as taken.
export function todaysReminders(items: TaskItem[], today: string, now: string): ReminderView[] {
  return items
    .map((it) => viewOf(it, today, now))
    .filter((v): v is ReminderView => v !== null)
    // Timed ones in the order they happen; unscheduled ones after them.
    .sort((a, b) => (a.unscheduled ? 1e6 : toMin(a.time)) - (b.unscheduled ? 1e6 : toMin(b.time)));
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

// TODAY-F-17 (2026-09-05): what the strip shows, which is everything Heads Up
// has not already taken. A missed reminder surfaces as a notice card carrying
// Ask Again (the verb "If You Miss It" promises), and it used to keep its
// strip row as well: the same 8 AM meds on screen twice, two rows down from
// each other, wearing two different sets of buttons. One row per reminder.
// Note what still stays in the strip: a let-go one (missedReminders drops
// those by design, and pretending it was never scheduled would be a lie about
// the day) and any missed one past that function's cap of two.
export function stripReminders(items: TaskItem[], today: string, now: string): ReminderView[] {
  const inHeadsUp = new Set(missedReminders(items, today, now).map((v) => v.id));
  return todaysReminders(items, today, now).filter((v) => !inHeadsUp.has(v.id));
}

// Snooze target, clamped inside the day so a late-night snooze cannot silently
// land on tomorrow (where it would be wrong twice: wrong day, wrong state).
export function snoozeTime(from: string, mins: number): string {
  const total = Math.min(toMin(from) + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// TODAY-F-04 (2026-09-05): a snooze counted from the reminder's own time, so
// tapping Snooze on 8 AM meds at 2 PM moved them to 08:10 -- still missed,
// nothing scheduled, and the row unchanged. The one snooze moment that
// matters, the one right after it fired or when he finally notices, did
// nothing at all. Ten minutes means ten minutes from whichever is later: a
// reminder still ahead pushes from its time (so the phone's alert moves with
// it), a missed one pushes from the clock.
export function snoozeFrom(time: string, now: string): string {
  return toMin(time) > toMin(now) ? time : now;
}

// The two day sets with names, declared once (the shared-lengths law
// forbids a second file spelling either out).
export const WEEKDAYS: number[] = [1, 2, 3, 4, 5];
export const WEEKENDS: number[] = [0, 6];
export const DAY_PRESETS: { label: string; days?: number[] }[] = [
  { label: "Every Day" },
  { label: "Weekdays", days: WEEKDAYS },
  { label: "Weekends", days: WEEKENDS },
];

// LIFE-F-22 (2026-09-05): cadenceLabel had no surface saying it. The repeat
// picker renders REPEAT_PRESETS' own labels, which is where the words the
// person actually chose from live.

// ---- THE REMINDERS REBUILD (2026-09-15): the rest of the pure model ----

// The next occurrence at or after a moment, so a person can see the schedule
// did what they meant. Null for unscheduled, paused, or nothing within a year.
export function nextOccurrence(r: ReminderInfo, today: string, now: string, horizonDays = 400): { date: string; time: string } | null {
  if (scheduleKindOf(r) === "unscheduled" || r.paused) return null;
  for (let i = 0; i < horizonDays; i++) {
    const date = isoOf(new Date(localNoon(today).getTime() + i * 86400000));
    if (!runsOn(r, date) || isDone(r, date)) continue;
    const time = effectiveTime(r, date);
    if (i === 0 && toMin(time) <= toMin(now)) continue;
    return { date, time };
  }
  return null;
}

// The rule in words, for the sheet and the row.
export function describeRepeat(rule: RepeatRule): string {
  switch (rule.kind) {
    case "once": return "Just Once";
    case "daily": return "Every Day";
    case "weekdays": {
      const d = [...rule.days].sort();
      if (d.join() === "1,2,3,4,5") return "Weekdays";
      if (d.join() === "0,6") return "Weekends";
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return d.map((x) => names[x] ?? "").filter(Boolean).join(", ") || "Every Day";
    }
    case "weekly": return "Every Week";
    case "monthly": return "Every Month";
    case "everyNDays": return rule.n === 1 ? "Every Day" : "Every " + rule.n + " Days";
    case "afterCompletion": return rule.days === 1 ? "1 Day After Completion" : rule.days + " Days After Completion";
  }
}

// The follow-up a reminder actually has. A reminder written before the
// field existed keeps what onMiss meant: nag is one ask fifteen minutes
// on, let_go is none. An explicit null is none.
export const DEFAULT_FOLLOW_UP: FollowUpConfig = { delayMinutes: 15, maxCount: 1, stopAt: null };
export function followUpOf(r: ReminderInfo): FollowUpConfig | null {
  if (r.followUp === null) return null;
  if (r.followUp) return { ...r.followUp, maxCount: Math.max(1, Math.min(5, r.followUp.maxCount)) };
  return r.onMiss === "let_go" ? null : DEFAULT_FOLLOW_UP;
}

// The record of what happened, newest last, never unbounded.
export const HISTORY_CAP = 100;
export function withEvent(r: ReminderInfo, kind: ReminderEvent["kind"], at: string, meta?: Record<string, unknown>): ReminderInfo {
  const ev: ReminderEvent = meta ? { at, kind, meta } : { at, kind };
  const history = [...(r.history ?? []), ev].slice(-HISTORY_CAP);
  return { ...r, history };
}

// How many times in a row the last occurrences were pushed rather than done:
// the signal behind "Choose a better time?". Counts back from the newest
// event until something other than a snooze.
export function consecutiveSnoozes(r: ReminderInfo): number {
  let n = 0;
  for (const ev of [...(r.history ?? [])].reverse()) {
    if (ev.kind === "snoozed") n++;
    else if (ev.kind === "completed" || ev.kind === "skipped") break;
  }
  return n;
}

// The moment a date and clock time mean. Local keeps the clock through a
// timezone change; a fixed zone pins the instant. The fixed case finds the
// UTC instant whose wall clock in that zone reads the date and time, with
// the zone's own offset, so a DST change in that zone is honoured too.
export function fireAt(date: string, time: string, tz?: string): Date {
  if (!tz || tz === "local") return new Date(`${date}T${time}:00`);
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  const offsetAt = (ms: number): number => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
      return wall - ms;
    } catch { return 0; }
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

// Never renders a time beside an unscheduled reminder: the one invariant the
// old form broke. Every surface asks this before it prints a clock.
export function timeLabelFor(r: ReminderInfo, today: string): string | null {
  return scheduleKindOf(r) === "unscheduled" ? null : effectiveTime(r, today);
}

// REMINDERS HOME (the reminders rebuild push B, 2026-09-15): the page is
// organised by when, never an endless list. Now is what is due or past on
// the day and not yet done; Later Today is the rest of today; Upcoming is
// the next occurrence within the horizon for everything not running today;
// Unscheduled sits after them; Paused and Completed collapse to one row
// each so they never crowd out what is actionable.
export interface HomeItem {
  id: string;
  text: string;
  category: string;
  reminder: ReminderInfo;
  /** The occurrence this row is about: null for unscheduled and paused. */
  date: string | null;
  time: string | null;
  done: boolean;
}
export interface HomeSections {
  now: HomeItem[];
  laterToday: HomeItem[];
  upcoming: HomeItem[];
  unscheduled: HomeItem[];
  paused: HomeItem[];
  completed: HomeItem[];
}
export function homeSections(items: TaskItem[], today: string, now: string, horizonDays = 30): HomeSections {
  const out: HomeSections = { now: [], laterToday: [], upcoming: [], unscheduled: [], paused: [], completed: [] };
  for (const it of items) {
    const r = it.data.reminder;
    if (!r || it.data.done) continue;
    const base = { id: it.id, text: it.data.text, category: it.data.category ?? "", reminder: r };
    if (r.paused) { out.paused.push({ ...base, date: null, time: null, done: false }); continue; }
    const done = isDone(r, today);
    if (scheduleKindOf(r) === "unscheduled") {
      (done ? out.completed : out.unscheduled).push({ ...base, date: null, time: null, done });
      continue;
    }
    if (done) { out.completed.push({ ...base, date: today, time: effectiveTime(r, today), done }); continue; }
    if (runsOn(r, today)) {
      const time = effectiveTime(r, today);
      (toMin(time) <= toMin(now) ? out.now : out.laterToday).push({ ...base, date: today, time, done: false });
      continue;
    }
    const next = nextOccurrence(r, today, now, horizonDays);
    if (next) out.upcoming.push({ ...base, date: next.date, time: next.time, done: false });
  }
  const byTime = (a: HomeItem, b: HomeItem) => toMin(a.time ?? "00:00") - toMin(b.time ?? "00:00");
  out.now.sort(byTime);
  out.laterToday.sort(byTime);
  out.upcoming.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || byTime(a, b));
  return out;
}

// THE REMINDERS PAGE (push E, 2026-09-15, Dave's interactive preview): four
// views, each a few sections. Today is Ready Now and Later Today; Upcoming
// is Scheduled, Unscheduled and On an Action; Routines is Repeating and
// Contextual, then Paused; Done is Completed Today and Skipped. A search
// replaces the view with one section over every open reminder.
export type PageTab = "today" | "upcoming" | "routines" | "done";
export const PAGE_TABS: { key: PageTab; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "routines", label: "Routines" },
  { key: "done", label: "Done" },
];
export type RowState = "open" | "done" | "paused" | "skipped";
export interface PageRow extends HomeItem {
  state: RowState;
  /** The date a skipped row is about. */
  skippedDate?: string;
}
export interface PageSection { label: string; rows: PageRow[] }

function isContextual(r: ReminderInfo): boolean {
  return !!r.contextTrigger && !!r.contextTrigger.targetId;
}
function isRepeating(r: ReminderInfo): boolean {
  return scheduleKindOf(r) === "timed" && repeatRuleOf(r).kind !== "once";
}

export function pageSections(items: TaskItem[], tab: PageTab, today: string, now: string, query = "", areaName: (id: string) => string = () => ""): PageSection[] {
  const h = homeSections(items, today, now);
  const open = (x: HomeItem): PageRow => ({ ...x, state: "open" });
  const q = query.trim().toLowerCase();
  if (q) {
    const rows: PageRow[] = [];
    for (const it of items) {
      const r = it.data.reminder;
      if (!r || it.data.done) continue;
      const hay = (it.data.text + " " + areaName(it.data.category ?? "")).toLowerCase();
      if (!hay.includes(q)) continue;
      const base: HomeItem = { id: it.id, text: it.data.text, category: it.data.category ?? "", reminder: r, date: null, time: null, done: isDone(r, today) };
      const next = r.paused || scheduleKindOf(r) === "unscheduled" ? null : nextOccurrence(r, today, "00:00");
      rows.push({ ...base, date: next?.date ?? null, time: next?.time ?? null, state: r.paused ? "paused" : base.done ? "done" : "open" });
    }
    return rows.length ? [{ label: "Search Results", rows }] : [];
  }
  let sections: PageSection[] = [];
  if (tab === "today") {
    sections = [
      { label: "Ready Now", rows: h.now.map(open) },
      { label: "Later Today", rows: h.laterToday.map(open) },
    ];
  } else if (tab === "upcoming") {
    sections = [
      { label: "Scheduled", rows: h.upcoming.map(open) },
      { label: "Unscheduled", rows: h.unscheduled.filter((x) => !isContextual(x.reminder)).map(open) },
      { label: "On an Action", rows: [...h.unscheduled, ...h.upcoming, ...h.now, ...h.laterToday].filter((x) => isContextual(x.reminder)).map(open) },
    ];
  } else if (tab === "routines") {
    const all = [...h.now, ...h.laterToday, ...h.upcoming, ...h.unscheduled];
    sections = [
      { label: "Repeating and Contextual", rows: all.filter((x) => isRepeating(x.reminder) || isContextual(x.reminder)).map(open) },
      { label: "Paused", rows: h.paused.map((x) => ({ ...x, state: "paused" as const })) },
    ];
  } else {
    const skipped: PageRow[] = [];
    const floor = addDaysIso(today, -7);
    for (const it of items) {
      const r = it.data.reminder;
      if (!r || it.data.done) continue;
      for (const d of r.skippedDates ?? []) {
        if (d >= floor && d <= today) skipped.push({ id: it.id, text: it.data.text, category: it.data.category ?? "", reminder: r, date: d, time: r.movedTimes?.[d] ?? r.time, done: false, state: "skipped", skippedDate: d });
      }
    }
    skipped.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    sections = [
      { label: "Completed Today", rows: h.completed.map((x) => ({ ...x, state: "done" as const })) },
      { label: "Skipped", rows: skipped },
    ];
  }
  return sections.filter((s) => s.rows.length > 0);
}

function addDaysIso(iso: string, n: number): string {
  const d = localNoon(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

// The words on a row and in the details for when a reminder is (push E).
export function whenWords(r: ReminderInfo, date: string | null, time: string | null, today: string, areaName = ""): string {
  if (r.paused) return "Paused";
  const ct = r.contextTrigger;
  if (ct && ct.targetId && scheduleKindOf(r) === "unscheduled") {
    return ct.kind === "onOpenArea" ? (areaName ? "When I Open " + areaName : "When I Open the Area") : "After I Complete the Task";
  }
  if (scheduleKindOf(r) === "unscheduled" || !date || !time) return "Unscheduled";
  const t = fmtClock(time);
  const day = date === today ? "Today" : date === addDaysIso(today, 1) ? "Tomorrow" : localNoon(date).toLocaleDateString([], { month: "short", day: "numeric" });
  return day + " · " + t;
}
function fmtClock(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(":");
  const h = Number(hRaw);
  return (h % 12 || 12) + ":" + (mRaw ?? "00").padStart(2, "0") + " " + (h < 12 ? "AM" : "PM");
}

// The follow-up in words (push E): None, Once After 15 Minutes, Once After 1 Hour.
export function followUpWords(r: ReminderInfo): string {
  const fu = followUpOf(r);
  if (!fu) return "None";
  const once = fu.maxCount === 1 ? "Once" : fu.maxCount + " Times";
  const delay = fu.delayMinutes % 60 === 0 ? (fu.delayMinutes / 60) + (fu.delayMinutes === 60 ? " Hour" : " Hours") : fu.delayMinutes + " Minutes";
  return once + " After " + delay;
}

// Quiet hours (push E): a clock time inside the window, which may wrap
// midnight. The window is closed at its end, so 8:00 with quiet to 8:00 is
// not quiet.
export function inQuietHours(hhmm: string, from: string, to: string): boolean {
  const m = toMin(hhmm), a = toMin(from), b = toMin(to);
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}
