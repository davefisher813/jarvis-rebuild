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
  subject: "Example: 123456 is your verification code",
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

// THE REAL SHAPE OF A GOOGLE SHARE-REQUEST MAIL (captured 2026-09-29 from a
// live one, names, address and file id replaced). Three things in it broke
// Grant Access: the button carries mso-hide:all (Outlook-only, but read as
// hidden); the words that say it is a request are "Share request for" and
// "requests access to an item"; and a message with no text part has the
// sentence only in its HTML.
const REAL_SHARE_REQUEST_HTML = `<html><head></head><body><table style="border-collapse: collapse; width: 100%; background-color: white; text-align: center;" role="presentation"><tr><td style="padding: 24px 0 16px 0;"><table style="border-collapse: collapse;font-family: Roboto, Arial, Helvetica, sans-serif;hyphens: auto; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word;width: 90%; margin: auto;max-width: 700px;min-width: 280px; text-align: left;" role="presentation"><tr><td style="padding: 0;"><table style="width:100%; border: 1px solid #dadce0; border-radius: 8px; border-spacing: 0; table-layout:fixed; border-collapse: separate;" role="presentation"><tr><td style="padding: 4.5%;" dir="ltr"><div style="margin-bottom:32px;font-family: Google Sans, Roboto, Arial, Helvetica, sans-serif; font-style: normal; font-size: 28px; line-height: 36px; color: #3c4043;">Share a spreadsheet?</div><table style="border-collapse: collapse;font-family: Roboto, Arial, Helvetica, sans-serif; font-size:16px; line-height:24px; color:#202124; letter-spacing:0.1px; table-layout:fixed; width:100%; overflow-wrap: break-word;" role="presentation"><tr><td style="padding: 0; vertical-align:top; width:50px;"><!--[if mso]><v:oval xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" style="height:50px;width:50px;" fill="t" stroke="f"><v:fill type="frame" src="https://lh3.googleusercontent.com/a/ACg8ocI1vXoLlrgG-r-Y3AEjspHp0ASFTIKwWctaH6ShmHtXLILTng=s64" alt="Header profile photo" style="height:50px;width:50px;"/></v:oval><![endif]--><div style="mso-hide:all;"><img style="border-radius:50%; display:block;" width="50" height="50" src="https://lh3.googleusercontent.com/a/ACg8ocI1vXoLlrgG-r-Y3AEjspHp0ASFTIKwWctaH6ShmHtXLILTng=s64" alt="Header profile photo"></div></td><td style="padding: 0; vertical-align:top; padding-left:12px;"><div style="padding-top:12px;">Maya Chen (<a href="mailto:maya.chen@example.com" style="color:inherit;text-decoration:none">maya.chen@example.com</a>) is <b>requesting access</b> to the following spreadsheet:</div></td></tr></table><table style="border-spacing:0 4px; table-layout:fixed; width:100%; overflow-wrap: break-word;" role="presentation"><tr style="height:28px;"></tr><tr><td style="padding: 0;"><a href="https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQ/edit?usp=sharing_esl&amp;userstoinvite=maya.chen@example.com&amp;sharingaction=manageaccess&amp;role=writer&amp;ts=6abb1991" target="_blank" style="color: #3c4043; display: inline-block; max-width: 100%; text-decoration: none; vertical-align: top;border: 1px solid #DADCE0; border-radius: 16px; white-space: nowrap;"><div style="line-height: 18px; overflow: hidden; text-overflow: ellipsis;padding: 6px 12px;"><span style="display: inline-block; vertical-align: middle; min-width: 26px; width: 26px;"><img src="https://ssl.gstatic.com/docs/doclist/images/mediatype/icon_1_spreadsheet_x64.png" width="18" height="18" style="vertical-align: top;" role="presentation"></span><span style="font: 500 14px/18px Google Sans, Roboto, Arial, Helvetica, sans-serif; display: inline; letter-spacing: 0.2px; vertical-align: middle;">Maya Chen | Q3 Roster</span></div></a></td></tr></table><table style="border-collapse: collapse;" role="presentation"><tr style="height: 32px"><td></td></tr></table><div><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQ/edit?usp=sharing_esp&amp;userstoinvite=maya.chen@example.com&amp;sharingaction=manageaccess&amp;role=writer&amp;ts=6abb1991" style="height:36px; width:100px; v-text-anchor:middle;" arcsize="50%" stroke="f" fillcolor="#1a73e8"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-weight:500;font-size:14px;">Manage sharing </center></v:roundrect><![endif]--><a href="https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQ/edit?usp=sharing_esp&amp;userstoinvite=maya.chen@example.com&amp;sharingaction=manageaccess&amp;role=writer&amp;ts=6abb1991" class="material-button material-button-filled" target="_blank" tabindex="0" role="link" style="mso-hide:all;padding: 0 24px;font: 500 14px/36px Google Sans, Roboto, Arial, Helvetica, sans-serif; border: none; border-radius: 18px; box-sizing: border-box; display: inline-block; letter-spacing: .25px; min-height: 36px; text-align: center; text-decoration: none;background-color: #0B57D0; color: #fff; cursor: pointer;">Manage sharing</a></div></td></tr></table><table style="border-collapse: collapse; width: 100%;" role="presentation"><tr><td style="padding: 24px 4.5%"><table style="border-collapse: collapse; width: 100%;" dir="ltr"><tr><td style="padding: 0;font-family: Roboto, Arial, Helvetica, sans-serif; color: #5F6368; width: 100%; font-size: 12px; line-height: 16px; min-height: 40px; letter-spacing: .3px;">Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043, USA<br/> You have received this email because <a href="mailto:maya.chen@example.com" style="color:inherit;text-decoration:none">maya.chen@example.com</a> requested access to a spreadsheet in Google Sheets.</td><td style="padding: 0;padding-left: 20px; min-width: 96px"><a href="https://www.google.com/" target="_blank" style="text-decoration: none"><img src="https://www.gstatic.com/images/branding/googlelogo/2x/googlelogo_grey_tm_color_96x40dp.png" width="96" height="40" alt="Google" style="font-size:16px;font-weight:500;color:#5F6368"></a></td></tr></table></td></tr></table></td></tr></table></td></tr></table></body></html>`;

const REAL_SHARE_REQUEST_URL = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQ/edit?usp=sharing&userstoinvite=maya.chen@example.com&sharingaction=manageaccess&role=writer&ts=6abb1991";

export const driveShareRequestReal = s({
  fromEmail: "drive-shares-dm-noreply@google.com", from: "Maya Chen (via Google Sheets)",
  subject: 'Share request for "Maya Chen | Q3 Roster"',
  body: "maya.chen@example.com requests access to an item:\n\nMaya Chen | Q3 Roster\n" + REAL_SHARE_REQUEST_URL + "\n\nYou are the owner of this document. To give this user access, click the\nlink above and add them as a collaborator or viewer.",
  html: REAL_SHARE_REQUEST_HTML,
});

/** The same mail with no text part at all: the HTML is all there is. */
export const driveShareRequestHtmlOnly = s({
  fromEmail: "drive-shares-dm-noreply@google.com", from: "Maya Chen (via Google Sheets)",
  subject: 'Share request for "Maya Chen | Q3 Roster"',
  body: "",
  html: REAL_SHARE_REQUEST_HTML,
});

const folderRequestHtml = (href: string) =>
  '<div>Share a folder?</div><div>Maya Chen (<a href="mailto:maya.chen@example.com">maya.chen@example.com</a>) is <b>requesting access</b> to the following folder:</div>'
  + '<a href="' + href + '"><div>Q3 Roster</div></a>'
  + '<a href="' + href + '">Manage sharing</a>';

/** A request for a FOLDER: the link is a Drive folder, not a document. */
export const driveFolderRequest = s({
  fromEmail: "drive-shares-dm-noreply@google.com", from: "Maya Chen (via Google Drive)",
  subject: 'Access request for "Q3 Roster"',
  body: "Maya Chen is requesting access to the following folder:\nQ3 Roster\nGoogle LLC, 1600 Amphitheatre Parkway",
  html: folderRequestHtml("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQ?usp=sharing_esl&amp;userstoinvite=maya.chen@example.com&amp;sharingaction=manageaccess&amp;role=writer"),
});

/** A stranger's mail with a real folder link and the same words. Not Google, so not Grant Access. */
export const strangerFolderRequest = s({
  fromEmail: "maya@random-company.example", from: "Maya",
  subject: 'Access request for "Q3 Roster"',
  body: "Maya Chen is requesting access to the following folder:\nQ3 Roster",
  html: folderRequestHtml("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQ?usp=sharing"),
});
