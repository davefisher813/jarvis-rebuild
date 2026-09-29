// WHOSE MAIL IS THIS, IN ONE KEY (2026-09-29).
//
// A Gmail thread id is only unique inside one mailbox. Two connected accounts
// can hold a thread with the same id, and the app kept rows, selections,
// undo lists and snapshots keyed on the bare id, so a tap on one account's
// row could resolve to the other account's thread, and a Delete could go to
// the wrong mailbox. The internal id of a thread or message now carries the
// signed-in JARVIS user and the Gmail account it lives in. Gmail itself is
// never sent these keys: every request still takes the raw provider id.
//
// The account is normalised for identity only: whitespace trimmed, case
// folded. Gmail's own dot and plus rules are NOT applied. "a.b@x.com" and
// "ab@x.com" are the same mailbox to Gmail, but which of them the person
// connected is the truth the app holds, and collapsing them here would be a
// guess that merges two rows on some other provider's behalf.
//
// Every part is percent-encoded before joining, so the ":" separators cannot
// be forged by an odd id or address. Pure, no imports.

export type MailScope = { userId: string; account: string };

/** The account as identity: trimmed and lowercased, nothing else. */
export function normalizeAccount(email: string): string {
  return email.trim().toLowerCase();
}

const part = (s: string): string => encodeURIComponent(s);

/** One user's one Gmail account. */
export function mailAccountKey(scope: MailScope): string {
  return "mail:" + part(scope.userId) + ":" + part(normalizeAccount(scope.account));
}

/** A thread inside that account. `threadId` is Gmail's raw id, kept as given. */
export function mailThreadKey(scope: MailScope, threadId: string): string {
  return mailAccountKey(scope) + ":t:" + part(threadId);
}

/** A message inside that account. `messageId` is Gmail's raw id, kept as given. */
export function mailMessageKey(scope: MailScope, messageId: string): string {
  return mailAccountKey(scope) + ":m:" + part(messageId);
}
