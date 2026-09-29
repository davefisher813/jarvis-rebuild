import { useEffect, useState, type ReactNode } from "react";
import FilingSheet from "../ai/FilingSheet";
import { useOptionalBrainMemory } from "../data/NotesProvider";
import { emailFilingText } from "./emailFilingText";

// "FILE IT" ON AN EMAIL THREAD (Brain, 2026-09-29), kept out of MessagesFlow.
//
// The Email screen is thousands of lines and returns early for every view, so
// the feature lives here and the screen touches it in three places: call this
// hook, put one button in the thread's bar, and render `sheet` in the thread
// view. `sheet` is the app's one FilingSheet (remember mode: Philosophy,
// Value, Fact), a portal, so it draws over the screen wherever it is mounted.
//
// WITHOUT BRAIN THERE IS NO DOOR: `available` is false and the screen renders
// no button. Filing is manual, so it never touches the AI gate and works with
// AI off or the AI budget spent.
//
// ONE SHEET, TIED TO THE THREAD VIEW. `active` says the thread view is the
// one on screen. Leaving it (back, a deep link, the thread archived out from
// under the sheet) drops the target, so the sheet cannot resurface later on a
// different thread. The key carries the thread, so opening it for another
// thread starts a fresh form.
//
// WHAT IS LINKED: nothing. A Gmail thread id is not an entity of this app, so
// it never goes in linkedItemIds. The row's `source` says it came from email
// and the words are the subject and preview as the person can see them.

export interface EmailFilingTarget {
  threadId: string;
  /** The Google account the thread lives in; part of the sheet's identity so
   *  the same thread id in two accounts never shares a form. */
  account?: string | undefined;
  subject: string;
  preview: string;
}

export function useEmailFiling(active: boolean): {
  available: boolean;
  open: (t: EmailFilingTarget) => void;
  sheet: ReactNode;
} {
  const brain = useOptionalBrainMemory();
  const [target, setTarget] = useState<EmailFilingTarget | null>(null);

  useEffect(() => {
    if (!active) setTarget(null);
  }, [active]);

  const sheet = active && target ? (
    <FilingSheet
      key={`email:${target.account ?? ""}:${target.threadId}`}
      mode="remember"
      initialText={emailFilingText(target.subject, target.preview)}
      source="email"
      onClose={() => setTarget(null)}
    />
  ) : null;

  return { available: !!brain, open: setTarget, sheet };
}
