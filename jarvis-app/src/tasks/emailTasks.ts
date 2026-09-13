import { readMirror, SETTING_EMAIL_TASKS } from "../data/SettingsService";
import type { TaskData } from "../notes/types";

// WHERE A TASK MADE FROM AN EMAIL GOES (Dave 2026-09-13: "The email is
// turning them into tasks which is fine but I don't want them going to the
// main task list. In the dropdown it should have a from email tab. If the
// user wants it to go straight to the task list it should be an option but
// not default").
//
// Two answers:
//
//   email  the default. A task the mail flow made waits under From Email in
//          the Tasks dropdown and stays out of Today, Overdue, Upcoming, All
//          and Daily until he opens it from there.
//   list   it joins the ordinary lists the way a task he typed does, and is
//          still listed under From Email too.
//
// Read synchronously off the settings mirror, the same way doneClearing.ts
// reads its switch, so the one chokepoint every task list goes through
// (filters.ts partition) can ask while it sorts. A phone that has never been
// told reads "email": nothing from the inbox lands in his day uninvited
// because a setting had not synced.

export type EmailTaskHome = "email" | "list";

export const EMAIL_TASK_HOME_DEFAULT: EmailTaskHome = "email";

export function readEmailTaskHome(): EmailTaskHome {
  try {
    return readMirror<EmailTaskHome>(SETTING_EMAIL_TASKS)?.value === "list" ? "list" : EMAIL_TASK_HOME_DEFAULT;
  } catch {
    return EMAIL_TASK_HOME_DEFAULT;
  }
}

/** The one question the task lists ask. */
export function emailTasksGoToList(): boolean {
  return readEmailTaskHome() === "list";
}

/** A task the mail flow made: stamped with an email source, or carrying the
 *  thread it came from. A task he typed himself is never one of these. */
export function isFromEmail(t: TaskData): boolean {
  return t.source?.type === "email" || !!t.fromThread;
}
