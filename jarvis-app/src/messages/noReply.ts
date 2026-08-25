// A MAILBOX NOBODY READS (Dave 2026-08-25, from the email audit).
//
// His screenshot: an appointment reminder that says "IMPORTANT: This is an
// automated message. Please do not reply. For any questions please contact
// your provider." Underneath it, JARVIS offered "Got it, thanks.", "Adding
// this to my calendar." and "Will I need to reschedule?", plus a Reply button.
//
// Every one of those bounces. Worse, "Will I need to reschedule?" is a real
// question he would then believe was asked.
//
// The knowledge was already in this repo, twice: waiting.ts and autoReply.ts
// each carried a private copy of the same regex, and the thread screen (the
// one surface where a person actually presses Reply) consulted neither. Two
// copies of a rule is one rule and one bug waiting to be found; this is the
// single copy, and it is exported so the screen can ask.

// The address forms. `notifications@` and friends catch the senders that do
// not say "noreply" but are just as deaf.
export const AUTOMATED_ADDRESS = /no-?reply|donotreply|do-not-reply|notifications?@|mailer-daemon|postmaster@|bounce|@docs\.|@calendar-server\./i;

// What the message says about itself. A sender using a perfectly ordinary
// address can still open with "do not reply to this message", and that
// sentence is more reliable than any address heuristic.
const SAYS_SO = /\b(do not reply|don'?t reply|no reply (is )?(needed|necessary|required)|this (is an? )?automated (message|email|reminder|notification)|unmonitored (mailbox|inbox)|replies (to this|are not) )/i;

/**
 * Can a reply to this reach a human?
 *
 * Deliberately generous about what counts as automated, because the cost is
 * asymmetric: hiding a reply button on a mailbox that would have accepted one
 * costs a tap (the thread still opens, Forward still works), and OFFERING one
 * on a mailbox that will not costs a reply he believes he sent.
 */
export function isNoReply(fromEmail: string, body = ""): boolean {
  if (AUTOMATED_ADDRESS.test((fromEmail || "").toLowerCase())) return true;
  // Only the opening of the message. A newsletter's footer boilerplate at the
  // bottom of a genuine person's forwarded thread is not that person saying
  // they will not read a reply.
  return SAYS_SO.test((body || "").slice(0, 600));
}
