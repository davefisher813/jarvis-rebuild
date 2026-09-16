import type { TaskItem } from "./TasksService";
import { rankOpen, daysBetween } from "../upnext/upnext";
import { blockerOf, type StartAction } from "./startAction";
import { sessionHasWork, type Sessions } from "./startStore";
import { capAfterNumber } from "../shared/casing";

// WHICH ONE, AND WHY (Start Now, 2026-09-16, Dave: "No unexplained huge Pick
// One button").
//
// The old Pick One took a decision off him and told him nothing about the
// decision it had taken. The top card names the task, says what is ready on
// it, and can be asked why, out of real metadata and nothing else.
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
 * The one task the top card offers.
 *
 * Blocked work is out: a thing waiting on somebody else is not a place to
 * begin, and offering it would be the pretence this feature removes. Done,
 * reminders and future recurrences are already out via rankOpen.
 *
 * Null when there is nothing honest to offer, which renders as an empty
 * state rather than as an encouraging card about nothing.
 */
export function topPick(
  tasks: TaskItem[],
  today: string,
  sessions: Sessions = {},
  opts: { skip?: readonly string[] } = {},
): TopPick | null {
  const skip = new Set(opts.skip ?? []);
  const eligible = rankOpen(tasks, today).filter((t) => !blockerOf(t.data) && !skip.has(t.id));
  if (eligible.length === 0) return null;

  // His own resume point first. It has to still be eligible: work saved
  // against a task he has since finished or blocked is not a place to begin.
  let best: { task: TaskItem; at: number } | null = null;
  for (const t of eligible) {
    const s = sessions[t.id];
    if (!s || !sessionHasWork(s)) continue;
    if (!best || s.savedAt > best.at) best = { task: t, at: s.savedAt };
  }
  if (best) return { task: best.task, resuming: true };

  return { task: eligible[0]!, resuming: false };
}

/** The rest of the list, for Choose Another: everything else that could be
 *  started, in the same order, with the blocked ones kept at the end rather
 *  than hidden, because "it is blocked" is the answer to "why not that one". */
export function otherPicks(tasks: TaskItem[], today: string, exceptId: string): TaskItem[] {
  const ranked = rankOpen(tasks, today).filter((t) => t.id !== exceptId);
  const open = ranked.filter((t) => !blockerOf(t.data));
  const blocked = ranked.filter((t) => !!blockerOf(t.data));
  return [...open, ...blocked];
}

/**
 * Why this one, out of metadata that is really on the record.
 *
 * Every line here can be pointed at: a date the task carries, a blocker he
 * wrote, work he saved, or what the resolver found to open. The last line is
 * the promise the card has to keep, and it is the one people check.
 */
export function whyStart(pick: TopPick, action: StartAction, today: string): string[] {
  const out: string[] = [];
  const due = pick.task.data.due;

  if (pick.resuming) out.push("You were already working on it");
  else if (due) {
    const d = daysBetween(today, due);
    if (d < 0) out.push(capAfterNumber(`${-d} ${-d === 1 ? "day" : "days"} late`));
    else if (d === 0) out.push("Due today");
    else out.push(capAfterNumber(`Due in ${d} ${d === 1 ? "day" : "days"}`));
  } else out.push("Nothing else is closer to due");

  // What is actually ready, in the resolver's own words.
  if (action.ready) out.push(action.ready);
  return out;
}

/** The promise under the reasons. Said on the card that made the choice,
 *  because this is the sentence the old Start button broke. */
export const NO_CLOCK_LINE = "No clock starts · No dates change";
