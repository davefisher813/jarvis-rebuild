import { lineCase } from "../shared/casing";
import type { Encouragement } from "./prefs";

// THE WORDS. One plain sentence saying what is now true, built here so the
// casing rule owns them and the Encouragement setting can change the tone
// without changing the facts. Nothing here scores, ranks, compares or
// scolds; the count is always a real count of this task's own steps.
//
// Factual (default): says what happened and where things stand.
// Warm: the same facts with a kind first word.
// Minimal: only that it happened.

/** "1 of 4 Complete": one labelled quantity, never a percentage. */
export function progressLabel(done: number, total: number): string {
  return lineCase(`${done} of ${total} complete`);
}

export function stepDoneLine(style: Encouragement, done: number, total: number): string {
  const count = progressLabel(done, total);
  if (style === "minimal") return "Done";
  if (style === "warm") return lineCase(`Nice work · ${count}`);
  return lineCase(`Step done · ${count}`);
}

/** The last open step on a task. The task itself stays open: finishing it is
 *  its own tap, so this is a milestone and never a second completion. */
export function allDoneLine(style: Encouragement): string {
  if (style === "minimal") return "All Done Here";
  if (style === "warm") return lineCase("Every step is done · close the task when you are ready");
  return lineCase("All done here · close the task when ready");
}

export function workedLine(style: Encouragement): string {
  if (style === "minimal") return "Logged";
  if (style === "warm") return lineCase("Logged · time on this counts");
  return lineCase("Logged · worked on it");
}

/** Stopping is a legitimate outcome. Nothing here says unfinished, left
 *  undone or incomplete. */
export function stopLine(style: Encouragement): string {
  if (style === "minimal") return "Saved";
  return lineCase("Saved · your next move is ready");
}

export function undoLine(style: Encouragement): string {
  if (style === "minimal") return "Undone";
  return lineCase("Undone · back where you were");
}
