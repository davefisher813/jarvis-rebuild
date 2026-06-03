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

function header(meta: GmailMeta, name: string): string {
  const h = (meta.payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}
function displayFrom(raw: string): string {
  const m = raw.match(/^(.*?)\s*<.*>$/);
  return (m && m[1]!.trim()) || raw || "(unknown)";
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
export interface MailFull extends MailRow {
  to: string;
  fromEmail: string;
  date: string;
  body: string;
  threadId: string;
  messageId: string;
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
function stripHtml(h: string): string {
  return h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
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
function headerOf(headers: GmailHeader[] | undefined, name: string): string {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}
function emailOf(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m && m[1]!.trim()) || raw.trim();
}

export function mapGmailFull(m: GmailFull): MailFull {
  const row = mapGmailMessage(m);
  const hs = m.payload?.headers;
  return {
    ...row,
    to: headerOf(hs, "To"),
    fromEmail: emailOf(headerOf(hs, "From")),
    date: headerOf(hs, "Date"),
    body: extractBody(m.payload),
    threadId: m.threadId || "",
    messageId: headerOf(hs, "Message-ID"),
  };
}

// Builds the fields for a threaded reply to a message.
export function buildReply(orig: MailFull, body: string): {
  to: string; subject: string; body: string; inReplyTo: string; threadId: string;
} {
  return {
    to: orig.fromEmail,
    subject: /^re:/i.test(orig.subject) ? orig.subject : "Re: " + orig.subject,
    body,
    inReplyTo: orig.messageId,
    threadId: orig.threadId,
  };
}

// Encodes a plain-text email as the base64url RFC822 string Gmail's send wants.
export function encodeEmail(msg: { to: string; subject: string; body: string; inReplyTo?: string }): string {
  const headers = ["To: " + msg.to, "Subject: " + msg.subject, "Content-Type: text/plain; charset=UTF-8"];
  if (msg.inReplyTo) headers.push("In-Reply-To: " + msg.inReplyTo, "References: " + msg.inReplyTo);
  return b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + msg.body);
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
