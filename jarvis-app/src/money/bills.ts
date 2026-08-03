import type { TaskItem } from "../tasks/TasksService";
import { daysBetween } from "../upnext/upnext";
import { formatMoney } from "./types";

// Money v1 bill language (2026-08-03). Pure functions; MoneyFlow renders them.
// The laws these encode:
// - Autopay NEVER says "paid": the app cannot know a payment cleared. It says
//   "Set to autopay" ahead of time and "Autopay scheduled <date>" after.
// - Manual payments get a dated receipt ("Paid Jul 28") derived from the
//   completion tap, killing the did-I-already-pay loop honestly.
// - Overdue is words, never red: "Was due 2 days ago" is information.
// - Proximity beats dates: "Due in 3 days" lands where "8/6" does not.

export type PaydayFreq = "weekly" | "biweekly" | "monthly";
export interface PaydayInfo { amount: number; next: string; freq: PaydayFreq }

export function isBillTask(t: TaskItem): boolean {
  return !!t.data.bill;
}

/**
 * Bills worth showing: everything unpaid, plus recently paid ones as receipts.
 * A one-time bill paid over 30 days ago has finished its story and drops off.
 */
export function activeBills(tasks: TaskItem[], today: string): TaskItem[] {
  return tasks
    .filter(isBillTask)
    .filter((t) => !t.data.done || (t.data.lastDone !== undefined && daysBetween(t.data.lastDone, today) <= 30))
    .sort((a, b) => (a.data.due ?? "9999").localeCompare(b.data.due ?? "9999"));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function monthDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

/** "Today" / "tomorrow" / "Friday" (within 6 days) / "Aug 30". */
export function dayPhrase(iso: string, today: string): string {
  const gap = daysBetween(today, iso);
  if (gap <= 0) return "today";
  if (gap === 1) return "tomorrow";
  if (gap <= 6) {
    const dt = new Date(iso + "T12:00:00");
    return WEEKDAYS[dt.getDay()] ?? monthDay(iso);
  }
  return monthDay(iso);
}

export type BillState = "paid" | "autopay" | "due" | "overdue";

/** True when a payment receipt is the freshest fact about this bill. */
function recentlyHandled(t: TaskItem, today: string): boolean {
  if (t.data.lastDone === undefined) return false;
  if (daysBetween(t.data.lastDone, today) > 5) return !!t.data.done; // one-time paid keeps its receipt
  // recurring: paid/rolled recently and the next occurrence is still ahead
  return t.data.done || (!!t.data.due && t.data.due > today);
}

/** The one sub-line under a bill's name. */
export function billSubline(t: TaskItem, today: string): { text: string; state: BillState } {
  const due = t.data.due;
  if (t.data.bill?.autopay) {
    if (recentlyHandled(t, today) && t.data.lastDone && daysBetween(t.data.lastDone, today) <= 5)
      return { text: `Autopay scheduled ${monthDay(t.data.lastDone)}`, state: "paid" };
    if (due) return { text: `Set to autopay · ${dayPhrase(due, today)}`, state: "autopay" };
    return { text: "Set to autopay", state: "autopay" };
  }
  if (recentlyHandled(t, today) && t.data.lastDone)
    return { text: `Paid ${monthDay(t.data.lastDone)}`, state: "paid" };
  if (!due) return { text: "No due date", state: "due" };
  const overdueBy = daysBetween(due, today);
  if (overdueBy > 0)
    return { text: overdueBy === 1 ? "Was due yesterday" : `Was due ${overdueBy} days ago`, state: "overdue" };
  const gap = daysBetween(today, due);
  if (gap === 0) return { text: "Due today", state: "due" };
  if (gap === 1) return { text: "Due tomorrow", state: "due" };
  if (gap <= 6) return { text: `Due in ${gap} days`, state: "due" };
  return { text: `Due ${monthDay(due)}`, state: "due" };
}

function addDaysISO(iso: string, days: number): string {
  const dt = new Date(iso + "T12:00:00");
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * One month forward, clamped to the target month's length but anchored to the
 * ORIGINAL day-of-month: paid on the 31st means Feb pays the 28th and March
 * pays the 31st again. Clamping from the previous hop instead would decay the
 * anchor permanently (May 31 -> Jun 30 -> forever the 30th).
 */
function addMonthISO(iso: string, anchorDay: number): string {
  const [y, m] = iso.split("-").map(Number);
  const nextM = (m ?? 1) - 1 + 1;
  const last = new Date(y!, nextM + 1, 0).getDate();
  const dt = new Date(y!, nextM, Math.min(anchorDay, last), 12);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** The next payday on or after today, advanced from the stored anchor. */
export function paydayNext(p: PaydayInfo, today: string): string {
  const anchorDay = Number(p.next.split("-")[2] ?? 1);
  let d = p.next;
  let guard = 0;
  while (d < today && guard++ < 400) {
    d = p.freq === "monthly" ? addMonthISO(d, anchorDay) : addDaysISO(d, p.freq === "weekly" ? 7 : 14);
  }
  return d;
}

/**
 * The payday anchor line: money in vs bills out between now and payday.
 * Unpaid overdue bills count as out (they still have to leave), and autopay
 * bills count too (money out is money out). Null when there is nothing
 * honest to say (no unpaid bills in the window and none overdue).
 */
export function paydayLine(
  p: PaydayInfo,
  bills: TaskItem[],
  today: string,
): { title: string; sub: string } | null {
  const payday = paydayNext(p, today);
  const out = bills
    .filter(isBillTask)
    .filter((t) => !t.data.done && !!t.data.due && t.data.due <= payday)
    .filter((t) => !(t.data.bill?.autopay && t.data.lastDone && daysBetween(t.data.lastDone, today) <= 5 && t.data.due! > today))
    .reduce((sum, t) => sum + (t.data.bill?.amount ?? 0), 0);
  if (out === 0) return null;
  const when = dayPhrase(payday, today);
  return {
    title: `Between now and ${when === "today" ? "payday (today)" : when}`,
    sub: `${formatMoney(p.amount)} in · ${formatMoney(out)} of bills out`,
  };
}
