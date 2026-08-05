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
type Cache = Record<string, Brief>;

export const BRIEF_SYSTEM =
  "You output only a JSON object, nothing else.";

export function briefPrompt(convo: string): string {
  return (
    "Read this email conversation.\n\n" +
    'Reply with ONLY: {"summary":"...","replies":["...","...","..."]}\n\n' +
    "summary: one or two sentences. If something is being asked of the reader, lead with that.\n" +
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
  const s = typeof summary === "string" ? noDashes(summary.trim()) : "";
  const r = Array.isArray(replies)
    ? replies.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => noDashes(x.trim())).slice(0, 3)
    : [];
  if (!s && r.length === 0) return null;
  return { summary: s, replies: r };
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
