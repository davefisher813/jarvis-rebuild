import { readMirror, SETTING_DONE_CLEARING } from "../data/SettingsService";

// DOES A FINISHED THING CLOSE ITSELF? (Dave 2026-09-12: "the user should be
// able to decide if it automatically clears or needs permission".)
//
// Two answers, and only two:
//
//   ask   a project whose tasks are all ticked, or a goal whose measure is
//         met, is READY to close and says nothing more. Closing it is a tap:
//         Mark Done on the project, Mark Achieved on the goal. This is the
//         default, and it is the 2026-09-09 ruling ("a done confirmation
//         should be MANDATORY to clear items") left standing.
//   auto  the arithmetic closes it, which is what the app did before that
//         ruling and what he may want back.
//
// Read synchronously off the settings mirror so a row can ask the question
// while it renders; the account's copy is pulled at boot like the appearance
// (shell/AppShell.tsx) and written from Settings, Advanced. A phone that has
// never been told reads "ask", which is the safe half: nothing closes behind
// him because a setting had not synced yet.

export type DoneClearing = "ask" | "auto";

export const DONE_CLEARING_DEFAULT: DoneClearing = "ask";

export function readDoneClearing(): DoneClearing {
  return readMirror<DoneClearing>(SETTING_DONE_CLEARING)?.value === "auto" ? "auto" : DONE_CLEARING_DEFAULT;
}

/** The one question every caller actually has. */
export function clearsDoneAutomatically(): boolean {
  return readDoneClearing() === "auto";
}
