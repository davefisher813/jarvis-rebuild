// THE CONFIRMATION (Track 3, 2026-09-19).
//
// The booking page has been telling visitors "a confirmation is on its way"
// since the day it shipped, and nothing sent one. That was the single line in
// the whole feature that was a promise rather than a fact. This is the words
// and the calendar file behind it, kept pure so both can be tested rather
// than eyeballed once in a mail client and trusted forever.
//
// WHOSE CLOCK THE EMAIL IS ON. A receipt that states the time in the host's
// zone asks a stranger to do arithmetic about a meeting they have already
// agreed to, which is exactly when a person gets it wrong and misses it. The
// time is written in the VISITOR's zone, and the host's zone is stated once
// underneath so nobody has to guess whose morning it is. When the two zones
// are the same it is said once, because repeating it reads as a mistake.
//
// WHY AN .ICS AND NOT AN INVITE. A real invitation (METHOD:REQUEST) makes a
// mail client offer Yes, No and Maybe, and those answers are sent back to an
// organizer address that has nothing listening. Offering a button that does
// nothing is worse than not offering it, so this attaches a PUBLISH calendar
// file: the visitor's client offers "add to calendar", which is the one thing
// it can actually do.
//
// CANCELLING IS THE EXCEPTION (2026-09-19). METHOD:CANCEL is the one case
// where a client should act on the file rather than offer a button, and every
// client does: it takes the event off the calendar. It works only when the UID
// matches the file that put it there and the SEQUENCE is higher, which is why
// the uid is built from the booking id in one place and never improvised.

/** A TEXT value inside a calendar file. The escapes are not optional: an
 *  unescaped comma or semicolon in a meeting name ends the property early and
 *  the event silently loses its title in some clients. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** RFC 5545 counts octets, not characters, and folds at 75 of them with a
 *  leading space on each continuation. A name with an accent in it is two
 *  octets, so the fold is measured in bytes or it is measured wrong. */
export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cut = 0;
  let limit = 75;
  while (cut < bytes.length) {
    // Never split a multi-byte character: back off until the slice decodes
    // cleanly, which costs at most three attempts.
    let end = Math.min(cut + limit, bytes.length);
    let piece = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(cut, end));
    while (end > cut + 1 && piece.includes("�")) {
      end -= 1;
      piece = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(cut, end));
    }
    out.push(cut === 0 ? piece : " " + piece);
    cut = end;
    limit = 74; // the leading space on a continuation counts toward the 75
  }
  return out.join("\r\n");
}

/** A UTC timestamp in the form a calendar file uses. */
export function icsStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface IcsInput {
  uid: string;
  startMs: number;
  endMs: number;
  summary: string;
  description?: string;
  hostEmail: string;
  guestEmail: string;
  guestName: string;
  stampMs?: number;
  /** PUBLISH by default. CANCEL takes the event back off the calendar, and
   *  only works against the same uid with a higher sequence. */
  cancel?: boolean;
}

/** The one place a booking's calendar uid is built. Two messages about the
 *  same meeting have to agree on it or the cancellation removes nothing. */
export function icsUid(bookingId: string): string {
  return bookingId + "@jarvis.booking";
}

/** One event, in UTC, that any calendar can read. UTC rather than a named
 *  zone on purpose: a floating or zoned time depends on the reader's client
 *  agreeing about that zone's rules, and an absolute instant does not. */
export function buildIcs(i: IcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JARVIS//Booking//EN",
    "CALSCALE:GREGORIAN",
    i.cancel ? "METHOD:CANCEL" : "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + i.uid,
    // A client only replaces what it already holds when the sequence advances.
    "SEQUENCE:" + (i.cancel ? "1" : "0"),
    "DTSTAMP:" + icsStamp(i.stampMs ?? Date.now()),
    "DTSTART:" + icsStamp(i.startMs),
    "DTEND:" + icsStamp(i.endMs),
    "SUMMARY:" + escapeIcsText(i.summary),
    ...(i.description ? ["DESCRIPTION:" + escapeIcsText(i.description)] : []),
    "ORGANIZER;CN=" + escapeIcsText(i.hostEmail) + ":mailto:" + i.hostEmail,
    "ATTENDEE;CN=" + escapeIcsText(i.guestName) + ";ROLE=REQ-PARTICIPANT:mailto:" + i.guestEmail,
    i.cancel ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** A zone name the runtime will actually accept, or the fallback. A visitor's
 *  browser is asked what zone it is in and a stranger's browser is not a
 *  trusted source, so the answer is tried before it is used. */
export function safeZone(zone: string | undefined, fallback: string): string {
  if (!zone) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
    return zone;
  } catch {
    return fallback;
  }
}

const dayIn = (ms: number, zone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric" }).format(new Date(ms));
const timeIn = (ms: number, zone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(ms));

export interface ReceiptInput {
  typeName: string;
  startMs: number;
  endMs: number;
  guestName: string;
  guestZone: string;
  hostZone: string;
  hostEmail: string;
  /** Where they go if they cannot make it. Optional because the server can
   *  only build it when it knows its own address, and a receipt with no way
   *  out is still a receipt: the reply line below is the fallback, and it has
   *  always been true. */
  cancelUrl?: string;
}

/** The subject and the words. Short on purpose: a receipt has one job, which
 *  is to let a person see at a glance that the time they picked is the time
 *  that got booked. Everything else is noise in an inbox. */
export function receiptWords(i: ReceiptInput): { subject: string; body: string } {
  const day = dayIn(i.startMs, i.guestZone);
  const from = timeIn(i.startMs, i.guestZone);
  const to = timeIn(i.endMs, i.guestZone);
  const subject = `Confirmed: ${i.typeName}, ${day} at ${from}`;
  const sameZone = i.guestZone === i.hostZone;
  const lines = [
    `${i.guestName}, your ${i.typeName.toLowerCase()} is booked.`,
    "",
    `${day}`,
    `${from} to ${to} (${i.guestZone})`,
    ...(sameZone ? [] : [`${timeIn(i.startMs, i.hostZone)} in ${i.hostZone}`]),
    "",
    "The calendar file attached will add it to your calendar.",
    "",
    // A LINK, NOT A REQUEST (2026-09-19). "Reply and ask" puts the work on the
    // host and leaves the visitor unsure whether anything happened, which is
    // how a cancellation becomes a no-show. One address, one tap, done.
    ...(i.cancelUrl ? [`Cannot make it? Cancel it here: ${i.cancelUrl}`, ""] : []),
    `To move it, or for anything else, reply to this email and it reaches ${i.hostEmail} directly.`,
  ];
  return { subject, body: lines.join("\n") };
}

/** The words for a meeting that is off. Short, and it leads with the fact
 *  rather than with an apology: somebody skimming a subject line on a phone
 *  needs to know whether to leave the house. The reason, if there is one, is
 *  the host's own words and goes underneath. */
export function cancelWords(i: ReceiptInput & { reason?: string }): { subject: string; body: string } {
  const day = dayIn(i.startMs, i.guestZone);
  const from = timeIn(i.startMs, i.guestZone);
  const subject = `Cancelled: ${i.typeName}, ${day} at ${from}`;
  const reason = (i.reason ?? "").trim();
  const lines = [
    `${i.guestName}, your ${i.typeName.toLowerCase()} on ${day} at ${from} has been cancelled.`,
    ...(reason ? ["", reason] : []),
    "",
    "Nothing is expected of you. The time is free again, so you can book another if you still want one.",
    "",
    `If this is a mistake, reply to this email and it reaches ${i.hostEmail} directly.`,
  ];
  return { subject, body: lines.join("\n") };
}

/** The whole message, ready for the sender. Kept here rather than in the
 *  endpoint so the shape of a confirmation is one testable thing. */
export interface Receipt { to: string; subject: string; body: string; attachment: { filename: string; mimeType: string; content: string } }

export function buildReceipt(i: ReceiptInput & { bookingId: string; guestEmail: string; stampMs?: number }): Receipt {
  const { subject, body } = receiptWords(i);
  const ics = buildIcs({
    uid: icsUid(i.bookingId),
    startMs: i.startMs,
    endMs: i.endMs,
    summary: `${i.typeName} with ${i.guestName}`,
    description: body,
    hostEmail: i.hostEmail,
    guestEmail: i.guestEmail,
    guestName: i.guestName,
    ...(i.stampMs === undefined ? {} : { stampMs: i.stampMs }),
  });
  return {
    to: i.guestEmail,
    subject,
    body,
    // text/calendar rather than application/ics: it is what every client
    // recognises as something it can add, and the .ics name is the belt.
    attachment: { filename: "invite.ics", mimeType: "text/calendar; charset=UTF-8; method=PUBLISH", content: ics },
  };
}

/** The cancellation, ready for the sender. The attached file carries the same
 *  uid as the confirmation did and a higher sequence, which is what makes a
 *  calendar remove the event rather than add a second one. */
export function buildCancellation(i: ReceiptInput & { bookingId: string; guestEmail: string; reason?: string; stampMs?: number }): Receipt {
  const { subject, body } = cancelWords(i);
  const ics = buildIcs({
    uid: icsUid(i.bookingId),
    startMs: i.startMs,
    endMs: i.endMs,
    summary: `${i.typeName} with ${i.guestName}`,
    hostEmail: i.hostEmail,
    guestEmail: i.guestEmail,
    guestName: i.guestName,
    cancel: true,
    ...(i.stampMs === undefined ? {} : { stampMs: i.stampMs }),
  });
  return {
    to: i.guestEmail,
    subject,
    body,
    attachment: { filename: "cancelled.ics", mimeType: "text/calendar; charset=UTF-8; method=CANCEL", content: ics },
  };
}
