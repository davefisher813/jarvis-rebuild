import { cleanBody } from "./bodyText";
import { untrustedText } from "./untrusted";

// WHAT THE BRIEF READS, AND HOW A CLAIM IS CHECKED AGAINST IT (2026-09-29).
//
// The brief is one AI call per thread, and three screens now stand on what it
// says about the conversation: a calendar offer, a reply checklist, and a
// notification action. Model output is untrusted, so the model is never asked
// to be right; it is asked to POINT, at a message id and at a sentence, and
// this file is the check that the pointing is real:
//
//   - A CLAIM'S SENTENCE MUST BE IN THE MESSAGE IT NAMES. Compared after the
//     same cleaning the model was shown, ignoring case, spacing and curly
//     quotes, and nothing else. A sentence that is not there is not a
//     paraphrase to be forgiven; the claim is dropped.
//   - QUOTED HISTORY IS NOT READ. "> can you send the waiver" inside a reply
//     is the sender quoting the earlier message, which is already a message of
//     its own. It is removed before the model sees it and before a quote is
//     checked, so a resolved ask cannot come back through a reply's quote block.
//   - WHO SAID IT IS DECIDED HERE. A message is "self" when it came from one
//     of the connected addresses; the model never says who is who.
//   - LONG THREADS ARE CHUNKED, NOT CUT. The old read took the last four
//     messages and the first 1,200 characters of each, silently. A conversation
//     is now split into bounded chunks, newest first; anything that is not read
//     is COUNTED, so a checklist built on a partial read says it is partial.
//
// Pure. No network, no storage.

/** The part of a full message this reads. MailFull satisfies it. */
export interface SourceInput {
  id: string;
  from: string;
  fromEmail: string;
  dateMs: number;
  body: string;
}

export interface SourceMessage {
  id: string;
  role: "self" | "other";
  from: string;
  dateMs: number;
  /** Cleaned, quote-free and safe to put inside the untrusted block. */
  text: string;
  /**
   * True from the last message the reader sent onward. What the sender is
   * waiting to hear is only ever asked in that window: an ask from before the
   * reader's own reply has had its answer. Older messages are still read, for
   * the appointments they set.
   */
  relevant: boolean;
}

/** Quoted history: lines that begin with ">", and everything under "On ... wrote:" or an Outlook header. */
export function withoutQuoted(text: string): string {
  const out: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*>/.test(line)) continue;
    // "On Mon, Sep 21, 2026 at 2:05 PM Wei <wei@x.com> wrote:", possibly wrapped onto a second line.
    if (/^\s*On\b.{0,160}\bwrote:\s*$/i.test(line) || (/^\s*On\b/i.test(line) && /\bwrote:\s*$/i.test((lines[i + 1] ?? "")) && line.length < 160)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)) break;
    if (/^\s*_{5,}\s*$/.test(line) && /^\s*From:/i.test(lines[i + 1] ?? "")) break;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function sourceMessages(messages: readonly SourceInput[], selfEmails: readonly string[]): SourceMessage[] {
  const self = new Set(selfEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const out: SourceMessage[] = messages.map((m) => ({
    id: m.id,
    role: self.has((m.fromEmail || "").trim().toLowerCase()) ? "self" : "other",
    from: m.from,
    dateMs: m.dateMs,
    text: untrustedText(withoutQuoted(cleanBody(m.body))).trim(),
    relevant: true,
  }));
  let lastSelf = -1;
  for (let i = 0; i < out.length; i++) if (out[i]!.role === "self") lastSelf = i;
  // The reader's own last message is in the window so the model can see what
  // it answered; everything before it is context for appointments only.
  for (let i = 0; i < out.length; i++) out[i]!.relevant = i >= Math.max(0, lastSelf);
  return out;
}

/** The content revision: the latest message. A new message invalidates every reading of the thread. */
export function revisionOf(messages: readonly { id: string }[], fallback: string): string {
  return messages[messages.length - 1]?.id || fallback;
}

// ---------------------------------------------------------------------------
// The check that a quote is real
// ---------------------------------------------------------------------------

/** Case, spacing, curly quotes and dashes flattened, for comparison only. */
export function normQuote(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const QUOTE_MIN = 6;
export const QUOTE_MAX = 400;

/** True only when the quote is a real stretch of the message's own text. */
export function quoteIn(text: string, quote: unknown): quote is string {
  if (typeof quote !== "string") return false;
  const q = normQuote(quote);
  if (q.length < QUOTE_MIN || q.length > QUOTE_MAX) return false;
  return normQuote(text).includes(q);
}

// cyrb53: a small, well-mixed 53-bit string hash. Not a security hash; ids only
// need to be the same on every device for the same inputs and to collide
// never in one person's mailbox.
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * A claim's id: the account, the thread, the message and the normalised
 * sentence, hashed. The same conversation reads to the same ids on every
 * device and every reopen; the model never chooses one.
 */
export function stableId(prefix: string, account: string, threadId: string, messageId: string, quote: string): string {
  const key = [account.trim().toLowerCase(), threadId, messageId, normQuote(quote)].join("␟");
  return prefix + "_" + cyrb53(key).toString(36) + cyrb53(key, 7).toString(36).slice(0, 4);
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Characters of message text per model call. Bounded so a call is always small. */
export const CHUNK_CHARS = 7000;
/** Model calls one thread may cost. A typical thread is one. */
export const MAX_CHUNKS = 3;

export interface Segment { msg: SourceMessage; text: string; part: number }
export interface Chunk { index: number; segments: Segment[]; chars: number }

// Cut at the last paragraph or sentence end before the limit, never mid-word.
function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"), window.lastIndexOf("? "), window.lastIndexOf("! "));
    const at = cut > limit * 0.5 ? cut + 1 : Math.max(window.lastIndexOf(" "), Math.floor(limit * 0.5));
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

export interface ChunkPlan {
  /** Newest first. At most MAX_CHUNKS. */
  chunks: Chunk[];
  /** Segments that fit in no chunk. Never read. */
  skipped: Segment[];
  /** True when nothing relevant to the reply checklist was left unread. */
  completeSource: boolean;
}

/**
 * Splits the conversation into bounded chunks, newest first, and says what was
 * not read. `limit` is the size of one chunk; a message longer than it is split
 * on sentence boundaries across chunks.
 */
export function planChunks(messages: readonly SourceMessage[], limit = CHUNK_CHARS, maxChunks = MAX_CHUNKS): ChunkPlan {
  const segments: Segment[] = [];
  for (const msg of messages) {
    if (!msg.text) continue;
    const pieces = splitText(msg.text, limit);
    pieces.forEach((text, part) => segments.push({ msg, text, part }));
  }
  // Fill from the newest segment backward.
  const chunks: Chunk[] = [];
  let cur: Segment[] = [];
  let chars = 0;
  let i = segments.length - 1;
  for (; i >= 0; i--) {
    const s = segments[i]!;
    if (cur.length && chars + s.text.length > limit) {
      chunks.push({ index: chunks.length, segments: cur.reverse(), chars });
      cur = []; chars = 0;
      if (chunks.length >= maxChunks) break;
    }
    cur.push(s); chars += s.text.length;
  }
  if (cur.length && chunks.length < maxChunks) chunks.push({ index: chunks.length, segments: cur.reverse(), chars });
  const readSegs = new Set(chunks.flatMap((c) => c.segments));
  const skipped = segments.filter((s) => !readSegs.has(s));
  return { chunks, skipped, completeSource: !skipped.some((s) => s.msg.relevant) };
}

/** One chunk as the prompt shows it: a header per message, from code, then the text. */
export function renderChunk(chunk: Chunk, zone: string, label: (ms: number, zone: string) => string): string {
  const out: string[] = [];
  let lastId = "";
  for (const s of chunk.segments) {
    if (s.msg.id !== lastId) {
      out.push(`[message ${s.msg.id} | ${s.msg.role === "self" ? "from you" : "from them: " + s.msg.from} | ${label(s.msg.dateMs, zone)}]`);
      lastId = s.msg.id;
    } else {
      out.push("[same message, continued]");
    }
    out.push(s.text);
    out.push("---");
  }
  return out.join("\n");
}

/** The messages a chunk actually showed, with the text that was shown, for checking quotes against. */
export function shownMessages(chunk: Chunk): SourceMessage[] {
  const byId = new Map<string, SourceMessage>();
  for (const s of chunk.segments) {
    const prev = byId.get(s.msg.id);
    byId.set(s.msg.id, prev ? { ...prev, text: prev.text + "\n" + s.text } : { ...s.msg, text: s.text });
  }
  return [...byId.values()];
}
