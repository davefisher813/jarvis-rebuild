import { decodeEntities } from "../connections/google/decode";
import { dropHidden, type ThreadRow } from "../connections/google/map";
import { readIcs, type IcsEvent } from "./ics";
import { isNoReply } from "./noReply";
import { parseUnsub, type Unsub } from "./unsubscribe";
import { mailMessageKey } from "./mailIdentity";
import { displayName } from "./names";
import type { Bucket, TriageMap } from "./triage";
import type { MailThread } from "./home";
import { askedFor, type UnsubRecord } from "./unsubRecords";
import type {
  ActionEvidence, MeetingCandidate, NotificationAction, NotificationActionKind,
  NotificationClassification, PromptLink,
} from "./mailContracts";

// WHAT A NOTIFICATION WANTS DONE, AND ONLY WHAT CAN BE PROVEN (2026-09-29).
//
// Dave's email design is inbox zero without reading. A notification (an access
// request, a signature, a parcel, a code) is not a conversation, so the Today
// band offers the one tap that does what the message is for, and never offers
// Write Back to a mailbox nobody reads. This module is the whole decision, and
// it is pure: it reads text the caller already fetched, it renders nothing,
// opens nothing, fetches nothing, and asks no model anything.
//
// Laws, each with a test:
//   - THE MODEL NEVER SUPPLIES A URL. Every URL here was extracted from the
//     message itself and validated in code. A model may name a link id it was
//     shown; an id that is not in the list drops the whole classification.
//   - HTTPS ONLY, NO CREDENTIALS. http, javascript, data, file, a URL with a
//     user or password in it, a bare IP, a name with no dot: all rejected.
//   - A GOOGLE ACTION OPENS A GOOGLE HOST, EXACTLY. docs.google.com.evil.com
//     and docs-google.com are not Google. Exact host, never a substring.
//   - THIRD-PARTY HOSTS MUST EARN IT. A Sign, Fix or Track link is accepted
//     only on a host the kind is known for, or one that belongs to the same
//     organisation as the sender. The hostname travels with the action so the
//     screen can show where the tap goes.
//   - UNCERTAIN MEANS VIEW EMAIL. Two competing actions, an ambiguous code, a
//     link that fails a check: no special action. The caller shows View Email
//     or nothing, never a guess.
//   - A CODE IS NEVER STORED OR SENT. Codes are found by pattern, held in
//     short-lived memory keyed by owner, account and message, and redacted out
//     of anything that reaches a model or a persisted snapshot.
//   - NOTHING IS FETCHED FROM A LINK, EVER. No redirect is followed and no page
//     is read to decide. A tracking link behind a redirector is View Email.

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** The button for each kind. Exhaustive by type: a new kind cannot ship without a label. */
export const ACTION_LABEL: Record<NotificationActionKind, string> = {
  grant_access: "Grant Access",
  open_share: "Open",
  accept_invite: "Accept",
  sign: "Sign",
  track: "Track",
  add_travel: "Add to Schedule",
  fill_form: "Fill Out",
  fix_payment: "Fix",
  copy_code: "Copy Code",
  unsubscribe: "Unsubscribe",
};

/** The label while the tap is being carried out. Never says "done". */
export const BUSY_LABEL: Record<NotificationActionKind, string> = {
  grant_access: "Opening…",
  open_share: "Opening…",
  accept_invite: "Opening…",
  sign: "Opening…",
  track: "Opening…",
  add_travel: "Adding…",
  fill_form: "Opening…",
  fix_payment: "Opening…",
  copy_code: "Copying…",
  unsubscribe: "Asking…",
};

/** What a notice offers when it has no specialised action. Opens the thread. */
export const VIEW_LABEL = "View Email";

export const NOTIFICATION_ACTION_KINDS = Object.keys(ACTION_LABEL) as NotificationActionKind[];

export function isNotificationKind(v: unknown): v is NotificationActionKind {
  return typeof v === "string" && (NOTIFICATION_ACTION_KINDS as string[]).includes(v);
}

/** Kinds whose tap opens an external page. Exhaustive: a new kind has to choose. */
const OPENS_PAGE: Record<NotificationActionKind, boolean> = {
  grant_access: true, open_share: true, accept_invite: true, sign: true, track: true, add_travel: false,
  fill_form: true, fix_payment: true, copy_code: false, unsubscribe: false,
};
export function opensExternalPage(kind: NotificationActionKind): boolean { return OPENS_PAGE[kind]; }

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const MAX_URL = 2048;

/**
 * The URL as written, when and only when it is safe to open: HTTPS, a real
 * hostname, no credentials, no whitespace or control characters. The string
 * comes back UNCHANGED (a signed link's query must not be re-encoded); the
 * parse is only the test.
 */
export function validateHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL) return null;
  // Whitespace and control characters inside a URL are how two parsers come to
  // disagree about where the host is. A backslash is the same trick.
  if (/[\u0000- \u007f-\u009f\\]/.test(s)) return null;
  if (!/^https:\/\//i.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host || !host.includes(".") || host.endsWith(".") || host.startsWith(".")) return null;
  // An address is not a name anyone chose to send you to.
  if (host.includes(":") || host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return null;
  if (host === "localhost" || /\.(localhost|local|internal|lan)$/.test(host)) return null;
  return s;
}

/** The hostname of a URL that already passed validateHttpsUrl, else "". */
export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function pathOf(url: string): string {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return ""; }
}

// Exact hosts. A Google action opens one of these and nothing that merely
// contains the word, so a lookalike (docs.google.com.evil.example, docs-google.com,
// a punycode twin) has nothing to match.
const GOOGLE_DOC_HOSTS = ["docs.google.com", "drive.google.com"];
const GOOGLE_CAL_HOSTS = ["calendar.google.com", "www.google.com"];
const GOOGLE_FORM_HOSTS = ["docs.google.com", "forms.gle"];

export function isGoogleHost(host: string): boolean {
  return host === "google.com" || host.endsWith(".google.com");
}

const under = (host: string, root: string): boolean => host === root || host.endsWith("." + root);

const SIGN_HOSTS = ["docusign.net", "docusign.com", "hellosign.com", "adobesign.com", "echosign.com", "pandadoc.com", "signnow.com"];
const TRACK_HOSTS = [
  "ups.com", "fedex.com", "usps.com", "dhl.com", "amazon.com", "ontrac.com", "lasership.com",
  "narvar.com", "aftership.com", "shop.app", "royalmail.com", "canadapost-postescanada.ca",
];

function domainOf(email: string): string {
  const m = /@([^@>\s]+)>?\s*$/.exec((email || "").trim().toLowerCase());
  return m ? m[1]! : "";
}

// The organisation a name belongs to, approximately: the last two labels, or
// three under a country-code second level (example.co.uk). Not the public
// suffix list, and it does not need to be: it decides whether a link belongs
// to the sender, and anything it cannot place is View Email.
function orgOf(host: string): string {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const tld = parts[parts.length - 1]!;
  const sld = parts[parts.length - 2]!;
  const take = tld.length === 2 && ["co", "com", "org", "net", "gov", "ac", "ne", "or"].includes(sld) ? 3 : 2;
  return parts.slice(-take).join(".");
}

export function sameOrg(linkHost: string, fromEmail: string): boolean {
  const d = domainOf(fromEmail);
  return !!linkHost && !!d && orgOf(linkHost) === orgOf(d);
}

// ---------------------------------------------------------------------------
// Codes: found by pattern, never stored, never sent
// ---------------------------------------------------------------------------

// Every pattern is anchored on a code WORD, or on the phrase a code arrives in.
// A bare four to eight digit number is a price, a year and a phone extension
// before it is a code, so no pattern here matches one without its context.
// Group 1 of each is the digits.
const CODE_PATTERNS: RegExp[] = [
  /\b(?:code|passcode|otp|pin)\b(?:\s+(?:is|was))?\s*[:\-–]?\s*(\d{3}[ -]\d{3}|\d{4,8})\b/gi,
  /\b(\d{4,8})\b(?=\s+(?:is|as)\s+your\s+(?:[A-Za-z0-9'’]+\s+){0,4}?(?:code|passcode|otp|pin)\b)/gi,
  /\b(?:code|passcode|otp)\b[^\n\d]{0,60}\n+\s*(\d{4,8})\s*(?:\n|$)/gi,
  /\buse\s+(?:code\s+)?(\d{4,8})\s+(?:to|as|for)\b/gi,
  /\benter\s+(?:the\s+|this\s+)?(?:code\s+|passcode\s+)?(\d{4,8})\b/gi,
];

/** Distinct codes in the text, in order, digits only, leading zeroes kept. */
export function findCodes(text: string): string[] {
  const out: string[] = [];
  for (const re of CODE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const digits = (m[1] ?? "").replace(/[ -]/g, "");
      if (/^\d{4,8}$/.test(digits) && !out.includes(digits)) out.push(digits);
    }
  }
  return out;
}

/** The text with every code in it blanked. What a model or a stored snapshot may see. */
export function redactCodes(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of CODE_PATTERNS) out = out.replace(re, (m, g: string | undefined) => (g ? m.replace(g, "••••") : m));
  return out;
}

const STRONG_CODE_WORDS = /\b(?:(?:verification|security|login|log-in|sign-in|one[- ]time|authentication|confirmation|access)\s+code|passcode|otp)\b/i;

// Short-lived memory. Keyed by owner, account and message, so one person's code
// is never another's and a newer message never inherits an older one. Never
// written to storage, never logged.
const CODE_TTL_MS = 15 * 60e3;
const CODE_CAP = 32;
const codeMemory = new Map<string, { code: string; at: number }>();

export interface CodeScope { userId: string; account: string; messageId: string }
const codeKey = (s: CodeScope): string => mailMessageKey({ userId: s.userId, account: s.account }, s.messageId);

function sweepCodes(now: number): void {
  for (const [k, v] of codeMemory) if (now - v.at > CODE_TTL_MS) codeMemory.delete(k);
  while (codeMemory.size > CODE_CAP) {
    const oldest = codeMemory.keys().next().value;
    if (oldest === undefined) break;
    codeMemory.delete(oldest);
  }
}

export function rememberCode(scope: CodeScope, code: string, now = Date.now()): void {
  sweepCodes(now);
  codeMemory.delete(codeKey(scope));
  codeMemory.set(codeKey(scope), { code, at: now });
  sweepCodes(now);
}

export function recallCode(scope: CodeScope, now = Date.now()): string | null {
  const e = codeMemory.get(codeKey(scope));
  if (!e) return null;
  if (now - e.at > CODE_TTL_MS) { codeMemory.delete(codeKey(scope)); return null; }
  return e.code;
}

/** For tests and sign-out: forget every code. */
export function forgetAllCodes(): void { codeMemory.clear(); }

// ---------------------------------------------------------------------------
// Extraction: the message, read inertly
// ---------------------------------------------------------------------------

export interface EvidenceInput {
  threadId: string;
  /** The message these links came from. */
  messageId: string;
  /** The content revision the caller keys its cache on (the thread's last message id). */
  revision: string;
  fromEmail: string;
  subject: string;
  /** Plain text, as the reader shows it. */
  body: string;
  /** The HTML part, untouched. Parsed as text: nothing is rendered or loaded. */
  html?: string | null;
  /** The raw List-Unsubscribe header. */
  listUnsubscribe?: string;
  /** Raw text/calendar bodies (inline parts, or attachments the caller fetched). */
  ics?: readonly string[];
}

export interface ExtractedLink {
  /** Stable for the same message and URL: a saved classification can still find its link. */
  id: string;
  url: string;
  host: string;
  /** The words the sender put on the link, code-free. */
  text: string;
  source: "html" | "text" | "ics";
}

export interface CalendarEvidence {
  method?: string;
  cancelled: boolean;
  /** VEVENTs across every calendar part. */
  count: number;
  event: IcsEvent | null;
  uid?: string;
  tzid?: string;
}

export interface ActionEvidenceBundle {
  threadId: string;
  sourceMessageId: string;
  sourceRevision: string;
  fromEmail: string;
  subject: string;
  /** Subject and body. Held for this pass only: it is where a quote is verified. */
  text: string;
  links: ExtractedLink[];
  /** What the brief may show a model: id, host, anchor text. Never a URL, never a code. */
  promptLinks: PromptLink[];
  /** Codes found by pattern. IN MEMORY FOR THIS PASS ONLY: never persisted, never sent. */
  codes: string[];
  /** The message reads like a code mail (a code word is in it), found or not. */
  codeMail: boolean;
  unsubscribe: Unsub | null;
  calendar: CalendarEvidence | null;
  /** Links seen and refused (not HTTPS, credentials, and so on). */
  rejected: number;
}

const MAX_LINKS = 24;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const stripTags = (h: string): string => decodeEntities(h.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

interface RawLink { url: string; text: string; source: ExtractedLink["source"] }

function linksFromHtml(html: string): RawLink[] {
  const out: RawLink[] = [];
  // Hidden anchors are dropped as the reader drops them: a link a person
  // cannot see is not one the app may point at.
  const visible = dropHidden(html);
  const re = /<a\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/a\s*>/gi;
  for (const m of visible.matchAll(re)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1] ?? "");
    const raw = href ? (href[1] ?? href[2] ?? href[3] ?? "") : "";
    if (!raw) continue;
    out.push({ url: decodeEntities(raw).trim(), text: stripTags(m[2] ?? ""), source: "html" });
  }
  return out;
}

function linksFromText(text: string, source: "text" | "ics"): RawLink[] {
  const out: RawLink[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"' ]+/gi)) {
    out.push({ url: m[0].replace(/[).,;:!?\]}'"]+$/, ""), text: "", source });
  }
  return out;
}

function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function readCalendar(parts: readonly string[]): { evidence: CalendarEvidence | null; links: RawLink[] } {
  const usable = parts.filter((p) => /BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(p));
  if (usable.length === 0) return { evidence: null, links: [] };
  let count = 0;
  let event: IcsEvent | null = null;
  let method: string | undefined;
  let cancelled = false;
  let uid: string | undefined;
  let tzid: string | undefined;
  const links: RawLink[] = [];
  for (const raw of usable) {
    const flat = unfoldIcs(raw);
    const r = readIcs(raw);
    count += r.count;
    if (!event && r.event) {
      event = r.event;
      uid = /^UID:(.+)$/im.exec(flat)?.[1]?.trim();
      tzid = /^DTSTART[^:\n]*;TZID=([^;:\n]+)/im.exec(flat)?.[1]?.replace(/^"|"$/g, "").trim();
    }
    method ??= /^METHOD:(.+)$/im.exec(flat)?.[1]?.trim().toUpperCase();
    if (/^STATUS:CANCELLED/im.test(flat) || method === "CANCEL") cancelled = true;
    const url = /^URL[^:\n]*:(https?:\/\/.+)$/im.exec(flat)?.[1]?.trim();
    if (url) links.push({ url, text: "", source: "ics" });
    links.push(...linksFromText(flat.replace(/\\n/gi, " ").replace(/\\,/g, ","), "ics"));
  }
  return { evidence: { ...(method ? { method } : {}), cancelled, count, event, ...(uid ? { uid } : {}), ...(tzid ? { tzid } : {}) }, links };
}

/**
 * Reads one message's own links, headers and calendar parts into a bundle.
 * Deterministic and inert: the HTML is scanned as text (nothing renders, no
 * image loads, no script runs), no link is visited, no redirect followed.
 */
export function extractActionEvidence(input: EvidenceInput): ActionEvidenceBundle {
  const raws: RawLink[] = [];
  if (input.html) raws.push(...linksFromHtml(input.html));
  raws.push(...linksFromText(input.body || "", "text"));
  const cal = readCalendar(input.ics ?? []);
  raws.push(...cal.links);

  let rejected = 0;
  const byUrl = new Map<string, ExtractedLink>();
  for (const r of raws) {
    const url = validateHttpsUrl(r.url);
    if (!url) { rejected++; continue; }
    const text = redactCodes(r.text).slice(0, 80);
    const prior = byUrl.get(url);
    if (prior) { if (!prior.text && text) prior.text = text; continue; }
    byUrl.set(url, { id: "", url, host: hostOf(url), text, source: r.source });
  }
  const links = [...byUrl.values()].slice(0, MAX_LINKS);
  const seen = new Set<string>();
  for (const l of links) {
    let id = "L" + fnv(input.messageId + "\u0000" + l.url);
    while (seen.has(id)) id += "x";
    seen.add(id);
    l.id = id;
  }

  const text = (input.subject || "") + "\n" + (input.body || "");
  const head = text.slice(0, 1800);
  const unsub = input.listUnsubscribe ? parseUnsub(input.listUnsubscribe) : null;
  const unsubscribe = unsub && (unsub.kind === "mailto" || validateHttpsUrl(unsub.target)) ? unsub : null;

  return {
    threadId: input.threadId,
    sourceMessageId: input.messageId,
    sourceRevision: input.revision,
    fromEmail: input.fromEmail,
    subject: input.subject || "",
    text,
    links,
    promptLinks: links.map((l) => ({ id: l.id, host: l.host, text: l.text })),
    codes: findCodes(text),
    codeMail: STRONG_CODE_WORDS.test(head),
    unsubscribe,
    calendar: cal.evidence,
    rejected,
  };
}

// ---------------------------------------------------------------------------
// Picking a link for a kind
// ---------------------------------------------------------------------------

const NOT_THE_ACTION = /unsubscribe|privacy|terms|preferences|manage\s+notifications|help\s+center|learn\s+more/i;

/** Does this host belong to this kind of action, given who sent the mail? */
function hostOk(kind: NotificationActionKind, l: ExtractedLink, b: ActionEvidenceBundle): boolean {
  const host = l.host;
  const path = pathOf(l.url);
  const fromGoogle = under(domainOf(b.fromEmail), "google.com");
  switch (kind) {
    case "grant_access":
    case "open_share":
      // Only a message that came from Google may ask to be trusted with a
      // Google page: a stranger's mail with a real docs link in it is a link.
      return fromGoogle && GOOGLE_DOC_HOSTS.includes(host);
    case "accept_invite":
      return GOOGLE_CAL_HOSTS.includes(host) && path.startsWith("/calendar/");
    case "fill_form":
      return (host === "docs.google.com" && /^\/forms\//.test(path) && !/[?&]edit2=/.test(path)) || (host === "forms.gle");
    case "sign":
      return SIGN_HOSTS.some((d) => under(host, d)) || sameOrg(host, b.fromEmail);
    case "track":
      return TRACK_HOSTS.some((d) => under(host, d)) || sameOrg(host, b.fromEmail);
    case "fix_payment":
      return sameOrg(host, b.fromEmail);
    default:
      return false;
  }
}

/** Is this link, on a host that passed, actually the thing the kind is about? */
function relevant(kind: NotificationActionKind, l: ExtractedLink): boolean {
  const path = pathOf(l.url);
  const hay = l.text + " " + path;
  if (NOT_THE_ACTION.test(l.text) || /\/(unsubscribe|privacy|terms)\b/i.test(path)) return false;
  switch (kind) {
    case "grant_access": return /\/(document|spreadsheets|presentation|file|drawings|forms)\//.test(path) || /\/open\b/.test(path);
    case "open_share": return /\/(document|spreadsheets|presentation|file|drawings|forms|folders)\//.test(path) || /\/(drive\/folders|open)\b/.test(path);
    case "accept_invite": return /[?&]action=(RESPOND|VIEW)\b/i.test(path);
    case "fill_form": return /\/viewform\b/.test(path) || l.host === "forms.gle";
    case "sign": return /\/signing\//i.test(path) || /^(?:review\s+document|review\s+and\s+sign|sign\s+now|sign\s+document|start\s+signing|view\s+document|finish|sign)\b/i.test(l.text);
    case "track": return /track|shipment|progress|delivery|parcel/i.test(hay);
    case "fix_payment":
      return /\b(?:update|fix|retry|review|manage|change|verify)\b[^.]{0,24}\b(?:payment|billing|card|account|subscription)\b|\b(?:payment|billing)\b/i.test(l.text)
        || /\/(billing|payment|payments|update-payment|checkout|invoices?)\b/i.test(path);
    default: return false;
  }
}

// One target, however many buttons point at it. A Google document has several
// links to the same file (its title, its Share button) and they differ only in
// the query; anything else is distinct by its full URL, because two packages
// differ only in the query.
function targetKey(kind: NotificationActionKind, url: string): string {
  if (kind === "grant_access" || kind === "open_share") {
    try { const u = new URL(url); return u.hostname + u.pathname; } catch { return url; }
  }
  return url;
}

const PREFER: Partial<Record<NotificationActionKind, RegExp[]>> = {
  grant_access: [/^(?:share|give\s+access|grant|review)\b/i, /[?&]usp=access_request\b/],
  open_share: [/^(?:open|view|edit)\b/i],
  sign: [/\/signing\//i, /^(?:review\s+document|review\s+and\s+sign|sign\s+now|start\s+signing)\b/i],
  track: [/track/i],
  fix_payment: [/\b(?:update|fix|retry)\b/i],
};

function pickLink(kind: NotificationActionKind, b: ActionEvidenceBundle): ExtractedLink | null {
  const eligible = b.links.filter((l) => hostOk(kind, l, b) && relevant(kind, l));
  if (eligible.length === 0) return null;
  const distinct = (ls: ExtractedLink[]) => new Set(ls.map((l) => targetKey(kind, l.url))).size;
  // Of several links to one target, the one the sender made the button: its
  // words match what the kind's button says, else the first that has words.
  const best = (ls: ExtractedLink[]): ExtractedLink => {
    for (const re of PREFER[kind] ?? []) {
      const m = ls.find((l) => re.test(l.text + " " + pathOf(l.url)));
      if (m) return m;
    }
    return ls.find((l) => l.text) ?? ls[0]!;
  };
  if (distinct(eligible) === 1) return best(eligible);
  const tiers: ((l: ExtractedLink) => boolean)[] = [];
  if (kind === "accept_invite") {
    // Google's own "Yes" link first, then the event page. Never No or Maybe.
    tiers.push((l) => /[?&]action=RESPOND\b/i.test(l.url) && /[?&]rst=1\b/.test(l.url));
    tiers.push((l) => /[?&]action=VIEW\b/i.test(l.url));
  }
  for (const re of PREFER[kind] ?? []) tiers.push((l) => re.test(l.text + " " + pathOf(l.url)));
  for (const tier of tiers) {
    const narrowed = eligible.filter(tier);
    if (narrowed.length > 0 && distinct(narrowed) === 1) return best(narrowed);
  }
  return null; // competing: the caller shows View Email
}

// ---------------------------------------------------------------------------
// Calendar candidates
// ---------------------------------------------------------------------------

const addMinutes = (hhmm: string, mins: number): string | null => {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || !Number.isFinite(h) || !Number.isFinite(m)) return null;
  const total = h * 60 + m + mins;
  if (total >= 24 * 60) return null; // ends after midnight: no end is stated rather than a wrong one
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

function validZone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return undefined; }
}

/** The calendar part as a candidate, when there is exactly one event. */
export function meetingFromCalendar(b: ActionEvidenceBundle): MeetingCandidate | null {
  const c = b.calendar;
  if (!c || !c.event || c.count !== 1) return null;
  const ev = c.event;
  const missing: MeetingCandidate["missing"] = [];
  if (!ev.start) missing.push("time");
  const tz = validZone(c.tzid);
  const end = ev.start && ev.durationMin ? addMinutes(ev.start, ev.durationMin) : null;
  return {
    id: "ics:" + fnv([b.threadId, b.sourceMessageId, c.uid ?? ev.title, ev.date, ev.start ?? ""].join("\u0000")),
    sourceMessageId: b.sourceMessageId,
    sourceQuote: ev.title,
    title: ev.title,
    status: c.cancelled ? "cancelled" : "requested",
    date: ev.date,
    ...(ev.start ? { start: ev.start } : {}),
    ...(end ? { end } : {}),
    ...(tz ? { timeZone: tz } : {}),
    missing,
    durationSource: ev.durationMin ? "stated" : "default",
  };
}

/** A candidate a caller may hand to the schedule without asking anything more. */
export function isCompleteMeeting(m: MeetingCandidate | undefined): m is MeetingCandidate {
  return !!m && m.missing.length === 0 && !!m.date && !!m.start && m.status !== "cancelled";
}

// ---------------------------------------------------------------------------
// Detection: what a message looks like it wants, as proposals to be validated
// ---------------------------------------------------------------------------

const RE_ACCESS = /\b(?:request(?:s|ed|ing)?|asking(?:\s+for)?|wants?)\s+(?:for\s+)?(?:edit\s+|view\s+|comment\s+)?access\b|\baccess\s+request\b/i;
const RE_SHARE = /\b(?:shared|sharing)\b[^\n]{0,80}\bwith\s+you\b|\binvited\s+you\s+to\s+(?:view|edit|comment|collaborate)\b|\bhas\s+shared\b/i;
const RE_INVITE_SUBJECT = /^\s*(?:updated\s+invitation|invitation)\b/i;
const RE_SIGN = /\b(?:docusign|e-?sign(?:ature)?|signature\s+(?:requested|needed|required)|please\s+sign|review\s+and\s+sign|sign\s+(?:the|this)\s+document|awaiting\s+your\s+signature)\b/i;
const RE_TRACK = /\b(?:tracking|track\s+(?:your|my|the)\s+(?:package|order|shipment|delivery|parcel)|shipped|out\s+for\s+delivery|on\s+its\s+way|delivery\s+(?:update|status))\b/i;
const RE_PAY = /\b(?:payment\s+(?:failed|declined|unsuccessful|problem|issue|was\s+declined|could\s+not\s+be\s+processed)|(?:couldn'?t|could\s+not|unable\s+to)\s+(?:process|charge)\s+your\s+(?:payment|card)|card\s+(?:was\s+)?declined|update\s+your\s+(?:payment|billing)|billing\s+(?:problem|issue)|failed\s+payment)\b/i;
const RE_TRAVEL = /\b(?:flight|itinerary|boarding\s+pass|e-?ticket|reservation|hotel|check-?in|booking\s+confirmation|trip\s+confirmation)\b/i;

export interface AnalyzeContext {
  bucket?: Bucket;
  /** The optional model reading: a kind and a link id it was shown. Validated like any other proposal. */
  classification?: NotificationClassification;
  /** Candidates the brief read from an itinerary. Optional: the ICS is read either way. */
  meetings?: readonly MeetingCandidate[];
  /** When the message arrived, for how long a code stays useful. */
  messageAtMs?: number;
  now?: number;
}

function match(re: RegExp, text: string): string | undefined {
  const m = re.exec(text);
  return m ? m[0].replace(/\s+/g, " ").trim().slice(0, 120) : undefined;
}

function proposal(kind: NotificationActionKind, b: ActionEvidenceBundle, quote?: string): NotificationClassification | null {
  if (kind === "copy_code" || kind === "unsubscribe" || kind === "add_travel") return { kind, ...(quote ? { quote } : {}) };
  const l = pickLink(kind, b);
  return l ? { kind, linkId: l.id, ...(quote ? { quote } : {}) } : null;
}

function detectProposals(b: ActionEvidenceBundle, ctx: AnalyzeContext): NotificationClassification[] {
  const head = b.text.slice(0, 1800);
  const out: NotificationClassification[] = [];
  const add = (p: NotificationClassification | null) => { if (p) out.push(p); };
  const fromGoogle = under(domainOf(b.fromEmail), "google.com");
  const cal = b.calendar;
  const invite = !!cal && (cal.method === "REQUEST" || RE_INVITE_SUBJECT.test(b.subject)) && !cal.cancelled;

  const asks = match(RE_ACCESS, head);
  if (asks && fromGoogle) add(proposal("grant_access", b, asks));
  else {
    const shared = match(RE_SHARE, head);
    if (shared && fromGoogle) add(proposal("open_share", b, shared));
  }
  if ((invite || RE_INVITE_SUBJECT.test(b.subject)) && !cal?.cancelled) add(proposal("accept_invite", b, match(RE_INVITE_SUBJECT, b.subject)));
  const sign = match(RE_SIGN, head);
  if (sign) add(proposal("sign", b, sign));
  const track = match(RE_TRACK, head);
  if (track) add(proposal("track", b, track));
  const pay = match(RE_PAY, head);
  if (pay) add(proposal("fix_payment", b, pay));
  // A form link needs no sentence: the path is the evidence, and a bare
  // response receipt (edit2=) is refused by the host rule.
  if (b.links.some((l) => hostOk("fill_form", l, b) && relevant("fill_form", l))) add(proposal("fill_form", b));
  if (b.codes.length === 1 && b.codeMail) add({ kind: "copy_code" });
  const travel = match(RE_TRAVEL, head);
  if (travel && !invite && ((cal?.count ?? 0) > 0 || (ctx.meetings?.length ?? 0) > 0)) add({ kind: "add_travel", quote: travel });
  if (b.unsubscribe && ctx.bucket !== "needs_you") add({ kind: "unsubscribe" });
  return out;
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

// A quote is copied from the message and checked to be inside it. One that is
// not is dropped and the action stands without it. A code is never quoted.
function verifiedQuote(q: string | undefined, b: ActionEvidenceBundle): string | undefined {
  const t = (q ?? "").trim();
  if (!t || t.length > 200) return undefined;
  if (!norm(b.text).includes(norm(t))) return undefined;
  const safe = redactCodes(t);
  return safe;
}

export interface ValidateContext {
  messageAtMs?: number;
  now?: number;
  meetings?: readonly MeetingCandidate[];
}

const CODE_USEFUL_MS = 15 * 60e3;

/**
 * Turns a proposal (from the deterministic reader or from a model) into an
 * action, or null. A model proposal may name a link id it was shown; the URL
 * always comes from the extracted list, and the host rules for the kind apply
 * to it whoever chose it.
 */
export function validateNotificationAction(
  p: NotificationClassification,
  b: ActionEvidenceBundle,
  ctx: ValidateContext = {},
): NotificationAction | null {
  if (!isNotificationKind(p.kind)) return null;
  const kind = p.kind;
  const quote = kind === "copy_code" ? undefined : verifiedQuote(p.quote, b);
  const evidence: ActionEvidence = {
    sourceMessageId: b.sourceMessageId,
    sourceRevision: b.sourceRevision,
    ...(quote ? { sourceQuote: quote } : {}),
  };

  if (kind === "copy_code") {
    // ONE unambiguous code, or nothing. The code itself is not in the action.
    if (b.codes.length !== 1) return null;
    const at = ctx.messageAtMs ?? ctx.now;
    return { kind, evidence, ...(at ? { expiresAt: new Date(at + CODE_USEFUL_MS).toISOString() } : {}) };
  }
  if (kind === "unsubscribe") {
    const u = b.unsubscribe;
    if (!u) return null;
    if (u.kind === "http" && !validateHttpsUrl(u.target)) return null;
    return { kind, evidence, unsubscribe: u };
  }
  if (kind === "add_travel") {
    const fromIcs = meetingFromCalendar(b);
    const candidates = [...(ctx.meetings ?? [])];
    if (fromIcs) candidates.push(fromIcs);
    const usable = candidates.filter(isCompleteMeeting);
    // Exactly one complete leg is added in one tap. More than one, or one
    // that is missing something, is a review: the action carries no meeting
    // and the tap opens the thread.
    const only = candidates.length === 1 && usable.length === 1 ? usable[0] : undefined;
    return { kind, evidence, ...(only ? { meeting: only } : {}) };
  }

  let link: ExtractedLink | undefined;
  if (p.linkId !== undefined) {
    link = b.links.find((l) => l.id === p.linkId);
    if (!link || !hostOk(kind, link, b)) return null;
  } else {
    link = pickLink(kind, b) ?? undefined;
    if (!link) return null;
  }
  const url = validateHttpsUrl(link.url);
  if (!url) return null;
  const meeting = kind === "accept_invite" ? meetingFromCalendar(b) : null;
  return {
    kind,
    evidence: { ...evidence, linkId: link.id },
    url,
    ...(meeting && isCompleteMeeting(meeting) ? { meeting } : {}),
  };
}

const sameTarget = (a: NotificationAction, c: NotificationAction): boolean =>
  a.kind === c.kind && targetKey(a.kind, a.url ?? "") === targetKey(c.kind, c.url ?? "") && (a.meeting?.id ?? "") === (c.meeting?.id ?? "");

/**
 * One action, or none. The same action twice (a button and a text link to the
 * same page) is one. A specialised action beats the generic Unsubscribe. Any
 * other pair is competing, and competing means the caller shows View Email.
 */
export function selectPrimaryMailAction(candidates: readonly NotificationAction[]): NotificationAction | null {
  const uniq: NotificationAction[] = [];
  for (const a of candidates) if (!uniq.some((u) => sameTarget(u, a))) uniq.push(a);
  const list = uniq.length > 1 ? uniq.filter((a) => a.kind !== "unsubscribe") : uniq;
  return list.length === 1 ? list[0]! : null;
}

export interface AnalyzeResult {
  action: NotificationAction | null;
  /** A code mail whose code was missing or ambiguous: surfaces as View Email for a few minutes. */
  view?: "code";
}

/** The whole reading: detect, add the optional model proposal, validate, select. */
export function analyzeNotification(b: ActionEvidenceBundle, ctx: AnalyzeContext = {}): AnalyzeResult {
  const proposals = detectProposals(b, ctx);
  if (ctx.classification) proposals.push(ctx.classification);
  const valid = proposals
    .map((p) => validateNotificationAction(p, b, ctx))
    .filter((a): a is NotificationAction => a !== null);
  const action = selectPrimaryMailAction(valid);
  if (action) return { action };
  if (b.codeMail && b.codes.length !== 1) return { action: null, view: "code" };
  return { action: null };
}

/** The kind a triage entry or a brief said, as a proposal with no link. */
export function classificationFrom(kind: unknown, extra?: NotificationClassification): NotificationClassification | undefined {
  if (extra) return extra;
  return isNotificationKind(kind) ? { kind } : undefined;
}

// ---------------------------------------------------------------------------
// Can this run here, and what do I call it
// ---------------------------------------------------------------------------

export interface ExecCaps { canOpen?: boolean; canCopy?: boolean; canSchedule?: boolean; hasMailApi?: boolean }

/**
 * Whether the tap can do what its label says on this device, right now. A
 * stored action is checked again here (storage can be edited), so a URL that
 * fails validation never reaches window.open.
 */
export function canExecuteMailAction(a: NotificationAction, caps: ExecCaps = {}): boolean {
  if (!isNotificationKind(a.kind)) return false;
  if (OPENS_PAGE[a.kind]) return validateHttpsUrl(a.url) !== null && caps.canOpen !== false;
  switch (a.kind) {
    case "copy_code": return caps.canCopy !== false;
    // With no complete meeting the tap opens the thread to review: always possible.
    case "add_travel": return a.meeting ? isCompleteMeeting(a.meeting) && caps.canSchedule !== false : true;
    case "unsubscribe":
      if (!a.unsubscribe) return false;
      return a.unsubscribe.kind === "mailto" ? caps.hasMailApi !== false : validateHttpsUrl(a.unsubscribe.target) !== null && caps.canOpen !== false;
    default: return false;
  }
}

/** What the tap will do, for the button and the receipt: the button's label, or View Email. */
export function labelFor(a: NotificationAction | undefined | null): string {
  return a && isNotificationKind(a.kind) ? ACTION_LABEL[a.kind] : VIEW_LABEL;
}

// ---------------------------------------------------------------------------
// The notification cache, as data (storage is notificationScan.ts)
// ---------------------------------------------------------------------------

/**
 * What the last analysis of one thread's latest message found. `action: null`
 * is a CACHED "nothing to do": the message was read, it holds no action, and
 * it is not read again until a newer message arrives.
 */
export interface NotificationEntry {
  /** The thread's last message id when this was read. An entry for another revision is never used. */
  rev: string;
  at: number;
  action: NotificationAction | null;
  /** The message carried a List-Unsubscribe header: it is bulk mail and has no one to reply to. */
  bulk?: boolean;
  /** A code mail with no single code: shown as View Email for a few minutes. */
  view?: "code";
}

export type EntryLookup = (account: string | undefined, threadId: string) => NotificationEntry | undefined;

/**
 * A stored action read back. Storage can be edited or can hold a shape from an
 * older build, so the fields that drive behaviour are checked again and an
 * action that fails is dropped, never repaired: a URL is re-validated, the
 * unsubscribe target is re-validated, a meeting must still be complete.
 */
export function readStoredAction(raw: unknown): NotificationAction | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (!isNotificationKind(r.kind)) return undefined;
  const ev = r.evidence as Record<string, unknown> | undefined;
  if (!ev || typeof ev.sourceMessageId !== "string" || typeof ev.sourceRevision !== "string") return undefined;
  const evidence: ActionEvidence = {
    sourceMessageId: ev.sourceMessageId,
    sourceRevision: ev.sourceRevision,
    ...(typeof ev.sourceQuote === "string" && r.kind !== "copy_code" ? { sourceQuote: ev.sourceQuote } : {}),
    ...(typeof ev.linkId === "string" ? { linkId: ev.linkId } : {}),
  };
  const kind = r.kind;
  const out: NotificationAction = { kind, evidence };
  if (kind === "copy_code") delete out.evidence.sourceQuote; // a code is never quoted, whatever a store says
  if (OPENS_PAGE[kind]) {
    const url = validateHttpsUrl(r.url);
    if (!url) return undefined;
    out.url = url;
  }
  if (kind === "unsubscribe") {
    const u = r.unsubscribe as Record<string, unknown> | undefined;
    if (!u || typeof u.target !== "string" || (u.kind !== "mailto" && u.kind !== "http")) return undefined;
    if (u.kind === "http" && !validateHttpsUrl(u.target)) return undefined;
    if (u.kind === "mailto" && !u.target.includes("@")) return undefined;
    out.unsubscribe = { kind: u.kind, target: u.target, ...(typeof u.subject === "string" ? { subject: u.subject } : {}) };
  }
  const m = r.meeting as Partial<MeetingCandidate> | undefined;
  if (m && (kind === "add_travel" || kind === "accept_invite")) {
    const ok = typeof m.id === "string" && typeof m.title === "string" && typeof m.date === "string" && typeof m.start === "string"
      && typeof m.sourceMessageId === "string" && typeof m.sourceQuote === "string" && Array.isArray(m.missing);
    if (ok && isCompleteMeeting(m as MeetingCandidate)) out.meeting = m as MeetingCandidate;
  }
  if (typeof r.expiresAt === "string" && Number.isFinite(Date.parse(r.expiresAt))) out.expiresAt = r.expiresAt;
  return out;
}

// ---------------------------------------------------------------------------
// The snapshot half
// ---------------------------------------------------------------------------

/** Bounded, and separate from the six needs-you rows. */
export const ACTIONABLE_LIMIT = 8;

const PRIORITY: Record<NotificationActionKind, number> = {
  copy_code: 0, sign: 1, fix_payment: 2, accept_invite: 3, grant_access: 4, fill_form: 5,
  add_travel: 6, open_share: 7, track: 8, unsubscribe: 9,
};
export function actionPriority(kind: NotificationActionKind): number { return PRIORITY[kind]; }

export interface SnapshotInput {
  owner: string;
  rows: readonly ThreadRow[];
  map: TriageMap;
  entryFor: EntryLookup;
  /** Unsubscribes already asked (account and sender): those are not offered again. */
  asked?: readonly UnsubRecord[];
  /** Thread ids already carried by the needs-you rows, which stay separate. */
  excludeIds?: ReadonlySet<string>;
  limit?: number;
  now?: number;
}

const fresh = (e: NotificationEntry | undefined, r: ThreadRow): e is NotificationEntry => !!e && e.rev === r.lastMsgId;

const expired = (a: NotificationAction, now: number): boolean => {
  if (!a.expiresAt) return false;
  const t = Date.parse(a.expiresAt);
  return Number.isFinite(t) && t < now;
};

const alreadyAsked = (asked: readonly UnsubRecord[] | undefined, account: string | undefined, fromEmail: string): boolean =>
  askedFor(asked ?? [], fromEmail, account);

export interface NotificationSnapshot {
  /** Threads with an action (or a View Email for a missing code) that are not among the needs-you rows. */
  actionable: MailThread[];
  /** The account, thread and revision facts, and the action, for a row the caller already writes. */
  fields: (r: ThreadRow) => Pick<MailThread, "revision" | "noReply" | "action" | "viewUntil">;
}

/**
 * The one helper both snapshot writers use, so the Email tab and the pump can
 * never disagree about what Today shows. It reads the cache only: no network,
 * no model, no body. Every thread it returns carries its account, its id and
 * the revision the action was read from.
 */
export function buildNotificationSnapshot(input: SnapshotInput): NotificationSnapshot {
  const now = input.now ?? Date.now();
  const limit = input.limit ?? ACTIONABLE_LIMIT;

  const fieldsFor = (r: ThreadRow): Pick<MailThread, "revision" | "noReply" | "action" | "viewUntil"> => {
    const e = input.entryFor(r.account, r.id);
    const live = fresh(e, r) ? e : undefined;
    const bucket = input.map[r.id]?.bucket;
    let action = live?.action ?? null;
    if (action && (expired(action, now) || (action.kind === "unsubscribe" && (bucket === "needs_you" || alreadyAsked(input.asked, r.account, r.fromEmail))))) action = null;
    const noReply = isNoReply(r.fromEmail, r.snippet, live?.bulk ? "bulk" : "");
    const viewUntil = live?.view === "code" && !action ? r.dateMs + CODE_USEFUL_MS : undefined;
    return {
      revision: r.lastMsgId,
      ...(noReply ? { noReply: true } : {}),
      ...(action ? { action } : {}),
      ...(viewUntil && viewUntil > now ? { viewUntil } : {}),
    };
  };

  const picked: { r: ThreadRow; f: ReturnType<typeof fieldsFor> }[] = [];
  for (const r of input.rows) {
    if (input.excludeIds?.has(r.id)) continue;
    const f = fieldsFor(r);
    if (f.action || f.viewUntil) picked.push({ r, f });
  }
  picked.sort((a, b) => {
    const pa = a.f.action ? PRIORITY[a.f.action.kind] : 1;
    const pb = b.f.action ? PRIORITY[b.f.action.kind] : 1;
    return pa !== pb ? pa - pb : b.r.dateMs - a.r.dateMs;
  });

  const actionable = picked.slice(0, limit).map(({ r, f }) => {
    const gist = redactCodes(input.map[r.id]?.gist ?? r.snippet ?? "");
    return {
      id: r.id,
      from: displayName(r.from),
      fromEmail: r.fromEmail,
      subject: redactCodes(r.subject),
      gist,
      snippet: redactCodes(r.snippet ?? ""),
      lastMsgId: r.lastMsgId,
      at: r.dateMs,
      ...(r.account ? { account: r.account } : {}),
      ...f,
    } satisfies MailThread;
  });
  return { actionable, fields: fieldsFor };
}
