import { untrustedBlock, HOSTILE_CLAUSE } from "./untrusted";

// EVERY CLAIM SHOWS THE SENTENCE THAT CAUSED IT (UP-MIND-12, Email E6, 5.1).
//
// A deadline chip you can tap to see the exact words is the difference
// between trusting the card and opening Gmail to check. Until now every
// claim the app made about an email -- the deadline, the dated commitment,
// the promise it swept out of sent mail -- arrived with no way back to the
// words it came from. The user's only options were belief and Gmail.
//
// The triple is {sourceMsgId, span, confidence}, and it is either VERBATIM or
// ABSENT. A span is kept only when it is found, character for character
// (whitespace normalised), inside a message body we actually fetched. That
// rule is generalised from saidWhat.ts's guard, which is the one place in
// this codebase that already refused a quote the model drifted a word on.
//
// The confidence is derived from the span, never self-reported by a model. A
// model asked to score itself will say 0.9 about a sentence it invented; a
// model asked to quote can be checked. Present and verbatim is "high",
// anything else is "low", and UP-MIND-18 is what reads that field.
//
// Where the spans come from (the E6 fork, option B): triage sees only a
// 200-character snippet, so most claims cannot be anchored there. For a
// thread that needs the user we fetch the full body -- the same fetch the
// Sweep deck already makes -- and anchor against that. Deterministically
// first, because the sender's own deadline phrase is COPIED out of the email
// by construction and finding the sentence around it costs nothing; a model
// call only for what is still unanchored after that. Same result as the
// option as written, fewer calls.

export interface Evidence {
  /** The Gmail message id the span was found in. */
  sourceMsgId: string;
  /** The sender's own words, verbatim, as they appear in that message. */
  span: string;
  /** Derived from the span, never claimed by a model. */
  confidence: "high" | "low";
}

/** One message, as much of it as the anchor check needs. */
export interface EvidenceMessage { id: string; body: string }

// Long enough to be a real sentence, short enough to sit in a sheet.
export const SPAN_MAX = 240;
// The prefix that has to match. Same 60 characters saidWhat.ts settled on: a
// model that trails off past the sentence it quoted still anchors, and a
// model that invented an opening clause does not.
const ANCHOR_CHARS = 60;

const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** True when `span` really appears in `body`. Whitespace is normalised on
 *  both sides, because a mail body arrives with the sender's line breaks in
 *  it and a quote never does. */
export function verbatimIn(span: string, body: string): boolean {
  const q = flat(span);
  if (!q) return false;
  return flat(body).includes(q.slice(0, ANCHOR_CHARS));
}

/** The triple for a span, or null when no fetched message contains it. Null
 *  is the honest answer and the card renders with no chip. */
export function evidenceIn(span: string, messages: EvidenceMessage[]): Evidence | null {
  const s = (span || "").replace(/\s+/g, " ").trim().slice(0, SPAN_MAX);
  if (!s) return null;
  for (const m of messages) {
    if (verbatimIn(s, m.body)) return { sourceMsgId: m.id, span: s, confidence: "high" };
  }
  return null;
}

// A sentence, roughly. Mail is not prose and this does not pretend otherwise:
// it breaks on sentence punctuation and on line ends, because a deadline in an
// email is as often its own line as it is a clause.
function sentences(body: string): string[] {
  return body
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/** THE FREE HALF. The sender's deadline phrase ("Friday", "end of month")
 *  was copied out of the email by triage, so the sentence containing it is
 *  findable without spending anything. Returns the whole sentence, not the
 *  phrase: "Friday" alone proves nothing, "Can you get it back to me by
 *  Friday" is the evidence. */
export function locateSpan(phrase: string, messages: EvidenceMessage[]): Evidence | null {
  const needle = flat(phrase);
  if (needle.length < 3) return null;
  // Newest first: when a thread repeats a deadline, the live one is the one
  // most recently written.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    for (const s of sentences(m.body)) {
      if (!flat(s).includes(needle)) continue;
      const span = s.slice(0, SPAN_MAX);
      return { sourceMsgId: m.id, span, confidence: "high" };
    }
  }
  return null;
}

// --- The model half, for claims the free half could not anchor ---

export const EVIDENCE_SYSTEM = [
  "You are given an email thread and one or more CLAIMS someone made about it.",
  "For each claim, find the sentence in the thread that the claim came from, and QUOTE IT VERBATIM.",
  "Never paraphrase, never combine two sentences, never write a sentence that is not in the thread.",
  'Reply with ONLY a JSON object: {"<claim key>": "<verbatim sentence>"}.',
  "Leave a claim OUT of the object when no sentence in the thread supports it. An empty object is a correct answer.",
  HOSTILE_CLAUSE,
].join("\n");

export function evidencePrompt(claims: Record<string, string>, messages: EvidenceMessage[]): string {
  const convo = messages.slice(-5).map((m) => m.body.slice(0, 1500)).join("\n---\n");
  const asked = Object.entries(claims).map(([k, v]) => `${k}: ${v}`).join("\n");
  return "CLAIMS:\n" + asked + "\n\nTHREAD:\n" + untrustedBlock(convo);
}

/** Tolerant, and never inventive: a quote that is not in the thread is
 *  dropped, so an obliging model buys the claim nothing. */
export function parseEvidence(raw: string, messages: EvidenceMessage[]): Record<string, Evidence> {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return {};
  let o: unknown;
  try { o = JSON.parse(raw.slice(a, b + 1)); } catch { return {}; }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return {};
  const out: Record<string, Evidence> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v !== "string") continue;
    const ev = evidenceIn(v, messages);
    if (ev) out[k] = ev;
  }
  return out;
}

// --- The pass ---

/** What a claim needs anchoring for: the key the answer comes back under, and
 *  the words the claim was made in. */
export interface EvidenceAsk { key: string; phrase: string }

export interface EvidencePassDeps {
  messages: EvidenceMessage[];
  asks: EvidenceAsk[];
  /** Shaped like AIService.complete, passed in so this module knows nothing
   *  about the service or its gates. Absent means the free half only. */
  complete?: (messages: { role: string; content: string }[], system: string) => Promise<string>;
}

/** Anchors every ask it can. Deterministic first, one model call for the
 *  rest, and nothing at all when the free half already found everything. */
export async function anchorClaims(deps: EvidencePassDeps): Promise<Record<string, Evidence>> {
  const out: Record<string, Evidence> = {};
  const left: EvidenceAsk[] = [];
  for (const ask of deps.asks) {
    const hit = locateSpan(ask.phrase, deps.messages);
    if (hit) out[ask.key] = hit;
    else left.push(ask);
  }
  if (left.length === 0 || !deps.complete) return out;
  const claims: Record<string, string> = {};
  for (const ask of left) claims[ask.key] = ask.phrase;
  try {
    const raw = await deps.complete(
      [{ role: "user", content: evidencePrompt(claims, deps.messages) }],
      EVIDENCE_SYSTEM,
    );
    Object.assign(out, parseEvidence(raw, deps.messages));
  } catch {
    // An unanchored claim renders without a chip and hedged, which is the
    // designed fallback, not a failure state.
  }
  return out;
}
