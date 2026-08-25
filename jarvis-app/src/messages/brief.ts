// Opening a thread used to fire TWO sequential AI calls: one for the summary,
// one for the quick replies. Same conversation sent twice, one after the
// other, every single time, cached never. Twenty emails opened was forty
// requests and two waits per open.
//
// One call now returns both, and the answer is cached against the thread's
// latest message id, so reopening a thread costs nothing until someone
// actually writes again.

import { noDashes } from "../ai/suggestions";

export interface Brief {
  summary: string;
  replies: string[];
}

const KEY = "jarvis.mail.brief.v1";
const CAP = 100;
const REPLY_MAX = 6; // words
// A WALL BEHIND THE INSTRUCTION (2026-08-25). The prompt asks for 15 words
// and a model that ignores it must still not be able to produce a paragraph.
// Cut on a word boundary with an ellipsis, never mid-word: the one truncation
// in this repo that was already done right is bodyText's leadIn, and this
// follows it.
const SUMMARY_MAX = 120;
type Cache = Record<string, Brief>;

export const BRIEF_SYSTEM =
  "You output only a JSON object, nothing else.";

export function briefPrompt(convo: string): string {
  return (
    "Read this email conversation.\n\n" +
    'Reply with ONLY: {"summary":"...","replies":["...","...","..."]}\n\n' +
    // THE SAME DISEASE AS THE PREVIEWS (Dave 2026-08-25: "The subtext on
    // email previews feels a little lengthy. It should be right to the
    // point"). This asked for "one or two sentences" and got 26 words that
    // named the sender already in the header, restated the subject already
    // above it, and referred to Dave in the third person.
    "summary: ONE line, at most 15 words. The reader can already see who it is from and what the subject is, so never repeat those, and never write the reader's name or \"the user\". Lead with what is being asked, or with the fact that matters. Keep dates, times, amounts and names of other people.\n" +
    "Good: \"Video appt Wed Sept 23, 1 PM ET, link to join\" / \"Wants the waiver signed before Friday\"\n" +
    "Bad: \"This is an automated reminder that Dave has a video appointment with Resolve Psychiatric Services at 1:00 pm ET on Wednesday, September 23rd\"\n" +
    "replies: three short reply options the reader could send, each under " + REPLY_MAX + " words, " +
    "in a plain human voice. No greetings, no signatures.\n\n" +
    convo
  );
}

// Tolerant: a missing or malformed half never poisons the other half.
export function parseBrief(raw: string): Brief | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null) return null;
  const { summary, replies } = o as { summary?: unknown; replies?: unknown };
  const s = typeof summary === "string" ? clip(noDashes(summary.trim()), SUMMARY_MAX) : "";
  const r = Array.isArray(replies)
    ? replies.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => noDashes(x.trim())).slice(0, 3)
    : [];
  if (!s && r.length === 0) return null;
  return { summary: s, replies: r };
}

// Cut at a word boundary, with the ellipsis that says it happened.
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const back = cut.replace(/\s+\S*$/, "");
  return (back.length > max * 0.6 ? back : cut).replace(/[.,;:\s]+$/, "") + "\u2026";
}

export function loadBriefs(): Cache {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as unknown;
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Cache) : {};
  } catch {
    return {};
  }
}

// Keyed by the thread's LATEST message id: a new reply invalidates it, which
// is exactly when the summary stops being true.
export function briefFor(lastMsgId: string, cache: Cache = loadBriefs()): Brief | null {
  const hit = cache[lastMsgId];
  return hit && typeof hit.summary === "string" ? hit : null;
}

export function saveBrief(lastMsgId: string, brief: Brief): void {
  const cache = loadBriefs();
  cache[lastMsgId] = brief;
  const keys = Object.keys(cache);
  const trimmed: Cache = {};
  for (const k of keys.slice(-CAP)) trimmed[k] = cache[k]!;
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* private mode */ }
}
