import { mailNotices, taskTitleFrom, type MailSnapshot, type MailNotice } from "../messages/home";
import { capAfterNumber, titleCase } from "../shared/casing";

// THE FIRST THIRTY SECONDS (UP-MIND-13, Email 5.10, build order 11).
//
// The connect screen said "Connected" and offered Continue. That is a
// receipt for a permission grant, and the #1 documented reason people
// abandon a mail client is friction at exactly this moment. This is what
// replaces it: the app looks at the last thirty days and shows what it
// found, in the user's own mail, with the sentence it read it from and one
// thing they can do about it.
//
// Three refusals hold the whole screen up:
//   - It is NOT A TOUR. Every row is a real thread from this inbox.
//   - IT NEVER CLAIMS CLEAN WHEN IT DOES NOT KNOW. A failed fetch is a
//     different screen from an empty inbox (EMAIL-F-04's whole lesson), and
//     the caller decides which by whether the read actually succeeded.
//   - The count is the true count, not the number of rows shown.

export interface FoundRow {
  key: string;
  /** Who it is from, or what the promise was. */
  title: string;
  /** The sentence this claim came from: the verbatim span when UP-MIND-12
   *  anchored one, the gist otherwise. Never a rewrite. */
  sentence: string;
  /** What the one action writes. */
  taskText: string;
  due?: string;
}

/** Everything still open, counted once each: threads that need an answer,
 *  people waiting on one, and promises made in sent mail. */
export function openCount(snap: MailSnapshot): number {
  return snap.needsYou + snap.waiting.length + snap.promises.length;
}

export function foundLine(n: number): string {
  return capAfterNumber(
    n === 1
      ? "I found 1 thing still open from the last 30 days"
      : `I found ${n} things still open from the last 30 days`,
  );
}

// The true alternative, and it is a good outcome, not an empty state.
export const FOUND_CLEAN = "Your last 30 days are clean, nothing is waiting on you";
// EMAIL-F-04: a read that failed must never read as clean.
export const FOUND_UNKNOWN = "Couldn't read your mail just now";

function sentenceFor(n: MailNotice, snap: MailSnapshot): string {
  // UP-MIND-12's verbatim span, when the claim has one. It is the sender's
  // own words, which is the whole reason it is worth showing here.
  if (n.evidence?.span) return n.evidence.span;
  const t = snap.threads.find((x) => x.id === n.threadId);
  return t?.gist || t?.snippet || n.sub;
}

/** The three examples, off the same ranking the home page uses, so the first
 *  thing the user sees here is the first thing they will see tomorrow. */
export function foundRows(snap: MailSnapshot, today: string, now = new Date(), max = 3): FoundRow[] {
  return mailNotices(snap, today, now, max).map((n) => {
    const t = snap.threads.find((x) => x.id === n.threadId);
    // Every row's action writes a task, because that is the one thing this
    // screen can genuinely finish without leaving onboarding. A button that
    // opened a tab that does not exist yet would be a control that lies.
    const taskText = n.task?.text ?? (t ? taskTitleFrom(t.subject, t.from) : titleCase(n.title));
    return {
      key: n.key,
      title: n.title,
      sentence: sentenceFor(n, snap),
      taskText,
      ...(n.task?.due ? { due: n.task.due } : {}),
    };
  });
}
