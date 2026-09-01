import type { TaskData, Recurrence } from "../notes/types";

// Pure date logic shared by the service and the UI. Ports the rules approved in
// the Tasks behavior harness exactly:
//   group: done -> Done; no due date -> Upcoming; due today or earlier -> Today
//          (earlier = overdue, still surfaced in Today); due later -> Upcoming.
//   urgency tag: overdue -> OVERDUE (red); due today -> TODAY (blue);
//          due within 6 days -> weekday; further out -> "MON D"; else none.

export type TaskGroup = "today" | "upcoming" | "done";
export type UrgencyKind = "overdue" | "today" | "soon";
export interface Urgency {
  label: string;
  kind: UrgencyKind;
}

const DAY = 86400000;
const atMidnight = (iso: string) => new Date(iso + "T00:00:00");
const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MO = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function groupFor(task: TaskData, today: string): TaskGroup {
  if (task.done) return "done";
  if (!task.due) return "upcoming";
  return atMidnight(task.due) <= atMidnight(today) ? "today" : "upcoming";
}

export function urgencyFor(task: TaskData, today: string): Urgency | null {
  if (task.done || !task.due) return null;
  const diff = Math.round((atMidnight(task.due).getTime() - atMidnight(today).getTime()) / DAY);
  // Dailies never go overdue (roadmap v2): a missed recurring task is just
  // there today. The streak already paused; the red tag would be shame.
  if (diff < 0 && task.recurrence) return { label: "TODAY", kind: "today" };
  if (diff < 0) return { label: "OVERDUE", kind: "overdue" };
  if (diff === 0) return { label: "TODAY", kind: "today" };
  const dt = atMidnight(task.due);
  if (diff <= 6) return { label: WD[dt.getDay()]!, kind: "soon" };
  return { label: `${MO[dt.getMonth()]} ${dt.getDate()}`, kind: "soon" };
}

// THE URGENCY CHIP SAYS THE DISTANCE, NOT THE STATE (ruled 2026-09-01,
// "Where Urgency Sits"). OVERDUE told him nothing about which of two late
// things to do first; "2 DAYS LATE" and "3 WEEKS LATE" are the same width and
// strictly more information. Nothing due tomorrow or later gets a chip at all,
// which is what keeps the chip rare enough to be loud. The ladder:
//   due today            TODAY          (amber)
//   1 day past           1 DAY LATE     (red)
//   2 to 6 days          N DAYS LATE
//   7 to 29 days         N WEEKS LATE   (rounded down)
//   30 days and beyond   OVER A MONTH   (capped, so a long-dead task never
//                                       prints a chip wider than its name)
// Dailies never go overdue (same rule urgencyFor already keeps): a missed
// daily is simply TODAY.
export interface Distance {
  label: string;
  kind: "today" | "late";
}

export function distanceFor(task: TaskData, today: string): Distance | null {
  if (task.done || !task.due) return null;
  const diff = Math.round((atMidnight(today).getTime() - atMidnight(task.due).getTime()) / DAY);
  if (diff < 0) return null;
  if (diff === 0 || task.recurrence) return { label: "TODAY", kind: "today" };
  if (diff === 1) return { label: "1 DAY LATE", kind: "late" };
  if (diff < 7) return { label: `${diff} DAYS LATE`, kind: "late" };
  if (diff < 30) {
    const w = Math.floor(diff / 7);
    return { label: w === 1 ? "1 WEEK LATE" : `${w} WEEKS LATE`, kind: "late" };
  }
  return { label: "OVER A MONTH", kind: "late" };
}

// Next occurrence of a recurring task, given its current due date (or today).
export function nextDue(fromISO: string, rec: Recurrence): string {
  const d = atMidnight(fromISO);
  if (rec === "daily") d.setDate(d.getDate() + 1);
  else if (rec === "weekly") d.setDate(d.getDate() + 7);
  else if (rec === "monthly") d.setMonth(d.getMonth() + 1);
  else { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
  return todayISO(d);
}
