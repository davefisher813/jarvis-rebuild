import { extractActionEvidence, type ActionEvidenceBundle, type EvidenceInput } from "./notificationActions";

// SAMPLE NOTIFICATION MAIL for the notification tests (2026-09-29). Shaped like
// what the real senders send (Google Docs, Google Calendar, DocuSign, UPS,
// Netflix), trimmed to what the reader cares about. Test support only.

export const CODE = "004291";

export interface Sample {
  threadId: string;
  messageId: string;
  fromEmail: string;
  from: string;
  subject: string;
  body: string;
  html?: string;
  listUnsubscribe?: string;
  ics?: string[];
}

const s = (over: Partial<Sample> & Pick<Sample, "fromEmail" | "subject" | "body">): Sample => ({
  threadId: "t1", messageId: "m1", from: over.fromEmail, ...over,
});

export const driveRequest = s({
  fromEmail: "drive-shares-noreply@google.com", from: "Maya Chen (Google Docs)",
  subject: "Request for access to 'Q3 Roster'",
  body: "Maya Chen is requesting access to the following item:\nQ3 Roster\nGoogle LLC, 1600 Amphitheatre Parkway",
  html: '<a href="https://docs.google.com/document/d/1AbCdEf/edit?usp=sharing_eip&amp;ts=65a">Q3 Roster</a>'
    + '<a href="https://docs.google.com/document/d/1AbCdEf/edit?usp=access_request&amp;ts=65a">Share</a>'
    + '<a href="https://support.google.com/docs/answer/2494822">Help</a>',
});

export const driveShare = s({
  fromEmail: "drive-shares-dm-noreply@google.com", from: "Maya Chen (Google Drive)",
  subject: "Maya Chen shared 'Season Budget' with you",
  body: "Maya Chen has shared the following spreadsheet with you: Season Budget",
  html: '<a href="https://docs.google.com/spreadsheets/d/1XyZ/edit?usp=sharing&amp;ts=1">Open</a>',
});

// A floating local time on purpose: the same wall time in every zone the suite runs in.
export const ICS_ONE = [
  "BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:abc123@google.com",
  "DTSTART:20261006T160000", "DTEND:20261006T170000", "SUMMARY:Practice Plan", "STATUS:CONFIRMED",
  "END:VEVENT", "END:VCALENDAR",
].join("\r\n");

export const calendarInvite = s({
  fromEmail: "calendar-notification@google.com", from: "Coach Ana (Google Calendar)",
  subject: "Invitation: Practice Plan @ Tue Oct 6, 2026 4pm - 5pm",
  body: "Coach Ana has invited you to Practice Plan. Tuesday Oct 6, 4pm to 5pm. Reply for Dave: Yes No Maybe",
  html: '<a href="https://calendar.google.com/calendar/event?action=RESPOND&amp;eid=EID1&amp;rst=1&amp;tok=T&amp;ctz=America/New_York">Yes</a>'
    + '<a href="https://calendar.google.com/calendar/event?action=RESPOND&amp;eid=EID1&amp;rst=2&amp;tok=T">No</a>'
    + '<a href="https://calendar.google.com/calendar/event?action=RESPOND&amp;eid=EID1&amp;rst=3&amp;tok=T">Maybe</a>'
    + '<a href="https://calendar.google.com/calendar/event?action=VIEW&amp;eid=EID1&amp;tok=T">more options</a>',
  ics: [ICS_ONE],
});

export const docusign = s({
  fromEmail: "dse@docusign.net", from: "DocuSign",
  subject: "Please DocuSign: Lease Renewal.pdf",
  body: "Jordan Lee sent you a document to review and sign. REVIEW DOCUMENT",
  html: '<a href="https://na3.docusign.net/Signing/EmailStart.aspx?a=abc&amp;er=def">REVIEW DOCUMENT</a>'
    + '<a href="https://www.docusign.com/how-it-works/electronic-signature/signing-with-docusign">Alternate Signing Method</a>'
    + '<a href="https://support.docusign.com/guides/signer-guide">About DocuSign</a>',
});

export const shipment = s({
  fromEmail: "pkginfo@ups.com", from: "UPS",
  subject: "UPS Update: Package Scheduled for Delivery Tomorrow",
  body: "Your package is on its way. Tracking Number: 1Z999AA10123456784",
  html: '<a href="https://wwwapps.ups.com/track?loc=en_US&amp;tracknum=1Z999AA10123456784">Track Package</a>'
    + '<a href="https://www.ups.com/privacy">Privacy Notice</a>',
});

const icsEvent = (uid: string, start: string, end: string, summary: string) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART${start}`, `DTEND${end}`, `SUMMARY:${summary}`, "END:VEVENT"].join("\r\n");
const cal = (...events: string[]) => ["BEGIN:VCALENDAR", "METHOD:PUBLISH", ...events, "END:VCALENDAR"].join("\r\n");

export const flightOne = s({
  fromEmail: "DeltaAirLines@e.delta.com", from: "Delta",
  subject: "Your flight itinerary confirmation",
  body: "Thanks for booking. Flight DL 412 JFK to ATL departs Oct 9 at 7:15 AM.",
  ics: [cal(icsEvent("f1", ":20261009T071500", ":20261009T093000", "DL 412 JFK to ATL"))],
});

export const flightTwoLegs = s({
  fromEmail: "DeltaAirLines@e.delta.com", from: "Delta",
  subject: "Your flight itinerary confirmation",
  body: "Outbound DL 412 Oct 9. Return DL 977 Oct 12.",
  ics: [cal(icsEvent("f1", ":20261009T071500", ":20261009T093000", "DL 412 JFK to ATL"), icsEvent("f2", ":20261012T180000", ":20261012T200000", "DL 977 ATL to JFK"))],
});

export const hotelAllDay = s({
  fromEmail: "reservations@hilton.com", from: "Hilton",
  subject: "Your hotel reservation is confirmed",
  body: "Check-in Oct 9, check-out Oct 12.",
  ics: [cal(["BEGIN:VEVENT", "UID:h1", "DTSTART;VALUE=DATE:20261009", "DTEND;VALUE=DATE:20261012", "SUMMARY:Hilton Atlanta", "END:VEVENT"].join("\r\n"))],
});

export const googleForm = s({
  fromEmail: "ana@northlake.org", from: "Coach Ana",
  subject: "Please fill out the tournament waiver form",
  body: "Please fill it out by Friday.",
  html: '<a href="https://docs.google.com/forms/d/e/1FAIpQLSfXYZ/viewform?usp=sf_link">Fill out form</a>',
});

export const paymentFailed = s({
  fromEmail: "info@mailer.netflix.com", from: "Netflix",
  subject: "Payment failed: update your payment method",
  body: "We were unable to process your payment. Please update your payment method.",
  html: '<a href="https://www.netflix.com/youraccount?nftoken=xyz">Update Payment Now</a>'
    + '<a href="https://help.netflix.com/en/node/407">Help Center</a>',
});

export const otp = s({
  fromEmail: "no-reply@acme.com", from: "Acme",
  subject: "Your Acme verification code",
  body: `Your verification code is ${CODE}. It expires in 10 minutes.`,
});

export const otpTwoCodes = s({
  fromEmail: "no-reply@acme.com", from: "Acme",
  subject: "Your Acme verification code",
  body: `Your verification code is ${CODE}.\nYour previous code: 118822 has expired.`,
});

export const otpInSubject = s({
  fromEmail: "no-reply@accounts.example.org", from: "Example",
  subject: "123456 is your Example verification code",
  body: "Do not share this code with anyone.",
});

export const otpNoCode = s({
  fromEmail: "no-reply@acme.com", from: "Acme",
  subject: "Your Acme verification code",
  body: "Use the code shown in the app to finish signing in.",
});

export const newsletterBoth = s({
  fromEmail: "news@trailweekly.com", from: "Trail Weekly",
  subject: "This week on the trail",
  body: "Ten routes for October.",
  listUnsubscribe: "<mailto:unsub@trailweekly.com?subject=unsubscribe>, <https://trailweekly.com/u/123>",
});

export const newsletterWeb = s({
  fromEmail: "news@trailweekly.com", from: "Trail Weekly",
  subject: "This week on the trail",
  body: "Ten routes for October.",
  listUnsubscribe: "<https://trailweekly.com/u/123>",
});

export const bundleFor = (m: Sample, over: Partial<EvidenceInput> = {}): ActionEvidenceBundle =>
  extractActionEvidence({
    threadId: m.threadId, messageId: m.messageId, revision: m.messageId,
    fromEmail: m.fromEmail, subject: m.subject, body: m.body,
    ...(m.html ? { html: m.html } : {}),
    ...(m.listUnsubscribe ? { listUnsubscribe: m.listUnsubscribe } : {}),
    ...(m.ics ? { ics: m.ics } : {}),
    ...over,
  });
