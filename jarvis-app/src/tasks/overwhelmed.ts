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

// THE DOOR IN MOVED (Fewer Buttons, Dave 2026-09-02: "Pick One alone; Just
// This One lives inside it"). The flag is set from the What Now sheet,
// which lives in the shell, while the list that collapses lives in
// TasksFlow, which may already be mounted. So a write here tells whoever
// is listening; TasksFlow re-reads the flag when told.
const listeners = new Set<() => void>();
export function subscribeOverwhelmed(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
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
  for (const fn of listeners) fn();
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

// THE DOOR IN IS NOT A CONFESSION (Dave 2026-08-26: "These button names
// don't align with the research theme of the app").
//
// This button used to read "I'm Overwhelmed", which is a STATUS wearing a
// button. L1 already outlawed that shape in color -- red is a verb, never a
// status -- and the same argument is stronger in words: the feature exists
// for someone already depleted, and it charged a declaration of that
// depletion as the price of admission. The button that helps most was the
// one that cost the most to press, on a home screen anyone glancing at the
// phone can read.
//
// "Just This One" was already written here as the mode's title and never
// rendered anywhere. It says exactly what you get, makes no claim about the
// person pressing it, and pairs with the exit as one vocabulary: Just This
// One, then Show Everything.
export const OVERWHELM_ENTER = "Just This One";
export const OVERWHELM_SUB = "Everything else is still there";
export const OVERWHELM_EXIT = "Show Everything";
