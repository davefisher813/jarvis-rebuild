// Momentum Chain (addendum item 7, Group A). When a task completes, the
// next best thing slides into its slot: same category first, then due
// urgency, then the shortest-feeling candidate. Two Not Nows quiets the
// chain for the rest of the day. Honest done state: no candidates renders
// nothing. No streaks, no counters, ever: the chain offers, it never scores.

import type { TaskItem } from "./TasksService";

const DISMISS_KEY = "jarvis.momentum.v1";
export const QUIET_AFTER = 2;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

interface DismissShape { date: string; n: number }

export function chainQuietToday(today: string): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const d = JSON.parse(s.getItem(DISMISS_KEY) || "null") as DismissShape | null;
    return !!d && d.date === today && d.n >= QUIET_AFTER;
  } catch {
    return false;
  }
}

export function dismissChain(today: string): void {
  const s = storage();
  if (!s) return;
  try {
    const d = JSON.parse(s.getItem(DISMISS_KEY) || "null") as DismissShape | null;
    const next: DismissShape = d && d.date === today ? { date: today, n: d.n + 1 } : { date: today, n: 1 };
    s.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch { /* quieting is best effort */ }
}

// The pick. Same category as the finished task first; inside a tier, the
// nearest due date wins, undated last. Never a bill (a bill is not
// momentum, it is rent), never a done task, never the one just finished.
export function nextBest(items: TaskItem[], completedId: string, completedCategory: string): TaskItem | null {
  const open = items.filter((t) => !t.data.done && !t.data.bill && t.id !== completedId);
  if (open.length === 0) return null;
  const rank = (t: TaskItem): [number, string] => [
    t.data.category === completedCategory && completedCategory !== "" ? 0 : 1,
    t.data.due ?? "9999-12-31",
  ];
  return [...open].sort((a, b) => {
    const [ta, da] = rank(a);
    const [tb, db] = rank(b);
    return ta - tb || da.localeCompare(db) || a.data.text.localeCompare(b.data.text);
  })[0]!;
}

// The one meta line under the suggestion: derived facts only.
export function chainReason(t: TaskItem, completedCategory: string, today: string): string | null {
  const parts: string[] = [];
  if (t.data.category && t.data.category === completedCategory) parts.push("Same category");
  if (t.data.due === today) parts.push("due today");
  else if (t.data.due && t.data.due < today) parts.push("overdue");
  if (parts.length === 0) return null;
  const line = parts.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
