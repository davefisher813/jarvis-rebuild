import type { TaskItem } from "./TasksService";
import { theOneThing } from "./overwhelmed";
import { capAfterNumber } from "../shared/casing";

// RIGHT NOW (the button round, filtered through the research 2026-08-21).
//
// Dave approved nine buttons. Three of them survive the evidence, and this is
// the shared spine of two: What Now, reachable from every screen, and Just
// Fifteen, which starts the thing immediately.
//
// Why immediately matters more than it sounds: ADHD is characterised by steep
// delay discounting, so a reward or a commitment placed in the future is
// devalued sharply. "Set a Start" (C1) books a container for later, which is
// the right tool when he is looking at his day. This is the other half, for
// when he is looking at nothing and cannot begin: the container starts on the
// tap.
//
// Laws:
//   - ONE thing, never a list. Choice overload bites hardest exactly when
//     someone is already depleted, which is the state this button is for.
//   - The SMALLEST real thing, not the most important. The goal is motion,
//     and the most important thing is usually the heaviest.
//   - Fifteen minutes, and it ENDS. A commitment you can see the end of is
//     one you can start.
//   - It never says how many others there are.

export const FIFTEEN = 15;

export interface RightNow {
  task: TaskItem;
  minutes: number;
  // Where the block goes if he takes it: now, snapped to the minute.
  startHHMM: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function nowHHMM(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function endOf(startHHMM: string, minutes: number): string {
  const [h = "0", m = "0"] = startHHMM.split(":");
  const t = Number(h) * 60 + Number(m) + minutes;
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
}

// The one thing to do right now, and the container for it. Null when there is
// genuinely nothing open, which renders as nothing rather than as an
// encouraging empty state: a button that appears when it cannot act is worse
// than no button.
export function rightNow(
  tasks: TaskItem[],
  estimateOf: (t: TaskItem) => number,
  now = new Date(),
): RightNow | null {
  const task = theOneThing(tasks, estimateOf);
  if (!task) return null;
  return { task, minutes: FIFTEEN, startHHMM: nowHHMM(now) };
}

// The offer, in his words. Names the thing and the length, and says nothing
// about finishing it: fifteen minutes is a start, and promising completion is
// how a small ask becomes a big one.
export function rightNowLine(r: RightNow): string {
  return capAfterNumber(`${r.minutes} minutes on it, starting now`);
}
