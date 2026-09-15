// WHAT A REMINDER IS ABOUT, AND WHAT HAPPENED TO IT (the reminders rebuild
// push C, 2026-09-15, Dave's brief sections 4 and 5).
//
// A linked item gives the reminder a real primary action: the verb that
// opens the thing. Opening never completes the reminder; the ring is the
// only thing that does. History is the record beside doneCount, said in
// words, and the advice a schedule can give is stated as evidence and
// offered, never applied on its own.

import type { LinkedItem, LinkedType, ReminderInfo, ReminderEvent } from "../notes/types";
import { fmtTime, addDays } from "../schedule/calendar";

const VERB: Record<LinkedType, string> = {
  task: "Open Task",
  note: "Open Note",
  email: "Open Conversation",
  decision: "Review Decision",
  event: "Open Event",
  healthItem: "Log It",
  contact: "Open Contact",
};
export function actionLabelFor(link: LinkedItem): string {
  return VERB[link.type] ?? "Open";
}

const TYPE_WORD: Record<LinkedType, string> = {
  task: "Task", note: "Note", email: "Email", decision: "Decision", event: "Event", healthItem: "Health", contact: "Contact",
};
export function linkedTypeWord(type: LinkedType): string {
  return TYPE_WORD[type] ?? "Item";
}

function clockOf(hhmm: string): string {
  const t = fmtTime(hhmm);
  return `${t.time} ${t.ap}`;
}

function isoDayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hhmmOf(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// The moment an event happened, as a person says it.
export function whenOf(at: string, today: string): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  const day = isoDayOf(d);
  const clock = clockOf(hhmmOf(d));
  if (day === today) return `Today, ${clock}`;
  if (day === addDays(today, -1)) return `Yesterday, ${clock}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${clock}`;
}

// One event in words.
export function describeEvent(ev: ReminderEvent, today: string): { word: string; when: string } {
  const meta = ev.meta ?? {};
  const to = typeof meta.to === "string" ? meta.to : null;
  const time = typeof meta.time === "string" ? meta.time : null;
  let word: string;
  switch (ev.kind) {
    case "completed": word = "Done"; break;
    case "snoozed": word = to ? `Snoozed to ${clockOf(to)}` : "Snoozed"; break;
    case "skipped": word = "Skipped"; break;
    case "rescheduled": word = time ? `Moved to ${clockOf(time)}` : "Moved"; break;
    case "edited": word = "Edited"; break;
    case "paused": word = "Paused"; break;
    case "resumed": word = "Resumed"; break;
    case "notificationOpened": word = "Opened from the Banner"; break;
    case "notificationDismissed": word = "Dismissed"; break;
    case "keptSchedule": word = "Kept the Schedule"; break;
    default: word = "Noted";
  }
  return { word, when: whenOf(ev.at, today) };
}

// The last few, newest first, for the sheet's History group.
export function recentEvents(r: ReminderInfo, today: string, limit = 5): { word: string; when: string }[] {
  return [...(r.history ?? [])].reverse().slice(0, limit).map((ev) => describeEvent(ev, today));
}

// SCHEDULE ADVICE, stated as evidence. Two signals, each capped and
// dismissable, never applied without a tap:
//   snoozes: the last occurrences were pushed rather than done, three or
//            more running (a completion, a skip, a move or Keep Schedule
//            ends the run);
//   later:   with eight or more logged completions, they land at least half
//            an hour after the set time, consistently (the median), so the
//            set time is not the time it actually happens.
export const SNOOZE_ADVICE_AT = 3;
export const COMPLETIONS_FOR_ADVICE = 8;
export const LATER_BY_MIN = 30;
export type ScheduleAdvice = { kind: "snoozes"; count: number } | { kind: "later"; time: string } | null;

const toMin = (hhmm: string): number => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
const fromMin = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function snoozeRun(r: ReminderInfo): number {
  let n = 0;
  for (const ev of [...(r.history ?? [])].reverse()) {
    if (ev.kind === "snoozed") n++;
    else if (ev.kind === "completed" || ev.kind === "skipped" || ev.kind === "rescheduled" || ev.kind === "keptSchedule") break;
  }
  return n;
}

export function scheduleAdvice(r: ReminderInfo): ScheduleAdvice {
  if (r.scheduleKind === "unscheduled" || r.paused) return null;
  const run = snoozeRun(r);
  if (run >= SNOOZE_ADVICE_AT) return { kind: "snoozes", count: run };
  // The completions after the last Keep Schedule: advice once declined is
  // not repeated on the same evidence.
  const hist = r.history ?? [];
  const keptAt = hist.map((e) => e.kind).lastIndexOf("keptSchedule");
  const done = hist.slice(keptAt + 1).filter((e) => e.kind === "completed").slice(-COMPLETIONS_FOR_ADVICE);
  if (done.length < COMPLETIONS_FOR_ADVICE) return null;
  const mins = done.map((e) => new Date(e.at)).filter((d) => Number.isFinite(d.getTime())).map((d) => d.getHours() * 60 + d.getMinutes()).sort((a, b) => a - b);
  if (mins.length < COMPLETIONS_FOR_ADVICE) return null;
  const median = mins[Math.floor(mins.length / 2)]!;
  const set = toMin(r.time);
  if (median - set < LATER_BY_MIN) return null;
  return { kind: "later", time: fromMin(Math.round(median / 5) * 5) };
}

export function adviceLine(a: ScheduleAdvice): string | null {
  if (!a) return null;
  if (a.kind === "snoozes") return `Snoozed the last ${a.count} times · Choose a better time?`;
  return `Usually done around ${clockOf(a.time)} · Move it there?`;
}
