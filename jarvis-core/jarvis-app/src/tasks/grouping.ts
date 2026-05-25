import type { TaskData } from "../notes/types";

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
  if (diff < 0) return { label: "OVERDUE", kind: "overdue" };
  if (diff === 0) return { label: "TODAY", kind: "today" };
  const dt = atMidnight(task.due);
  if (diff <= 6) return { label: WD[dt.getDay()]!, kind: "soon" };
  return { label: `${MO[dt.getMonth()]} ${dt.getDate()}`, kind: "soon" };
}
