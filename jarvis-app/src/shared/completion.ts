// THE DOPAMINE LAYER (Dave 2026-08-20: "need dopamine effect... whatever
// studies show people respond to best").
//
// So this is built from the evidence, not from vibes. Four findings drove
// every decision here, and each one is named at the rule it produced.
//
// 1. IMMEDIACY BEATS SIZE. ADHD is characterised by steep delay discounting
//    and delay aversion: a delayed reward is devalued sharply, sometimes to
//    nothing. A payoff at the end of a project is, neurologically, not a
//    payoff. Everything here fires on the tap itself.
//
// 2. PROGRESS IN MEANINGFUL WORK IS THE STRONGEST MOTIVATOR THERE IS
//    (Amabile & Kramer, The Progress Principle). Nothing they measured beat
//    it, and SMALL wins move it a lot. So the reward is not a trophy bolted
//    onto the app; it is showing the person what their tick just moved.
//
// 3. THE GOAL GRADIENT. Effort accelerates as the finish line gets closer.
//    So the closer a project gets, the more concrete the language gets:
//    "3 left" beats "62%", and "last one" beats "1 left".
//
// 4. UNPREDICTABLE REWARD PRODUCES A STRONGER DOPAMINE RESPONSE than a
//    predictable one (reward prediction error). But that is also the exact
//    mechanic of a slot machine. The resolution: the reward is ALWAYS
//    certain, only its FORM varies. Credit never depends on chance; which
//    celebration you get does. That gets the novelty without the compulsion.
//
// And one deliberate omission. STREAKS ARE NOT HERE. Amabile also found the
// asymmetry: setbacks hurt inner work life more than equivalent progress
// helps it, and loss aversion means a broken 90-day streak does not feel
// like missing one day, it feels like losing 90. A mechanic whose downside
// is bigger than its upside is a bad trade for someone who already has hard
// days. If Dave wants them anyway, that is his call to make knowingly.

import { capAfterNumber } from "./casing";

export type WinKind = "task" | "project" | "goal";

// --- 3. The goal gradient -------------------------------------------------

// What a project has left, phrased to pull harder the closer it gets. A
// percentage is a status report; a count is a finish line you can see.
export function gradientLine(done: number, total: number): string {
  if (total <= 0) return "";
  const left = total - done;
  if (left <= 0) return "That was the last one";
  // Words up to four, a ratio past that. Words keep the countdown reading as
  // a sentence rather than a dashboard, and the number-lead capital only has
  // to apply in the one place a digit actually starts the line.
  const WORDS = ["", "One", "Two", "Three", "Four"];
  if (left <= 4) return `${WORDS[left]} left`;
  return capAfterNumber(`${done} of ${total} done`);
}

// True when finishing this task finished the work behind a project, which is
// the moment to offer the completion rather than making him find a form.
export function clearsProject(done: number, total: number): boolean {
  return total > 0 && done >= total;
}

// --- 1 + 2. What the tap just moved ---------------------------------------

export interface Moved {
  projectTitle: string;
  line: string;      // the gradient line
  cleared: boolean;  // every task under it is now done
}

// The receipt shown at the instant of the tick. Null when the task belongs to
// nothing bigger: inventing a consequence for a loose task would make the
// real ones mean less.
export function movedBy(
  projectTitle: string | null | undefined,
  done: number,
  total: number,
): Moved | null {
  if (!projectTitle || total <= 0) return null;
  return { projectTitle, line: gradientLine(done, total), cleared: clearsProject(done, total) };
}

// --- 4. Certain reward, varying form --------------------------------------

// Deliberately plain. No exclamation marks, no "you crushed it", nothing that
// reads as a slot machine congratulating a gambler. Variety is what stops the
// response habituating; volume is not.
const TASK_LINES = [
  "Done",
  "That's one",
  "Off the list",
  "Handled",
  "Gone",
  "Cleared",
];

const CLEARED_LINES = [
  "That's the lot",
  "All of it, done",
  "Nothing left on it",
];

// The variation is a FUNCTION of the completion, not of chance: the same tick
// always shows the same line, so nothing feels like a spin, and re-renders
// cannot flicker between two messages mid-animation. Across many completions
// it still cycles, which is all habituation needs.
function pick(list: string[], seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return list[Math.abs(h) % list.length] ?? list[0]!;
}

export function celebrationLine(kind: WinKind, seed: string, cleared = false): string {
  if (kind === "goal") return "Goal achieved";
  if (kind === "project") return "Project done";
  return cleared ? pick(CLEARED_LINES, seed) : pick(TASK_LINES, seed);
}

// How loud the moment should be. Ticking a loose task and finishing the last
// task of a six-month project are not the same event and must not feel the
// same; escalating the burst is the cheapest way to say so.
export type BurstSize = "small" | "big";

export function burstSize(moved: Moved | null): BurstSize {
  return moved?.cleared ? "big" : "small";
}
