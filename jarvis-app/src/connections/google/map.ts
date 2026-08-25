import { decodeWords, decodeEntities, encodeWord } from "./decode";
// Pure mappers from Google API shapes to JARVIS shapes. Deterministic: we read
// the wall-clock straight out of the ISO string rather than converting through
// a Date, so an event shows at the time Google reports it, in any environment.

export interface GCalEvent {
  id: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}
export interface MappedEvent {
  title: string;
  date: string;   // YYYY-MM-DD
  start: string;  // HH:MM (00:00 for all-day)
  end?: string;
  location?: string;
  gcalId: string;
}

function parseWall(iso: string): { date: string; time: string } {
  const date = iso.slice(0, 10);
  const t = iso.length > 10 ? iso.slice(11, 16) : "00:00";
  return { date, time: /^\d\d:\d\d$/.test(t) ? t : "00:00" };
}

export function mapGoogleEvent(g: GCalEvent): MappedEvent | null {
  const startStr = g.start?.dateTime || g.start?.date;
  if (!g.id || !startStr) return null;
  const sd = parseWall(startStr);
  const m: MappedEvent = { title: g.summary?.trim() || "(no title)", date: sd.date, start: sd.time, gcalId: g.id };
  const endStr = g.end?.dateTime;
  if (endStr) m.end = parseWall(endStr).time;
  if (g.location?.trim()) m.location = g.location.trim();
  return m;
}

export interface GmailHeader { name: string; value: string }
export interface GmailMeta {
  id: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
  labelIds?: string[];
  internalDate?: string;
}
export interface MailRow { id: string; from: string; subject: string; snippet: string }

// DECODED AT THE BOUNDARY (2026-08-25). Every header a person reads passes
// through here, and every one of them arrived encoded when the sender's name
// or subject had a single accent in it. Decoding at the twenty render sites
// instead is how buildReply came to send an encoded subject back out.
function header(meta: GmailMeta, name: string): string {
  const h = (meta.payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return decodeHeader(h?.value || "");
}

// Both decoders, in order. Entities in a HEADER are rarer than in a body and
// they happen: a sender templating HTML into their subject line ships
// "Don&#39;t miss it" and "Sarah &amp; Co", which is what the inbox list read
// after the first pass fixed only the body (2026-08-25). The entity pattern
// needs a closing semicolon, so "AT&T" is untouched.
function decodeHeader(v: string): string {
  return decodeEntities(decodeWords(v));
}
// TRANSPORT QUOTES COME OFF HERE (2026-08-25). A display name containing a
// comma is sent quoted: `"Delaney, Marcus" <m@x.com>`. MessagesFlow had a
// private displayName() that stripped them, and the audit found twelve render
// sites that never called it, so "Archive all 6 from \"Northwind Cloud\"" was
// on screen with the quotes in it.
//
// Stripping at the boundary is the same move as decoding at the boundary: a
// cleanup that has to be remembered is a cleanup that gets forgotten.
function displayFrom(raw: string): string {
  const m = raw.match(/^(.*?)\s*<.*>$/);
  const name = (m && m[1]!.trim()) || raw || "(unknown)";
  return name.replace(/^"+|"+$/g, "").trim() || "(unknown)";
}

export function mapGmailMessage(meta: GmailMeta): MailRow {
  return {
    id: meta.id,
    from: displayFrom(header(meta, "From")),
    subject: header(meta, "Subject") || "(no subject)",
    snippet: meta.snippet || "",
  };
}

// --- Full message read + send (read + send phase) ---

export interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] }
export interface GmailFull extends GmailMeta {
  threadId?: string;
  payload?: { headers?: GmailHeader[]; mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
}
export interface MailAttachment { filename: string; mime: string; attachmentId: string }
export interface MailFull extends MailRow {
  to: string;
  // The sender's own machine-readable "here is how to stop" (RFC 2369/8058).
  listUnsubscribe: string;
  listUnsubscribePost: string;
  fromEmail: string;
  /** How it reads to a person: "7:41 AM", "Yesterday 6:02 PM", "Aug 4". */
  date: string;
  /** The instant, for anything that needs to sort or compare rather than show. */
  dateMs: number;
  body: string;
  threadId: string;
  messageId: string;
  attachments: MailAttachment[];
}

// Raw bytes of a base64url string (attachment downloads need bytes, not text).
export function b64urlDecodeBytes(d: string): Uint8Array {
  try {
    const bin = atob(d.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array(0);
  }
}

function b64urlDecode(d: string): string {
  try {
    const bin = atob(d.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}
export function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// An HTML-only message reaches the screen through here. It used to decode
// &nbsp; and nothing else, so an ordinary marketing mail rendered as
// "Don&#39;t miss Sarah &amp; Co&mdash;RSVP" (2026-08-25).
//
// Tags first, entities second, and in that order on purpose: decoding
// entities first could manufacture a "<" that the tag stripper would then eat
// along with everything after it.
function stripHtml(h: string): string {
  return decodeEntities(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function findPart(part: GmailPart | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return b64urlDecode(part.body.data);
  for (const c of part.parts || []) {
    const t = findPart(c, mime);
    if (t) return t;
  }
  return null;
}
export function extractBody(payload?: GmailFull["payload"]): string {
  if (!payload) return "";
  if (payload.body?.data && !payload.parts) return b64urlDecode(payload.body.data).trim();
  const root: GmailPart = { mimeType: payload.mimeType, body: payload.body, parts: payload.parts };
  const plain = findPart(root, "text/plain");
  if (plain) return plain.trim();
  const html = findPart(root, "text/html");
  return html ? stripHtml(html) : "";
}
// "7:41 AM" for today, "Yesterday", "Mon 7:41 AM" inside a week, "Aug 4"
// beyond it. Anything unparseable comes back as the original string rather
// than as a blank or an invented date.
export function mailDate(raw: string, now = new Date()): string {
  if (!raw) return "";
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return raw;
  const clock = fmtWall(t);
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 86400e3);
  if (days === 0) return clock;
  if (days === 1) return "Yesterday " + clock;
  if (days > 1 && days < 7) return WEEKDAY[t.getDay()] + " " + clock;
  return MONTH[t.getMonth()] + " " + t.getDate();
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// The instant behind the header. Gmail's own internalDate is the fallback,
// because it is always there and always numeric.
export function dateMsOf(raw: string, internalDate?: string): number {
  const t = raw ? new Date(raw).getTime() : NaN;
  if (!Number.isNaN(t)) return t;
  const n = Number(internalDate || 0);
  return Number.isFinite(n) ? n : 0;
}
function fmtWall(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function headerOf(headers: GmailHeader[] | undefined, name: string): string {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return decodeHeader(h?.value || "");
}
function emailOf(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m && m[1]!.trim()) || raw.trim();
}

function collectAttachments(part: GmailPart | undefined, out: MailAttachment[]): void {
  if (!part) return;
  const p = part as GmailPart & { filename?: string; body?: { attachmentId?: string } };
  if (p.filename && p.body?.attachmentId) {
    out.push({ filename: p.filename, mime: p.mimeType || "application/octet-stream", attachmentId: p.body.attachmentId });
  }
  for (const c of part.parts || []) collectAttachments(c, out);
}

export function mapGmailFull(m: GmailFull): MailFull {
  const row = mapGmailMessage(m);
  const hs = m.payload?.headers;
  const attachments: MailAttachment[] = [];
  collectAttachments(m.payload as GmailPart | undefined, attachments);
  return {
    ...row,
    to: headerOf(hs, "To"),
    fromEmail: emailOf(headerOf(hs, "From")),
    // A HUMAN TIME, NOT THE TRANSPORT'S (Dave 2026-08-25, on his screenshot
    // reading "Mon, 24 Aug 2026 17:13:10 +0000 (UTC)"). This was the raw
    // RFC 2822 Date header rendered verbatim while every other time in the
    // app is 12-hour local, and it was in UTC, so a 1:13 PM email read 17:13.
    //
    // The raw header stays available as dateMs for anything that needs to
    // sort or compare; `date` is the one a person looks at.
    date: mailDate(headerOf(hs, "Date")),
    dateMs: dateMsOf(headerOf(hs, "Date"), m.internalDate),
    body: extractBody(m.payload),
    threadId: m.threadId || "",
    messageId: headerOf(hs, "Message-ID"),
    listUnsubscribe: headerOf(hs, "List-Unsubscribe"),
    listUnsubscribePost: headerOf(hs, "List-Unsubscribe-Post"),
    attachments,
  };
}

// Builds the fields for a threaded reply to a message.
export function buildReply(orig: MailFull, body: string): {
  to: string; subject: string; body: string; inReplyTo: string; threadId: string;
} {
  return {
    to: orig.fromEmail,
    // "(no subject)" is a LIST PLACEHOLDER, not a subject. It used to go out
    // to the recipient as "Re: (no subject)" (2026-08-25).
    subject: replySubject(orig.subject),
    body,
    inReplyTo: orig.messageId,
    threadId: orig.threadId,
  };
}

const PLACEHOLDER = /^\((no subject|unknown|empty)\)$/i;

export function replySubject(subject: string): string {
  const s = (subject || "").trim();
  if (!s || PLACEHOLDER.test(s)) return "Re:";
  return /^re:/i.test(s) ? s : "Re: " + s;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Encodes an email as the base64url RFC822 string Gmail's send wants.
// Plain text by default. With pixelUrl (email 3 open tracking) it becomes
// multipart/alternative: the same text, plus an HTML part that is nothing but
// the escaped text and one 1x1 tracking image. The words the recipient reads
// are identical either way.
export function encodeEmail(msg: { to: string; subject: string; body: string; inReplyTo?: string; pixelUrl?: string }): string {
  // Subjects are decoded on the way IN now, so a reply to "Nächste Schritte"
  // carries real UTF-8 that cannot legally sit raw in a header. encodeWord
  // returns an ASCII subject untouched, which is nearly all of them.
  const headers = ["To: " + encodeWord(msg.to), "Subject: " + encodeWord(msg.subject)];
  if (msg.inReplyTo) headers.push("In-Reply-To: " + msg.inReplyTo, "References: " + msg.inReplyTo);
  if (!msg.pixelUrl) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    return b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + msg.body);
  }
  const boundary = "=_jarvis_" + Math.abs(msg.body.length * 31 + msg.to.length).toString(36) + "_b";
  headers.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');
  const html =
    "<div>" + escapeHtml(msg.body).replace(/\r?\n/g, "<br>") + "</div>" +
    '<img src="' + msg.pixelUrl + '" width="1" height="1" alt="">';
  const parts = [
    "--" + boundary,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    msg.body,
    "--" + boundary,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    "--" + boundary + "--",
  ].join("\r\n");
  return b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + parts);
}

// --- Threads (Email rebuild) ---
// A thread's list row speaks with the LATEST message's voice (that is what is
// new) but keeps the FIRST message's subject (that is what the conversation
// is about, before the Re: Re: Re: pileup).
export interface GmailThreadMeta { id: string; messages?: GmailMeta[] }
export interface GmailThreadFull { id: string; messages?: GmailFull[] }

export interface ThreadRow {
  id: string;
  from: string;       // display name of latest sender
  fromEmail: string;
  subject: string;
  snippet: string;    // latest message snippet
  unread: boolean;    // any message unread
  inInbox: boolean;   // any message still labeled INBOX
  dateMs: number;     // latest message time
  count: number;      // messages in thread
  lastMsgId: string;  // triage cache key: a new message re-triages the thread
  account?: string;   // which Google account this thread lives in (multi-account)
}

export function mapThread(t: GmailThreadMeta): ThreadRow | null {
  const msgs = t.messages || [];
  const first = msgs[0];
  const last = msgs[msgs.length - 1];
  if (!t.id || !first || !last) return null;
  return {
    id: t.id,
    from: displayFrom(header(last, "From")),
    fromEmail: emailOf(header(last, "From")),
    subject: (header(first, "Subject") || header(last, "Subject") || "(no subject)").replace(/^(re|fwd?):\s*/i, ""),
    snippet: last.snippet || "",
    unread: msgs.some((m) => (m.labelIds || []).includes("UNREAD")),
    inInbox: msgs.some((m) => (m.labelIds || []).includes("INBOX")),
    dateMs: Number(last.internalDate) || 0,
    count: msgs.length,
    lastMsgId: last.id,
  };
}

export interface ThreadFull { id: string; subject: string; messages: MailFull[] }

export function mapThreadFull(t: GmailThreadFull): ThreadFull {
  const messages = (t.messages || []).map(mapGmailFull);
  const subject = (messages[0]?.subject || "(no subject)").replace(/^(re|fwd?):\s*/i, "");
  return { id: t.id, subject, messages };
}

// --- Inbox (Messages tab) ---
export interface InboxRow {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  unread: boolean;
  dateMs: number;
}
export function mapInboxMessage(meta: GmailMeta): InboxRow {
  const base = mapGmailMessage(meta);
  return {
    ...base,
    unread: (meta.labelIds || []).includes("UNREAD"),
    dateMs: Number(meta.internalDate) || 0,
  };
}
