import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "../schedule/types";
import type { Account } from "../money/types";

export interface Bar { label: string; value: number; display: string; slot: string; }

// Monday-anchored week of 7 ISO dates starting from the Monday of `today`.
export function weekDates(today: string): string[] {
  const d = new Date(today + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x.toISOString().slice(0, 10); });
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function eventsThisWeek(events: EventItem[], today: string): Bar[] {
  const week = weekDates(today);
  return week.map((iso, i) => {
    const count = events.filter((e) => e.data.date === iso).length;
    return { label: DOW[i]!, value: count, display: String(count), slot: iso === today ? "red" : "sky" };
  });
}

export function openTasksByArea(tasks: TaskItem[], cats: { id: string; name: string; slot: string }[]): Bar[] {
  const open = tasks.filter((t) => !t.data.done);
  return cats.map((c) => ({ label: c.name, value: open.filter((t) => t.data.category === c.id).length, display: "", slot: c.slot }))
    .filter((b) => b.value > 0)
    .map((b) => ({ ...b, display: String(b.value) }))
    .sort((a, b) => b.value - a.value);
}

export function accountBars(accounts: Account[], slotOf: (k: string) => string, fmt: (n: number) => string): Bar[] {
  return accounts.map((a) => ({ label: a.data.name, value: Math.abs(a.data.balance), display: fmt(a.data.balance), slot: slotOf(a.data.kind) }));
}

export function maxValue(bars: Bar[]): number { return bars.reduce((m, b) => Math.max(m, b.value), 0); }
