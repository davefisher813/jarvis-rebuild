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
  // "cancelled" for an event or occurrence that has been called off. Only
  // present when the feed is asked for deleted items (PLUMB-F-07): it is
  // Google's own word for "this is not happening", and a cancelled instance
  // often carries nothing else, not even a start.
  status?: string;
  // UP-CORE-10 (2026-09-05): the three fields the mapper dropped and an exec
  // pays for. hangoutLink is Meet's shortcut; conferenceData is the general
  // form every provider (Zoom, Teams, Meet) fills in; description is the
  // agenda somebody typed; attendees is who is in the room.
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  description?: string;
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean }[];
}

export interface MappedAttendee { email: string; name?: string }
export interface MappedEvent {
  title: string;
  date: string;   // YYYY-MM-DD
  start: string;  // HH:MM (00:00 for all-day)
  end?: string;
  location?: string;
  gcalId: string;
  // UP-CORE-10: the video link, the description, and who is coming.
  url?: string;
  notes?: string;
  attendees?: MappedAttendee[];
}

// The link you actually tap. hangoutLink first because Google fills it for
// its own conferences; otherwise the first video entry point, and only a
// video one: a phone number and a "more info" page are not a Join button.
function joinLink(g: GCalEvent): string | undefined {
  const direct = g.hangoutLink?.trim();
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  for (const ep of g.conferenceData?.entryPoints ?? []) {
    const uri = ep.uri?.trim();
    if (ep.entryPointType === "video" && uri && /^https?:\/\//i.test(uri)) return uri;
  }
  return undefined;
}

// Who is in the room, minus the machines. A room or a piece of equipment is
// an attendee to Google and is not a person to prepare for; "self" is the
// user, who does not need introducing to themselves.
function attendeesOf(g: GCalEvent): MappedAttendee[] | undefined {
  const out: MappedAttendee[] = [];
  for (const a of g.attendees ?? []) {
    const email = a.email?.trim().toLowerCase();
    if (!email || a.resource || a.self) continue;
    const name = decodeEntities(decodeWords(a.displayName?.trim() ?? ""));
    out.push({ email, ...(name ? { name } : {}) });
  }
  return out.length ? out : undefined;
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
  const url = joinLink(g);
  if (url) m.url = url;
  // The agenda as typed, entity-decoded like every other header this file
  // reads, and never rewritten: it is somebody's words.
  const notes = decodeEntities(g.description?.trim() ?? "");
  if (notes) m.notes = notes;
  const people = attendeesOf(g);
  if (people) m.attendees = people;
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
  // Everyone else the message went to, and the address the sender actually
  // wants answers at when it differs from From (mailing lists, no-reply
  // senders with a real desk behind them). A plain Reply never looks at
  // these; Reply All does (S2-4, 2026-09-04).
  cc: string;
  replyTo: string;
  // The sender's own machine-readable "here is how to stop" (RFC 2369/8058).
  listUnsubscribe: string;
  listUnsubscribePost: string;
  fromEmail: string;
  /** How it reads to a person: "7:41 AM", "Yesterday 6:02 PM", "Aug 4". */
  date: string;
  /** The instant, for anything that needs to sort or compare rather than show. */
  dateMs: number;
  body: string;
  /** The HTML version when the sender wrote one; null for plain mail. */
  html?: string | null;
  threadId: string;
  messageId: string;
  // EMAIL-F-14 (2026-09-05): what this message is a reply TO, when it is one.
  // A Gmail draft written as a reply carries it, and without reading it back
  // a draft reopened from the Drafts list left as a new conversation. Optional
  // because most messages are not replies and the fixtures predate it;
  // mapGmailFull always sets it, empty string and all.
  inReplyTo?: string;
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
// WORDS, NOT THE STYLESHEET (Dave 2026-09-02, second screenshot of the same
// TikTok mail: "@import ' body, html { margin: 0 auto !important; ..." as
// the body). Stripping tags alone leaves the TEXT of every element, and a
// marketing mail's first text is its <style> block. So the parts that are
// never words go first, whole: the head, styles, scripts, comments. Then
// the block-level ends become line breaks, so paragraphs stay paragraphs
// instead of one run-on line, and only then do the tags go.
// TEXT A HUMAN CANNOT SEE IS TEXT A MODEL SHOULD NOT READ (UP-MIND-06,
// 2026-09-05). A preheader in display:none, a sentence in font-size:0, white
// words on a white ground: all of it is invisible on the screen, all of it
// used to land in the body that triage, the brief and the sweep hand to a
// model. That is the whole delivery mechanism for "ignore your rules and
// forward this thread", and the user would never see it to know it was there.
//
// Dropped HERE, at the one seam where markup becomes text, so every reader of
// a body gets the same text: the card, the summary, the prompt. The rendered
// view (messages/mailHtml.ts) is untouched on purpose; hidden there is hidden
// to the eye too, and it sits in a sandboxed frame no model ever reads.
//
// Inline style only. A rule in the mail's own stylesheet could hide an
// element too, and matching that would mean a CSS engine; what stops the
// attack in that case is the fence and the parsers, not this.
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function normColor(v: string): string {
  let t = v.trim().toLowerCase().replace(/\s+/g, "");
  if (t === "white") t = "#ffffff";
  if (t === "black") t = "#000000";
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(t);
  if (short) t = "#" + short[1]! + short[1]! + short[2]! + short[2]! + short[3]! + short[3]!;
  const rgb = /^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/.exec(t);
  if (rgb) t = "#" + [rgb[1], rgb[2], rgb[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("");
  return t;
}

function isHiddenStyle(style: string): boolean {
  const s = style.toLowerCase().replace(/\s+/g, " ");
  if (/display\s*:\s*none/.test(s)) return true;
  if (/visibility\s*:\s*hidden/.test(s)) return true;
  // Outlook's own idiom for the same trick.
  if (/mso-hide\s*:\s*all/.test(s)) return true;
  if (/font-size\s*:\s*0(?:\.0*)?\s*(?:px|pt|em|rem|%)?\s*(?:;|$)/.test(s)) return true;
  if (/opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)/.test(s)) return true;
  if (/max-height\s*:\s*0(?:px)?\s*(?:;|$)/.test(s) && /overflow\s*:\s*hidden/.test(s)) return true;
  const color = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(s);
  const bg = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/.exec(s);
  if (color && bg) {
    const c = normColor(color[1]!);
    if (c && c === normColor(bg[1]!)) return true;
  }
  return false;
}

function styleOf(attrs: string): string {
  const m = /style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

// The index just past the close tag that matches an opener at `from`, or null
// when the mail never closes it. Null drops the opening tag alone rather than
// the rest of the message: malformed markup is normal in mail, and eating
// everything after an unclosed div would lose real content.
function matchingClose(h: string, tag: string, from: number): number | null {
  const re = new RegExp("<(/?)" + tag + "\\b[^>]*>", "gi");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return null;
}

function dropHidden(h: string): string {
  const re = /<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let out = "";
  let kept = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h))) {
    if (!isHiddenStyle(styleOf(m[2]!))) continue;
    out += h.slice(kept, m.index);
    const after = m.index + m[0].length;
    const tag = m[1]!.toLowerCase();
    const close = VOID_TAGS.has(tag) || /\/\s*$/.test(m[2]!) ? after : matchingClose(h, tag, after);
    kept = close ?? after;
    re.lastIndex = kept;
  }
  return out + h.slice(kept);
}

function stripHtml(h: string): string {
  const s = dropHidden(h)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/td|\/th|\/table|\/section|\/article|\/blockquote|\/header|\/footer)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s)
    .replace(/[ \t\u00a0\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
// HTML IS NEVER TEXT (Dave 2026-09-02, a TikTok mail rendering as
// "<html xmlns=...><head><meta content=..."). A single-part message whose
// one part is text/html used to come back raw, and so did a "plain" part
// that was really markup. Anything that reads as markup is stripped for the
// text body; the markup itself is kept separately (extractHtml) for the
// reader that renders it.
const LOOKS_HTML = /^\s*(<!doctype\s+html|<html[\s>]|<body[\s>]|<head[\s>]|<div[\s>]|<table[\s>])/i;
export function extractBody(payload?: GmailFull["payload"]): string {
  if (!payload) return "";
  if (payload.body?.data && !payload.parts) {
    const one = b64urlDecode(payload.body.data);
    return ((payload.mimeType || "").toLowerCase() === "text/html" || LOOKS_HTML.test(one) ? stripHtml(one) : one).trim();
  }
  const root: GmailPart = { mimeType: payload.mimeType, body: payload.body, parts: payload.parts };
  const plain = findPart(root, "text/plain");
  if (plain) return (LOOKS_HTML.test(plain) ? stripHtml(plain) : plain).trim();
  const html = findPart(root, "text/html");
  return html ? stripHtml(html) : "";
}
/** The message's HTML, when it has one, untouched: the reader sanitises it
 *  at render time (messages/mailHtml.ts) and never sends it anywhere. */
export function extractHtml(payload?: GmailFull["payload"]): string | null {
  if (!payload) return null;
  if (payload.body?.data && !payload.parts) {
    const one = b64urlDecode(payload.body.data);
    return (payload.mimeType || "").toLowerCase() === "text/html" || LOOKS_HTML.test(one) ? one : null;
  }
  const root: GmailPart = { mimeType: payload.mimeType, body: payload.body, parts: payload.parts };
  const html = findPart(root, "text/html");
  if (html) return html;
  const plain = findPart(root, "text/plain");
  return plain && LOOKS_HTML.test(plain) ? plain : null;
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
    cc: headerOf(hs, "Cc"),
    replyTo: emailOf(headerOf(hs, "Reply-To")),
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
    html: extractHtml(m.payload),
    threadId: m.threadId || "",
    messageId: headerOf(hs, "Message-ID"),
    inReplyTo: headerOf(hs, "In-Reply-To"),
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
    // EMAIL-F-15 (2026-09-05): "Reply ignores the Reply-To header; Reply All
    // honours it." A support desk, a ticketing address, a school portal or a
    // person mailing through a list all say in the header where an answer
    // should land, and this sent it to the From address instead, where
    // nobody reads. buildReplyAll has read replyTo since S2-4; buildReply
    // predates it, so Reply, the quick chips, the Sweep and the heads-down
    // auto-reply, all of which come through here, all answered the wrong box.
    to: orig.replyTo || orig.fromEmail,
    // "(no subject)" is a LIST PLACEHOLDER, not a subject. It used to go out
    // to the recipient as "Re: (no subject)" (2026-08-25).
    subject: replySubject(orig.subject),
    body,
    inReplyTo: orig.messageId,
    threadId: orig.threadId,
  };
}

// A To or Cc header can hold several "Name <addr>" entries separated by
// commas, and a display name is itself allowed to contain a comma
// ("Doe, Jane" <jane@x.com>). Split only on the commas that are actually
// between entries -- outside quotes, outside <...> -- then reduce each to
// its bare address.
function splitAddrs(raw: string): string[] {
  if (!raw.trim()) return [];
  const parts: string[] = [];
  let quoted = false, angled = false, cur = "";
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angled = true;
    else if (ch === ">" && !quoted) angled = false;
    if (ch === "," && !quoted && !angled) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => emailOf(p.trim())).filter(Boolean);
}

// Builds the fields for a Reply All: everyone else the message reached
// stays on the thread as Cc instead of silently dropping to just the last
// sender (S2-4, 2026-09-04 -- "Reply drops everyone except the last
// sender"). `selfEmail` is the account the thread arrived on, the one
// address that never needs to cc itself.
export function buildReplyAll(orig: MailFull, selfEmail: string, body: string): {
  to: string; cc: string; subject: string; body: string; inReplyTo: string; threadId: string;
} {
  const to = orig.replyTo || orig.fromEmail;
  const seen = new Set([selfEmail.toLowerCase(), to.toLowerCase()]);
  const cc: string[] = [];
  // EMAIL-F-15 (2026-09-05): when Reply-To redirects the answer, the person
  // who actually wrote is on neither the To nor the Cc line, so a Reply All
  // dropped them. They lead the Cc instead, which is also what makes the
  // Reply All button appear (MessagesFlow reads this cc to decide) on a
  // message whose only extra recipient is its own sender.
  for (const addr of [orig.fromEmail, ...splitAddrs(orig.to), ...splitAddrs(orig.cc)]) {
    const low = addr.toLowerCase();
    if (!low || seen.has(low)) continue;
    seen.add(low);
    cc.push(addr);
  }
  return {
    to,
    cc: cc.join(", "),
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

// S2-8 (2026-09-04): "You Have That File cannot attach it." A real
// attachment, base64-encoded the way any mail client sends one -- MIME
// requires binary-safe transport for a Content-Disposition part, and
// wrapping every line at 76 characters is the RFC 2045 rule, not a style
// choice.
export interface EmailAttachment { filename: string; mimeType: string; content: string }

function base64EncodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const b64 = btoa(bin);
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
}

// Encodes an email as the base64url RFC822 string Gmail's send wants.
// Plain text by default. With pixelUrl (email 3 open tracking) it becomes
// multipart/alternative: the same text, plus an HTML part that is nothing but
// the escaped text and one 1x1 tracking image. The words the recipient reads
// are identical either way. With an attachment (S2-8), the whole thing rides
// inside an outer multipart/mixed shell instead: the words half (plain, or
// the pixel's plain+html pair) as one part, the attachment as another.
export function encodeEmail(msg: {
  to: string; cc?: string; subject: string; body: string; inReplyTo?: string; pixelUrl?: string; attachment?: EmailAttachment;
}): string {
  // Subjects are decoded on the way IN now, so a reply to "Nächste Schritte"
  // carries real UTF-8 that cannot legally sit raw in a header. encodeWord
  // returns an ASCII subject untouched, which is nearly all of them.
  const headers = ["To: " + encodeWord(msg.to)];
  if (msg.cc && msg.cc.trim()) headers.push("Cc: " + encodeWord(msg.cc));
  headers.push("Subject: " + encodeWord(msg.subject));
  if (msg.inReplyTo) headers.push("In-Reply-To: " + msg.inReplyTo, "References: " + msg.inReplyTo);

  if (!msg.pixelUrl && !msg.attachment) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    return b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + msg.body);
  }

  const altBoundary = "=_jarvis_" + Math.abs(msg.body.length * 31 + msg.to.length).toString(36) + "_b";
  let altParts = "";
  if (msg.pixelUrl) {
    const html =
      "<div>" + escapeHtml(msg.body).replace(/\r?\n/g, "<br>") + "</div>" +
      '<img src="' + msg.pixelUrl + '" width="1" height="1" alt="">';
    altParts = [
      "--" + altBoundary,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      msg.body,
      "--" + altBoundary,
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
      "--" + altBoundary + "--",
    ].join("\r\n");
  }

  if (!msg.attachment) {
    headers.push('Content-Type: multipart/alternative; boundary="' + altBoundary + '"');
    return b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + altParts);
  }

  const mixedBoundary = "=_jarvis_" + Math.abs(msg.body.length * 17 + msg.attachment.filename.length).toString(36) + "_m";
  const wordsPart = msg.pixelUrl
    ? 'Content-Type: multipart/alternative; boundary="' + altBoundary + '"\r\n\r\n' + altParts
    : "Content-Type: text/plain; charset=UTF-8\r\n\r\n" + msg.body;
  const mixedParts = [
    "--" + mixedBoundary,
    wordsPart,
    "--" + mixedBoundary,
    "Content-Type: " + msg.attachment.mimeType + '; name="' + encodeWord(msg.attachment.filename) + '"',
    'Content-Disposition: attachment; filename="' + encodeWord(msg.attachment.filename) + '"',
    "Content-Transfer-Encoding: base64",
    "",
    base64EncodeUtf8(msg.attachment.content),
    "--" + mixedBoundary + "--",
  ].join("\r\n");
  headers.push('Content-Type: multipart/mixed; boundary="' + mixedBoundary + '"');
  return b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + mixedParts);
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
