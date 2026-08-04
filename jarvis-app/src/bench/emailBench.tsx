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
  { id: "t_tucci", messages: [
    msg("m1", "Coach Tucci <tucci@bffsa.org>", "Marcus - waiver for Saturday", "Attached the waiver, need it back before the 9th", ["INBOX"], NOW - 60 * H),
    msg("m2", "Dave <dave@x.com>", "Re: Marcus - waiver for Saturday", "On it, sending tomorrow", [], NOW - 40 * H),
    msg("m3", "Coach Tucci <tucci@bffsa.org>", "Re: Marcus - waiver for Saturday", "Hey Dave, haven't seen it yet - Friday's the cutoff", ["INBOX", "UNREAD"], NOW - 2 * H),
  ] },
  { id: "t_geico", messages: [
    msg("m4", "GEICO <no-reply@geico.com>", "Your policy renews soon", "Your auto policy renews Aug 12. Amount due: $214.00", ["INBOX", "UNREAD"], NOW - 20 * H),
  ] },
  { id: "t_patel", messages: [
    msg("m5", "Dr. Patel's Office <front@patelmed.com>", "Appointment reminder", "Please confirm your appointment Aug 8 at 2:30 PM", ["INBOX", "UNREAD"], NOW - 26 * H),
  ] },
  { id: "t_bffsa", messages: [
    msg("m6", "BFFSA <news@bffsa.org>", "Fall registration opens Monday", "Registration for the fall season opens Monday. Nothing due yet.", ["INBOX"], NOW - 30 * H),
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
  t_tucci: full("t_tucci", [
    { from: "Coach Tucci <tucci@bffsa.org>", subject: "Marcus - waiver for Saturday", date: "Mon", body: "Dave - attached the medical waiver. Need it signed and back before the 9th or Marcus can't dress Saturday." },
    { from: "Dave <dave@x.com>", subject: "Re: Marcus - waiver for Saturday", date: "Tue", body: "On it, sending tomorrow." },
    { from: "Coach Tucci <tucci@bffsa.org>", subject: "Re: Marcus - waiver for Saturday", date: "7:41 AM", body: "Hey Dave, haven't seen it yet - Friday's the cutoff." },
  ]),
  t_geico: full("t_geico", [{ from: "GEICO <no-reply@geico.com>", subject: "Your policy renews soon", date: "Yesterday", body: "Your auto policy renews Aug 12. Amount due: $214.00. No action is needed if autopay is enabled." }]),
  t_patel: full("t_patel", [{ from: "Dr. Patel's Office <front@patelmed.com>", subject: "Appointment reminder", date: "Yesterday", body: "Please confirm your appointment on Aug 8 at 2:30 PM. Reply CONFIRM or call us." }]),
};

// The waiver form rides the first Tucci message as a real attachment part.
{
  const first = FULLS.t_tucci?.messages?.[0] as { payload?: { parts?: unknown[] } } | undefined;
  if (first?.payload) {
    first.payload.parts = [
      { filename: "waiver.pdf", mimeType: "application/pdf", body: { attachmentId: "att1" } },
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
  getAttachment: async () => ({ data: btoa("PDFBYTES").replace(/\+/g, "-").replace(/\//g, "_"), size: 8 }),
});

// Scripted AI: answers by recognizing which prompt MessagesFlow sent.
const TRIAGE_REPLY = JSON.stringify([
  { id: "t_tucci", bucket: "needs_you", gist: "Tucci needs the signed waiver by Friday or Marcus sits Saturday." },
  { id: "t_geico", bucket: "needs_you", gist: "Auto policy renews Aug 12, $214." },
  { id: "t_patel", bucket: "needs_you", gist: "Confirm the Aug 8, 2:30 PM appointment." },
  { id: "t_bffsa", bucket: "worth_knowing", gist: "Fall registration opens Monday. Nothing due yet." },
  { id: "t_vercel", bucket: "worth_knowing", gist: "Deploy succeeded. FYI only." },
  { id: "t_dd", bucket: "noise", gist: "DoorDash promo." },
  { id: "t_li", bucket: "noise", gist: "LinkedIn notifications." },
  { id: "t_sub", bucket: "noise", gist: "Newsletter." },
]);

const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
  const body = String(init?.body || "");
  let text = "OK";
  if (body.includes("triage an inbox")) text = TRIAGE_REPLY;
  else if (body.includes("prepare ONE decision")) {
    // Deck plans, one per needs-you thread, keyed by content.
    if (body.includes("waiver")) {
      text = JSON.stringify({ kind: "reply", why: "Tucci needs the signed waiver by Friday or Marcus sits.", reply: "My bad Tucci, got buried. Signing it tonight, you'll have it by morning. Marcus plays Saturday." });
    } else if (body.includes("policy renews")) {
      text = JSON.stringify({ kind: "bill", why: "Auto policy renews Aug 12, $214.", bill: { name: "Geico", amount: 214, due: "2026-08-12" } });
    } else if (body.includes("Patel")) {
      text = JSON.stringify({ kind: "event", why: "Confirm the Aug 8, 2:30 PM appointment.", event: { title: "Dr. Patel", date: "2026-08-08", start: "14:30" } });
    } else {
      text = JSON.stringify({ kind: "archive", why: "Nothing needed." });
    }
  }
  else if (body.includes("follow-up nudge")) text = "Hey Sarah, floating this back to the top of your inbox. No rush, just don't want it to slip.";
  else if (body.includes("Summarize this email conversation")) text = "Tucci needs the signed waiver by Friday; he has followed up twice and the blank form is on the first message.";
  else if (body.includes("3 short reply options")) text = JSON.stringify(["Sending it tonight", "Done by morning", "Call you at noon"]);
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
