import type { TaskItem } from "./TasksService";
import { rankOpen, daysBetween } from "../upnext/upnext";
import { blockerOf } from "./startAction";
import { sessionHasWork, type Sessions } from "./startStore";
import { capAfterNumber } from "../shared/casing";

// WHICH ONE, AND WHY (Start Now, 2026-09-16, Dave: "No unexplained huge Pick
// One button").
//
// The old Pick One took a decision off him and told him nothing about the
// decision it had taken. The top card names the task, says what is ready on
// it, and says WHY it was picked, out of real metadata and nothing else.
//
// What this refuses to invent, because each one was on the list:
//   - urgency nobody stated
//   - how much time he has
//   - what mood he is in, or how hard the thing is
//   - a preference it has decided he holds
//
// The ranking is the app's own (upnext's rankOpen), not a second opinion
// about what matters. The only thing laid on top is that a thing he was
// already in the middle of beats a thing he was not, which is his decision
// being honoured rather than a new judgement being made.

export interface TopPick {
  task: TaskItem;
  /** True when he was already working on it, which is why it leads. */
  resuming: boolean;
}

/**
 * The one task the top card offers, or null.
 *
 * TWO GATES, ADDED 2026-09-18 (Dave: "if we are going to highlight one thing
 * like that the logic better be flawless or else it's just random nonsense").
 * He was right, and this is where it was wrong:
 *
 *   ONE OF ONE IS NOT A CHOICE. The card sat on top of a list holding a
 *   single task and proposed that task, which the row underneath was already
 *   offering with its own Start button. A highlight that highlights
 *   everything is not a highlight.
 *
 *   NOTHING AHEAD, NO PICK. rankOpen keys every undated task to the same
 *   bucket, and every task due on the same day to the same bucket too, so
 *   "the top one" among equals was only whichever the array happened to hold
 *   first -- and the card explained itself with "nothing else is closer to
 *   due", which was true of all of them. The lead now has to be STRICTLY
 *   ahead of the runner-up on a date he set. On a view where everything is
 *   due the same day, nothing is ahead, and the list is its own answer.
 *
 * A resume point is exempt from the date gate and only from that one: it is
 * his own decision being honoured, not a judgement being made.
 *
 * Blocked work is out: a thing waiting on somebody else is not a place to
 * begin. Done, reminders and future recurrences are already out via rankOpen.
 */
export function topPick(
  tasks: TaskItem[],
  today: string,
  sessions: Sessions = {},
  opts: { skip?: readonly string[] } = {},
): TopPick | null {
  const skip = new Set(opts.skip ?? []);
  const eligible = rankOpen(tasks, today).filter((t) => !blockerOf(t.data) && !skip.has(t.id));
  if (eligible.length < 2) return null;

  // His own resume point first. It has to still be eligible: work saved
  // against a task he has since finished or blocked is not a place to begin.
  let best: { task: TaskItem; at: number } | null = null;
  for (const t of eligible) {
    const s = sessions[t.id];
    if (!s || !sessionHasWork(s)) continue;
    if (!best || s.savedAt > best.at) best = { task: t, at: s.savedAt };
  }
  if (best) return { task: best.task, resuming: true };

  // Strictly ahead, or no pick. For dated work rankOpen is plain ascending
  // due date (overdue oldest first, then today, then soonest), so this
  // comparison is the ranking's own order asked whether it really separated
  // them. An undated runner-up is behind any date by definition.
  const lead = eligible[0]!;
  const second = eligible[1]!;
  const ahead = !!lead.data.due && (!second.data.due || lead.data.due < second.data.due);
  return ahead ? { task: lead, resuming: false } : null;
}

/**
 * WHY THIS ONE, ON THE FACE OF THE CARD (2026-09-18).
 *
 * It used to be a sheet behind a Why This link: two taps to learn something
 * that fits on one line -- and the line it hid was sometimes "nothing else is
 * closer to due", which was the tell that the pick had no reason at all.
 * topPick will not make a pick without one now, so the reason is short,
 * always concrete, and printed where the choice is made.
 *
 * Every word of it can be pointed at: work he saved, or a date he set.
 */
export function startReason(pick: TopPick, today: string): string {
  if (pick.resuming) return "You were already working on it";
  const due = pick.task.data.due;
  if (!due) return "";
  const d = daysBetween(today, due);
  if (d < 0) return capAfterNumber(`${-d} ${-d === 1 ? "day" : "days"} late`);
  if (d === 0) return "Due today";
  return capAfterNumber(`Due in ${d} ${d === 1 ? "day" : "days"}`);
}
