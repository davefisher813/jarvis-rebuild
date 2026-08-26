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

// The wider net for PRESENTATION decisions only (2026-08-26). Dave's inbox:
// Custom Ink, Crexi and Northlake all wore warm human discs, because their
// addresses (marketing@, alerts@, news@) say nothing about replies and the
// face rule only knew AUTOMATED_ADDRESS. These locals are the bulk-mail
// trade's uniform; no colleague writes from promo@.
//
// Deliberately NOT here: info@, hello@, support@, team@, office@. Small
// businesses and doctors' offices write real mail from those, and a person
// misfiled as a machine is a worse error than a machine wearing a face.
// This regex also never gates BEHAVIOR (replies, archiving): it decides how
// a row DRESSES, and the reply plumbing keeps its own narrower rule above.
export const BULK_ADDRESS = /alerts?@|news@|newsletters?@|marketing@|promos?@|promotions?@|offers?@|deals@|sales@|digest@|updates?@|billing@|receipts?@|invoices?@|store@|shop@|email@|mail@|hi@|events@/i;

/** A machine for PRESENTATION: rails, faces, and the peek's people count. */
export function isMachineAddress(fromEmail: string): boolean {
  return AUTOMATED_ADDRESS.test(fromEmail) || BULK_ADDRESS.test(fromEmail);
}

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
/**
 * Did this go to a list?
 *
 * Separate from isNoReply because it licenses more: a marketing blast belongs
 * to no project, is nobody's to hand off, and has no person on the other end.
 * An automated APPOINTMENT reminder is none of those things, so the two
 * questions do not collapse into one.
 */
export function isBulk(listUnsubscribe = ""): boolean {
  return !!(listUnsubscribe || "").trim();
}

export function isNoReply(fromEmail: string, body = "", listUnsubscribe = ""): boolean {
  if (AUTOMATED_ADDRESS.test((fromEmail || "").toLowerCase())) return true;
  // BULK MAIL IS NOT A CONVERSATION (Dave 2026-08-25, on a RushOrderTees
  // blast). A List-Unsubscribe header is the sender declaring, in a machine
  // readable way, that this went to a list. The app was already reading that
  // header to draw an Unsubscribe button, and offering "Thanks", "Got it" and
  // "Will do" on the same screen: it knew and asked anyway.
  //
  // A reply to a marketing address reaches a queue nobody empties. This is
  // the most reliable signal of the three, because the sender set it.
  if ((listUnsubscribe || "").trim()) return true;
  // Only the opening of the message. A newsletter's footer boilerplate at the
  // bottom of a genuine person's forwarded thread is not that person saying
  // they will not read a reply.
  return SAYS_SO.test((body || "").slice(0, 600));
}
