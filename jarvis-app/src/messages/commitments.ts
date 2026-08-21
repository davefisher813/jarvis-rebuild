// Commitment catcher.
//
// The thing that actually gets dropped is not the email someone sent you. It
// is the thing YOU said you would do, in a reply, at 11pm, and never wrote
// down. This reads the user's own outgoing words and turns a promise into a
// task with the date they themselves named.
//
// Laws:
//   - Only the user's OWN words. Never a promise someone made to them.
//   - One task per thread, ever. Marked before the task is created.
//   - No shame copy. The task is the promise, phrased as the promise.

import { noDashes } from "../ai/suggestions";

const KEY = "jarvis.mail.promised.v1";
const CAP = 300;

export interface Commitment {
  text: string;   // the task title, in the user's own terms
  due?: string;   // YYYY-MM-DD when they named a day
}

export function loadPromised(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function markPromised(threadId: string): void {
  const all = loadPromised();
  if (all.includes(threadId)) return;
  try { localStorage.setItem(KEY, JSON.stringify([...all, threadId].slice(-CAP))); } catch { /* private mode */ }
}

export function alreadyPromised(threadId: string): boolean {
  return loadPromised().includes(threadId);
}

export const COMMITMENT_SYSTEM =
  "You read one message the USER wrote and find any commitment they made: something they " +
  "said THEY would do. Only their own promises, never someone else's. " +
  'Reply with ONLY JSON: {"text":"...","due":"YYYY-MM-DD"} or {"text":""} when they promised nothing. ' +
  "text is an action starting with a verb, under 60 characters, in their own terms " +
  '("Send the coach the roster"). Include "due" ONLY if they named a day; never guess one.';

export function commitmentPrompt(body: string, todayISO: string): string {
  return "Today is " + todayISO + ".\nThe user wrote:\n" + body.slice(0, 1500);
}

// Tolerant parse. Anything malformed, empty, or dateless-but-claiming-a-date
// yields null: a wrong task is worse than no task.
export function parseCommitment(raw: string, todayISO: string): Commitment | null {
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
  const { text, due } = o as { text?: unknown; due?: unknown };
  if (typeof text !== "string") return null;
  const t = noDashes(text.trim()).slice(0, 60);
  if (!t) return null;
  const out: Commitment = { text: t };
  if (typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due.trim())) {
    // A date in the past is a misread, not a deadline.
    if (due.trim() >= todayISO) out.due = due.trim();
  }
  return out;
}

// The receipt. States the promise, names the day, and stops.
export function commitmentLine(c: Commitment): string {
  return c.due ? "Caught: " + c.text + " · by " + c.due : "Caught: " + c.text;
}
