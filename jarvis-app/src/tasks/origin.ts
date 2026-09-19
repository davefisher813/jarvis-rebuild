import type { TaskData } from "../notes/types";

// WHERE A TASK CAME FROM (Dave 2026-09-19, on a screenshot of five Anytime
// rows: "these are emails and it says no category").
//
// Two defects, one cause. A task born from a thread carries no area, because
// nothing on the mail side picks one; the row then had nothing to put on its
// second line and said "No category", which is a row announcing an absence
// rather than stating a fact. The headliner had already been ruled on
// (2026-09-13: "a task with no area says nothing about it") and the fix never
// reached the rows below it.
//
// So: a task says its AREA when it has one. When it does not, it says where
// it came from, if it came from somewhere worth naming. Only when it is a
// plain task with no area and no origin does the line stay empty, which is
// what an absent fact looks like.
//
// The email test is the one TodayFlow already filters Your Move by, so a
// task cannot be an email in one place and not in another: a thread behind
// it, email as its source, or the title the mail deck writes for a task it
// creates before a thread link was ever recorded.
export function isFromEmail(d: Pick<TaskData, "fromThread" | "source" | "text">): boolean {
  return !!(d.fromThread || d.source?.type === "email" || /^get back to /i.test(d.text ?? ""));
}

/** The word for where a task came from, or null when it came from nowhere
 *  worth naming. Never a colour: an origin is not an area, and the dot on
 *  this line means area. */
export function originLabel(d: Pick<TaskData, "fromThread" | "source" | "text" | "fromNote">): string | null {
  if (isFromEmail(d)) return "Email";
  if (d.fromNote || d.source?.type === "note") return "Note";
  switch (d.source?.type) {
    case "paste": return "Smart Paste";
    case "recorder": return "Recording";
    case "chat": return "Chat";
    case "file": return "File";
    default: return null;
  }
}
