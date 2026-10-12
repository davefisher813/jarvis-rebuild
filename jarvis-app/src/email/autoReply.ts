// AN AUTOMATIC REPLY IS NOT A NEW REPLY (Email v1 spec 2026-10-08, section 5.3; migration 0071).
//
// "Auto-replies and vacation responders do not resolve anything", and on Waiting they are not New Reply evidence either.
// A machine says it wrote a message in its headers: RFC 3834's Auto-Submitted (any value but "no"), or a Precedence of
// auto_reply, bulk or junk. The sync reads both with the metadata it already fetches (api/_email.ts META_FIELDS) and keeps
// the answer as email_message.auto_reply. Rows synced before that, and a database without 0071, fall back to the subject,
// conservatively: only a subject that STARTS with an out-of-office or automatic-reply marker. The SQL in 0071 holds the
// same pattern. Pure, shared by the server and the app.

/** The subject fallback. Starts-with only, case-insensitive: "Re: Out of office hours" is a person's words, not this. */
export const AUTO_SUBJECT = /^\s*(automatic reply|auto:|auto-?reply|autoreply|out of (the )?office)/i;

export const isAutoSubject = (subject: string | null | undefined): boolean => AUTO_SUBJECT.test(subject ?? "");

/** What the message's own headers say. A header that is absent says nothing. */
export function isAutoReplyHeaders(autoSubmitted: string | null | undefined, precedence: string | null | undefined): boolean {
  const a = (autoSubmitted ?? "").trim().toLowerCase();
  if (a && a !== "no") return true;
  const p = (precedence ?? "").trim().toLowerCase();
  return p === "auto_reply" || p === "bulk" || p === "junk";
}
