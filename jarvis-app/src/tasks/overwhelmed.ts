import type { TaskItem } from "./TasksService";

// I'M OVERWHELMED (F1, approved on the button round 2026-08-19 and never
// built, re-approved from the research 2026-08-20).
//
// Choice overload is real but smaller and more conditional than the popular
// version claims. The condition under which it reliably bites is exactly this
// one: someone already depleted, facing a set of options, unable to start.
//
// So the cut has to be to ONE. Three is still a decision, and a decision is
// the thing he cannot make right now.
//
// Laws:
//   - NOTHING IS DELETED, DEFERRED, OR RESCHEDULED. Hiding is a view, not a
//     write. He gets everything back with one tap and nothing moved while he
//     was not looking.
//   - THE ONE THING IS THE SMALLEST REAL THING, not the most important. The
//     goal is motion, and the most important thing is usually the heaviest.
//   - It says nothing about how many are hidden. That count is the pile with
//     a new name.

const KEY = "jarvis.overwhelmed.v1";

export function loadOverwhelmed(
  todayISO: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  try { return storage.getItem(KEY) === todayISO; } catch { return false; }
}

// Same-day only. An overwhelmed Tuesday must not silently hide Wednesday.
export function setOverwhelmed(
  on: boolean,
  todayISO: string,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): boolean {
  try {
    if (on) storage.setItem(KEY, todayISO);
    else storage.removeItem(KEY);
  } catch { /* private mode */ }
  return on;
}

// The smallest real thing. Estimated length first, then the oldest, so the
// tie-break favours something that has been waiting rather than something
// that just arrived.
export function theOneThing(
  tasks: TaskItem[],
  estimateOf: (t: TaskItem) => number,
): TaskItem | null {
  const open = tasks.filter((t) => !t.data.done && !t.data.reminder);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => {
    const d = estimateOf(a) - estimateOf(b);
    if (d !== 0) return d;
    return (a.data.due ?? "9999").localeCompare(b.data.due ?? "9999");
  })[0] ?? null;
}

export const OVERWHELM_TITLE = "Just This One";
export const OVERWHELM_SUB = "Everything else is still there";
export const OVERWHELM_EXIT = "Show Everything";
