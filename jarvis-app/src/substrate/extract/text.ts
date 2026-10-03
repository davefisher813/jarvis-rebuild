// THE TEXT THE RULES READ (IMPLEMENTATION-SPEC.md 10.1 step 2). One string per
// message: the subject, a blank line, the body with quoted history and the
// signature taken out, so a rule never reads an older message as if it were
// this one. Offsets every rule records point into THIS string, and the first
// two thousand characters of it are the evidence excerpt the receipt keeps.
// Nothing is fetched, decoded or guessed here; the HTML was already turned
// into text by the reader, and the message view keeps everything this drops.

export const EXCERPT_MAX = 2000;

const QUOTE_HEAD = /^(On .{3,160}? wrote:\s*|-{2,}\s*(Original|Forwarded) Message\s*-{0,}\s*|From:\s.+\n(Sent|Date):\s.+|_{10,}\s*|Begin forwarded message:\s*)$/im;
const SIGNATURE = /^(--\s*|__+\s*|Sent from my .*|Get Outlook for .*|Sent via .*|Thanks,?\s*|Thank you,?\s*|Best,?\s*|Best regards,?\s*|Regards,?\s*|Cheers,?\s*)$/im;

/** The body without quoted history: everything from the first quote header or the first quoted line on is cut. */
export function dropQuoted(body: string): string {
  const unix = body.replace(/\r\n?/g, "\n");
  const head = QUOTE_HEAD.exec(unix);
  let cut = head ? unix.slice(0, head.index) : unix;
  const firstQuoted = /^\s*>/m.exec(cut);
  if (firstQuoted) cut = cut.slice(0, firstQuoted.index);
  return cut;
}

/** The body without its signature: the sign-off line and everything after it. */
export function dropSignature(body: string): string {
  const m = SIGNATURE.exec(body);
  if (!m) return body;
  // A sign-off in the first line is the whole mail; keep it.
  if (m.index === 0) return body;
  return body.slice(0, m.index);
}

/** The one string the rules read. */
export function sourceText(subject: string, body: string): string {
  const clean = dropSignature(dropQuoted(body ?? ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const subj = (subject ?? "").replace(/\s+/g, " ").trim();
  if (!subj) return clean;
  return clean ? `${subj}\n\n${clean}` : subj;
}

/** The evidence excerpt a receipt keeps: the start of the text, bounded. */
export function excerptOf(text: string): string {
  return text.length <= EXCERPT_MAX ? text : text.slice(0, EXCERPT_MAX);
}

/** Sentences, with their offsets, so a rule can keep a date to the sentence that said it. */
export interface Sentence { text: string; start: number; end: number }

export function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?\n]+(?:[.!?]+|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (!body) continue;
    out.push({ text: body, start: m.index + lead, end: m.index + lead + body.length });
  }
  return out;
}

/** The nearest window of text before an offset, for "the amount after the words Amount due". */
export function before(text: string, at: number, chars: number): string {
  return text.slice(Math.max(0, at - chars), at);
}

/** Capitalised words of a name or a phrase, without shouting. */
export function tidy(phrase: string): string {
  return phrase.replace(/\s+/g, " ").replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, "").trim();
}
