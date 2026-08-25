import { createRoot } from "react-dom/client";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { AIService } from "../ai/AIService";
import type { GmailMeta, GmailThreadMeta, GmailThreadFull } from "../connections/google/map";
import MessagesFlow from "../messages/MessagesFlow";
import "../styles/jarvis-design-system.css";
import "../styles/uniformity.css";
import "../styles/components.css";

// Email bench (dev only): MessagesFlow against a fake Gmail and a scripted AI,
// so the whole triage flow can be walked end to end without a Google account.
// This is exactly the fake the component tests use, at full app scale.

const msg = (id: string, from: string, subject: string, snippet: string, labels: string[], dateMs: number): GmailMeta => ({
  id, snippet, labelIds: labels, internalDate: String(dateMs),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
});

const NOW = Date.now();
const H = 3600e3;

const THREADS: GmailThreadMeta[] = [
  { id: "t_orgB", messages: [
    msg("m1", "Coach Ridgeley <coach@northlake.org>", "Marcus - waiver for Saturday", "Attached the waiver, need it back before the 9th", ["INBOX"], NOW - 60 * H),
    msg("m2", "Dave <dave@x.com>", "Re: Marcus - waiver for Saturday", "On it, sending tomorrow", [], NOW - 40 * H),
    msg("m3", "Coach Ridgeley <coach@northlake.org>", "Re: Marcus - waiver for Saturday", "Hey Dave, haven't seen it yet - Friday's the cutoff", ["INBOX", "UNREAD"], NOW - 2 * H),
  ] },
  { id: "t_geico", messages: [
    msg("m4", "GEICO <no-reply@geico.com>", "Your policy renews soon", "Your auto policy renews Aug 12. Amount due: $214.00", ["INBOX", "UNREAD"], NOW - 20 * H),
  ] },
  { id: "t_patel", messages: [
    msg("m5", "Dr. Patel's Office <front@patelmed.com>", "Appointment reminder", "Please confirm your appointment Aug 8 at 2:30 PM", ["INBOX", "UNREAD"], NOW - 26 * H),
  ] },
  // The audit fixtures (2026-08-25). Each of these is a bug Dave found on his
  // own screen that the old bench could not reproduce, so the walk could not
  // see it and neither could I.
  //
  //   t_ics      a real calendar invite, so "Add It to Your Calendar" can be
  //              proved to actually add it
  //   t_encoded  an RFC 2047 encoded-word subject and sender
  //   t_entity   an HTML-only body full of undecoded entities
  //   t_nosub    a message with no subject at all
  { id: "t_ics", messages: [
    msg("m_ics", "Resolve Clinic <no-reply@resolveclinic.com>", "Video appointment reminder", "You have a video appointment. Do not reply to this message.", ["INBOX", "UNREAD"], NOW - 3 * H),
  ] },
  { id: "t_encoded", messages: [
    msg("m_enc", "=?UTF-8?B?Tm/Dq2wgQmVyZ2Vy?= <noel@bruxelles.be>", "=?UTF-8?B?TsOkY2hzdGUgU2Nocml0dGU=?=", "Bonjour Dave", ["INBOX", "UNREAD"], NOW - 4 * H),
  ] },
  { id: "t_entity", messages: [
    msg("m_ent", "Sarah &amp; Co <events@sarahco.com>", "Don&#39;t miss it", "RSVP by Friday", ["INBOX"], NOW - 6 * H),
  ] },
  { id: "t_nosub", messages: [
    msg("m_nosub", "Marcus Delaney <m@northlake.org>", "", "", ["INBOX"], NOW - 7 * H),
  ] },
  // Dave's own inbox, 2026-08-25: a marketing blast with the full plumbing
  // in its plain-text part. This fixture is why the "( )" columns and the
  // reply chips on bulk mail are now testable.
  { id: "t_bulk", messages: [
    msg("m_bulk", "RushOrderTees <sales@rushordertees.com>", "Put Your Logo on the Brands Everyone Knows", "Custom gear from Nike, Under Armour, Stanley, and more", ["INBOX", "UNREAD"], NOW - 8 * H),
  ] },
  { id: "t_orgA", messages: [
    msg("m6", "Northlake <news@northlake.org>", "Fall registration opens Monday", "Registration for the fall season opens Monday. Nothing due yet.", ["INBOX"], NOW - 30 * H),
  ] },
  { id: "t_vercel", messages: [
    msg("m7", "Vercel <notifications@vercel.com>", "Deployment succeeded", "jarvis-rebuild deployed to production", ["INBOX"], NOW - 5 * H),
  ] },
  { id: "t_dd", messages: [
    msg("m8", "DoorDash <promo@doordash.com>", "20% off your next order", "Hungry? Take 20% off today only", ["INBOX"], NOW - 8 * H),
  ] },
  { id: "t_li", messages: [
    msg("m9", "LinkedIn <messages-noreply@linkedin.com>", "You have 3 new notifications", "See who viewed your profile", ["INBOX"], NOW - 9 * H),
  ] },
  { id: "t_sub", messages: [
    msg("m10", "Lenny's Newsletter <lenny@substack.com>", "How to price your product", "This week: pricing strategies", ["INBOX"], NOW - 50 * H),
  ] },
];

const full = (id: string, parts: { from: string; subject: string; date: string; body: string }[]): GmailThreadFull => ({
  id,
  messages: parts.map((p, i) => ({
    id: id + "_f" + i, threadId: id, snippet: "",
    payload: {
      mimeType: "text/plain", body: { data: btoa(p.body) },
      headers: [
        { name: "From", value: p.from }, { name: "Subject", value: p.subject },
        { name: "Date", value: p.date }, { name: "Message-ID", value: "<" + id + i + "@x>" },
      ],
    },
  })),
});

const FULLS: Record<string, GmailThreadFull> = {
  t_orgB: full("t_orgB", [
    { from: "Coach Ridgeley <coach@northlake.org>", subject: "Marcus - waiver for Saturday", date: "Mon", body: "Dave - attached the medical waiver. Need it signed and back before the 9th or Marcus can't dress Saturday." },
    { from: "Dave <dave@x.com>", subject: "Re: Marcus - waiver for Saturday", date: "Tue", body: "On it, sending tomorrow." },
    { from: "Coach Ridgeley <coach@northlake.org>", subject: "Re: Marcus - waiver for Saturday", date: "7:41 AM", body: "Hey Dave, haven't seen it yet - Friday's the cutoff." },
  ]),
  t_geico: full("t_geico", [{ from: "GEICO <no-reply@geico.com>", subject: "Your policy renews soon", date: "Yesterday", body: "Your auto policy renews Aug 12. Amount due: $214.00. No action is needed if autopay is enabled." }]),
  t_patel: full("t_patel", [{ from: "Dr. Patel's Office <front@patelmed.com>", subject: "Appointment reminder", date: "Yesterday", body: "Please confirm your appointment on Aug 8 at 2:30 PM. Reply CONFIRM or call us." }]),
  t_ics: full("t_ics", [{ from: "Resolve Clinic <no-reply@resolveclinic.com>", subject: "Video appointment reminder", date: "Mon, 24 Aug 2026 17:13:10 +0000 (UTC)", body: "IMPORTANT: This is an automated message. Please do not reply. Hi Dave, this is a reminder that you have an appointment at 1:00 pm (ET) on Wednesday, September 23rd." }]),
  t_encoded: full("t_encoded", [{ from: "=?UTF-8?B?Tm/Dq2wgQmVyZ2Vy?= <noel@bruxelles.be>", subject: "=?UTF-8?B?TsOkY2hzdGUgU2Nocml0dGU=?=", date: "Yesterday", body: "Bonjour Dave, voici la suite." }]),
  t_entity: full("t_entity", [{ from: "Sarah &amp; Co <events@sarahco.com>", subject: "Don&#39;t miss it", date: "Yesterday", body: "Don&#39;t miss Sarah &amp; Co&mdash;RSVP by Friday" }]),
  t_nosub: full("t_nosub", [{ from: "Marcus Delaney <m@northlake.org>", subject: "", date: "Yesterday", body: "" }]),
  t_bulk: full("t_bulk", [{
    from: "RushOrderTees <sales@rushordertees.com>",
    subject: "Put Your Logo on the Brands Everyone Knows",
    date: "Tue, 25 Aug 2026 14:21:07 +0000",
    body: [
      "Custom gear from Nike, Under Armour, Stanley, and more, all printed with your design.",
      "RushOrderTees Logo ( https://rushordertees.com/?t=a1 )",
      "Products ( https://rushordertees.com/products?t=a2 )",
      "My Saved Designs ( https://rushordertees.com/saved?t=a3 )",
      "Premium gear for \"Vector Sports\"",
      "front ( https://rushordertees.com/f?t=a4 )",
      "back ( https://rushordertees.com/b?t=a5 )",
      "Premium brands carry built-in trust. When your logo lands on gear from Nike, Under Armour, or Carhartt, it signals that your brand values quality before anyone reads a word.",
      "Premium Brands ( https://rushordertees.com/pb?t=a6 )",
      "Shop Products ( https://rushordertees.com/sp?t=a7 )",
      "Free Shipping on All Orders!",
      "Call (267) 332-4101 ( tel:2673324101 )",
      "Email sales@rushordertees.com ( mailto:sales@rushordertees.com )",
      "RushOrderTees, A Printfly Company",
      "2727 Commerce Way, Philadelphia, PA 19154",
      "Copyright \u00A9 2026 RushOrderTees, All rights reserved.",
      "This message was sent to davefisher813@gmail.com",
      "No longer interested? Unsubscribe ( https://rushordertees.com/unsub?t=a8 )",
    ].join("\n"),
  }]),
};

// The List-Unsubscribe header is what makes this bulk, and it is the header
// the app was already reading to draw an Unsubscribe button while offering
// quick replies beside it.
{
  const b = FULLS.t_bulk?.messages?.[0] as { payload?: { headers?: { name: string; value: string }[] } } | undefined;
  b?.payload?.headers?.push({ name: "List-Unsubscribe", value: "<https://rushordertees.com/unsub?t=a8>" });
}

// A real calendar invite, so the calendar card can be walked end to end. The
// old bench had a PDF and nothing else, which is why "Add It to Your Calendar"
// could ship for months doing nothing.
const INVITE_ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
  "SUMMARY:Video appointment with Resolve Clinic",
  "DTSTART:20260923T170000Z", "DTEND:20260923T173000Z",
  "END:VEVENT", "END:VCALENDAR",
].join("\r\n");

// The waiver form rides the first Ridgeley message as a real attachment part.
{
  const first = FULLS.t_orgB?.messages?.[0] as { payload?: { parts?: unknown[] } } | undefined;
  if (first?.payload) {
    first.payload.parts = [
      { filename: "waiver.pdf", mimeType: "application/pdf", body: { attachmentId: "att1" } },
    ];
  }
  const inv = FULLS.t_ics?.messages?.[0] as { payload?: { parts?: unknown[] } } | undefined;
  if (inv?.payload) {
    inv.payload.parts = [
      { filename: "appointment.ics", mimeType: "text/calendar", body: { attachmentId: "att_ics" } },
    ];
  }
}

// Sent mail for Waiting On: Sarah owes a reply (4 days), Bo already replied.
const SENT_THREADS: GmailThreadMeta[] = [
  { id: "t_sent_sarah", messages: [
    { id: "ms1", snippet: "Attached the operating agreement draft", internalDate: String(NOW - 96 * H),
      payload: { headers: [
        { name: "From", value: "Dave <dave@x.com>" },
        { name: "To", value: "Sarah <sarah@y.com>" },
        { name: "Subject", value: "LLC operating agreement" },
      ] } },
  ] },
  { id: "t_sent_bo", messages: [
    { id: "ms2", snippet: "You in for Saturday?", internalDate: String(NOW - 120 * H),
      payload: { headers: [
        { name: "From", value: "Dave <dave@x.com>" }, { name: "To", value: "Bo <bo@y.com>" },
        { name: "Subject", value: "Saturday" } ] } },
    { id: "ms3", snippet: "Yessir", internalDate: String(NOW - 100 * H),
      payload: { headers: [
        { name: "From", value: "Bo <bo@y.com>" }, { name: "To", value: "Dave <dave@x.com>" },
        { name: "Subject", value: "Re: Saturday" } ] } },
  ] },
];

// A thread without a hand-written full view synthesizes one from its meta, so
// EVERY thread opens (the walk caught a dead-end tap on a fixture gap).
function synthFull(id: string): GmailThreadFull {
  const meta = [...THREADS, ...SENT_THREADS].find((t) => t.id === id);
  return full(id, (meta?.messages || []).map((m) => ({
    from: (m.payload?.headers || []).find((h) => h.name === "From")?.value || "Someone <s@x.com>",
    subject: (m.payload?.headers || []).find((h) => h.name === "Subject")?.value || "(no subject)",
    date: "Yesterday",
    body: m.snippet || "(empty)",
  })));
}

const api = makeFakeGoogleApi({
  listThreads: async () => THREADS,
  getThread: async (id) => FULLS[id] ?? synthFull(id),
  searchThreads: async (q) => {
    if (q.includes("in:sent to:")) return []; // no voice examples on the bench
    if (q.includes("in:sent")) return SENT_THREADS;
    return THREADS.filter((t) => JSON.stringify(t).toLowerCase().includes(q.toLowerCase()));
  },
  getProfile: async () => ({ emailAddress: "dave@x.com" }),
  getAttachment: async (_msgId: string, attId: string) => {
    const body = attId === "att_ics" ? INVITE_ICS : "PDFBYTES";
    return { data: btoa(body).replace(/\+/g, "-").replace(/\//g, "_"), size: body.length };
  },
});

// Scripted AI: answers by recognizing which prompt MessagesFlow sent.
const TRIAGE_REPLY = JSON.stringify([
  { id: "t_orgB", bucket: "needs_you", gist: "Ridgeley needs the signed waiver by Friday or Marcus sits Saturday.", by: "Friday" },
  { id: "t_geico", bucket: "needs_you", gist: "Auto policy renews Aug 12, $214.", by: "Aug 12" },
  { id: "t_patel", bucket: "needs_you", gist: "Confirm the Aug 8, 2:30 PM appointment.", by: "today" },
  { id: "t_orgA", bucket: "worth_knowing", gist: "Fall registration opens Monday. Nothing due yet." },
  { id: "t_vercel", bucket: "worth_knowing", gist: "Deploy succeeded. FYI only." },
  { id: "t_dd", bucket: "noise", gist: "DoorDash promo." },
  { id: "t_li", bucket: "noise", gist: "LinkedIn notifications." },
  { id: "t_sub", bucket: "noise", gist: "Newsletter." },
  { id: "t_ics", bucket: "needs_you", gist: "Video appt Sept 23, 1 PM",
    act: { kind: "appointment", title: "Video appointment", date: "2026-09-23", start: "13:00", durationMin: 30 } },
  { id: "t_encoded", bucket: "needs_you", gist: "Next steps, needs an answer" },
  { id: "t_entity", bucket: "worth_knowing", gist: "RSVP by Friday" },
  { id: "t_nosub", bucket: "worth_knowing", gist: "Empty message" },
  { id: "t_bulk", bucket: "noise", gist: "Custom branded gear promo" },
]);

const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
  const body = String(init?.body || "");
  let text = "OK";
  if (body.includes("triage an inbox")) text = TRIAGE_REPLY;
  else if (body.includes("prepare ONE decision")) {
    // Deck plans, one per needs-you thread, keyed by content.
    if (body.includes("waiver")) {
      text = JSON.stringify({ kind: "reply", why: "Ridgeley needs the signed waiver by Friday or Marcus sits.", reply: "My bad Ridgeley, got buried. Signing it tonight, you'll have it by morning. Marcus plays Saturday." });
    } else if (body.includes("policy renews")) {
      text = JSON.stringify({ kind: "bill", why: "Auto policy renews Aug 12, $214.", bill: { name: "Geico", amount: 214, due: "2026-08-12" } });
    } else if (body.includes("Patel")) {
      text = JSON.stringify({ kind: "event", why: "Confirm the Aug 8, 2:30 PM appointment.", event: { title: "Dr. Patel", date: "2026-08-08", start: "14:30" } });
    } else {
      text = JSON.stringify({ kind: "archive", why: "Nothing needed." });
    }
  }
  else if (body.includes("follow-up nudge")) text = "Hey Sarah, floating this back to the top of your inbox. No rush, just don't want it to slip.";
  // The thread brief is ONE call returning both halves (see messages/brief.ts).
  // The old shim answered two separate prompts and silently stopped matching
  // when they merged, which left the bench with no summary at all.
  // Match on PROSE, never on a JSON fragment: the prompt is embedded in a
  // JSON request body, so every quote in it arrives escaped and a literal
  // {"summary" never appears.
  else if (body.includes("Read this email conversation")) {
    text = JSON.stringify({
      summary: "Ridgeley needs the signed waiver by Friday. He has followed up twice and the blank form is on the first message.",
      replies: ["Sending it tonight", "Done by morning", "Call you at noon"],
    });
  }
  else if (body.includes("forwarding note")) text = "Jen, can you take this one? Ridgeley needs the waiver signed before Friday. Thanks.";
  else if (body.includes("commitment they made")) text = JSON.stringify({ text: "Send Ridgeley the waiver", due: "" });
  return { ok: true, status: 200, json: async () => ({ text }), text: async () => "" };
}) as unknown as typeof fetch;

const ai = new AIService({ available: true, fetchImpl, getToken: () => "bench" });

createRoot(document.getElementById("root")!).render(
  <NotesProvider userId="bench">
    <GoogleSessionProvider requestToken={async () => "bench-token"} makeApi={() => api}>
      <MessagesFlow ai={ai} configured token="bench-token" />
    </GoogleSessionProvider>
  </NotesProvider>,
);
