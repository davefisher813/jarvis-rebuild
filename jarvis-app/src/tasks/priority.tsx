// TASK PRIORITY (Dave, 2026-10-13). Three answers on the task sheet: High, Normal, Low. Normal is every task that ever existed
// and stores nothing. High floats to the top of whatever group it is in and wears a flag in the brand accent; Low is kept so the
// choice sticks and sorts exactly as Normal does, so the existing order is the order for both.
import { Flag } from "../shared/icons";

type Prioritised = { data: { priority?: "high" | "low" } };

export const isHigh = (t: Prioritised): boolean => t.data.priority === "high";

/** The same list with High first. Stable: inside High, and inside everything else, the order the list already had. */
export function highFirst<T extends Prioritised>(items: readonly T[]): T[] {
  if (!items.some(isHigh)) return items.slice();
  return [...items.filter(isHigh), ...items.filter((t) => !isHigh(t))];
}

/** The small marker a High task wears in a list. Spoken as a word, so the row is not just a colour. */
export function PriorityFlag() {
  return (
    <span className="prio-flag" role="img" aria-label="High Priority">
      <Flag className="ic" aria-hidden="true" />
    </span>
  );
}
