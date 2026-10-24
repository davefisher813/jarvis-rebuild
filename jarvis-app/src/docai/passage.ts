import { findQuote } from "./verify";
import type { DocText } from "./types";

// "TAP A FIELD, SEE THE PASSAGE" (build order, Phase 1 acceptance 1). The words around a quote, with the quote itself marked, so every value
// can be checked against the sentence it came from. Pure: the screen only draws what this returns.

export interface Passage {
  before: string;
  mark: string;
  after: string;
  /** True when the passage is cut at the start or the end, so the screen can show it. */
  cutBefore: boolean;
  cutAfter: boolean;
  /** The page the quote sits on, from the document (never the model's word). */
  page: number | null;
  /** False when the quote could not be found in the text (an edited value, a value Dave typed): only the quote is shown. */
  located: boolean;
}

const CONTEXT = 160;

export function passageFor(doc: DocText, quote: string, offsets: { start: number; end: number } | null): Passage {
  const at = offsets ?? findQuote(doc.text, quote);
  if (!at) return { before: "", mark: quote, after: "", cutBefore: false, cutAfter: false, page: null, located: false };
  const from = Math.max(0, at.start - CONTEXT);
  const to = Math.min(doc.text.length, at.end + CONTEXT);
  const tidy = (s: string) => s.replace(/\f/g, "\n").replace(/\n{3,}/g, "\n\n");
  const page = doc.pages.find((p) => at.start >= p.start && at.start <= p.end)?.page ?? null;
  return {
    before: tidy(doc.text.slice(from, at.start)),
    mark: doc.text.slice(at.start, at.end),
    after: tidy(doc.text.slice(at.end, to)),
    cutBefore: from > 0, cutAfter: to < doc.text.length, page, located: true,
  };
}
