// What "File It" prefills from an email thread (Brain, 2026-09-29).
//
// The subject, a blank line, then a short plain-text preview. Nothing is
// summarised or rewritten and nothing calls a model: the preview is words that
// are already on the phone.
//
// WHERE THE PREVIEW COMES FROM, in order:
//   1. the fetched latest message's own Gmail snippet (the thread is open, so
//      this is the current one),
//   2. the list row's cached snippet (what the inbox showed a moment ago),
//   3. plain text derived from that message's body. mapGmailFull already
//      strips HTML from `body`, and it is run through cleanBody here too, so
//      link plumbing and footers do not land in a memory.
// Gmail snippets arrive with HTML entities in them ("Don&#39;t"), so they are
// decoded the way every header is (connections/google/decode.ts). No raw HTML
// can reach the sheet: a value that still looks like markup after that is not
// used and the next source is tried.

import { decodeEntities } from "../connections/google/decode";
import { cleanBody } from "./bodyText";

/** A derived body preview is cut at a word boundary so the sheet opens on a
 *  glance and not on a wall. Snippets are short already and are not cut. */
export const EMAIL_PREVIEW_CHARS = 500;

const LOOKS_MARKUP = /<\/?[a-z][^>]*>/i;

function plain(raw: string | undefined | null, keepBreaks = false): string {
  const t = decodeEntities(keepBreaks ? (raw ?? "") : (raw ?? "").replace(/\s+/g, " ")).trim();
  return t && !LOOKS_MARKUP.test(t) ? t : "";
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const at = head.lastIndexOf(" ");
  return (at > max * 0.6 ? head.slice(0, at) : head).trimEnd() + "…";
}

export function emailFilingPreview(opts: {
  lastSnippet?: string | null;
  rowSnippet?: string | null;
  lastBody?: string | null;
}): string {
  const fromSnippet = plain(opts.lastSnippet) || plain(opts.rowSnippet);
  if (fromSnippet) return fromSnippet;
  return cut(plain(cleanBody(opts.lastBody ?? ""), true), EMAIL_PREVIEW_CHARS);
}

/** subject + "\n\n" + preview; the subject alone when there is no preview.
 *  The "(no subject)" the screen shows for a blank one is a placeholder, not
 *  words worth filing, so it is left out. */
export function emailFilingText(subject: string, preview: string): string {
  const s = subject.trim() === "(no subject)" ? "" : subject.trim();
  const p = preview.trim();
  return s && p ? s + "\n\n" + p : s || p;
}
