// WHO A PIECE OF MAIL BELONGS TO, IN ONE PLACE.
//
// A cache key that says only "thread 17c9a" is a bug waiting for a second
// account, or a second sign-in on the same phone: the same id in another
// mailbox would read the first one's rows. Every key this app stores mail
// state under carries the owner (the signed-in user), the mailbox (the
// Google account, normalised) and the thread or message inside it.
//
// Gmail itself still gets the RAW provider id. These keys are ours: they name
// things in OUR storage and never travel to Google.

/** Whose mail: the signed-in user, and which of their Google accounts. */
export interface MailScope {
  userId: string;
  account: string;
}

/** Trim and lower-case only. Gmail's own dot and plus rules are left alone:
 *  they belong to Google, and guessing at them would merge two mailboxes. */
export function normalizeAccount(email: string): string {
  return email.trim().toLowerCase();
}

function part(v: string): string {
  // The separator is a character no user id, email or Gmail id contains, so a
  // key can never be forged by an id that happens to look like another key.
  return v.replace(/\u001f/g, "");
}

export function mailAccountKey(scope: MailScope): string {
  return `${part(scope.userId)}\u001f${part(normalizeAccount(scope.account))}`;
}

export function mailThreadKey(scope: MailScope, threadId: string): string {
  return `${mailAccountKey(scope)}\u001f${part(threadId)}`;
}

export function mailMessageKey(scope: MailScope, messageId: string): string {
  return `${mailAccountKey(scope)}\u001fm\u001f${part(messageId)}`;
}
