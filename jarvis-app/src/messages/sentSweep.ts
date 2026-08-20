import { noDashes } from "../ai/suggestions";

// THE PROMISE SWEEP (E5, Dave 2026-08-20: "add every single email feature").
//
// The thing that actually gets dropped is not the email someone sent you. It
// is the thing YOU said you would do, in a reply, at 11pm, and never wrote
// down. The commitment catcher already handles this at the moment of SENDING.
// This is the other half: the promises he made BEFORE the app existed, or on
// his phone, or in the Gmail web client, that nothing ever caught.
//
// One pass over recent sent mail, cheap and capped. What it finds is a
// PROPOSAL: it becomes a home-page notice with an Add Task button, never a
// task that silently appeared.
//
// Laws:
//   - Only the user's OWN words. A promise someone made TO him is not his.
//   - Only a thread the catcher has not already handled (alreadyPromised).
//   - Nothing is invented: an unreadable reply means no promises, not a
//     guessed one, and a date only exists when he named a day himself.
//   - Cached against the newest sent message id, so a re-open costs nothing.

export interface SentItem {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  msgId: string;
}

export interface SweptPromise {
  threadId: string;
  text: string;
  due?: string;
}

export const SWEEP_SYSTEM = [
  "You read messages a person SENT and find the commitments they made to someone else.",
  "A commitment is something the sender promised to DO: send a file, call, pay, book, review, follow up.",
  "Ignore pleasantries, opinions, questions, and anything the OTHER person promised.",
  "Ignore anything already clearly finished in the same message.",
  "Reply with ONLY a JSON array. Each item: {\"i\": <index of the message>, \"text\": \"<the promise as a short task, Title Case, max 8 words>\", \"due\": \"YYYY-MM-DD\" or null}.",
  "Use a due date ONLY when the sender named a day. Never invent one.",
  "An empty array is a correct answer. Never guess.",
].join("\n");

const MAX_BODY = 700;

export function sweepPrompt(items: SentItem[], todayISO: string): string {
  const lines = items.map((it, i) =>
    `[${i}] to: ${it.to} | subject: ${it.subject}\n${it.body.slice(0, MAX_BODY)}`);
  return `Today is ${todayISO}.\n\n` + lines.join("\n\n---\n\n");
}

// Tolerant but never inventive: an index we did not send, an empty text, or a
// malformed date drops that item rather than producing a wrong task.
export function parseSweep(raw: string, items: SentItem[]): SweptPromise[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let arr: unknown;
  try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: SweptPromise[] = [];
  const seen = new Set<string>();
  for (const row of arr) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as { i?: unknown; text?: unknown; due?: unknown };
    const i = typeof r.i === "number" ? r.i : parseInt(String(r.i ?? ""), 10);
    const item = items[i];
    if (!item) continue;
    const text = noDashes(String(r.text ?? "").trim());
    if (!text || text.length > 90) continue;
    if (seen.has(item.threadId)) continue; // one promise per thread, ever
    seen.add(item.threadId);
    const due = typeof r.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.due) ? r.due : undefined;
    out.push({ threadId: item.threadId, text, due });
  }
  return out;
}

// --- Cache. Keyed by the newest sent message id we have swept, so the pass
// runs once per new outgoing message rather than once per app open.
const KEY = "jarvis.mail.sweep.v1";

interface SweepCache { head: string; promises: SweptPromise[] }

export function loadSweep(storage: Pick<Storage, "getItem"> = localStorage): SweepCache {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "null") as Partial<SweepCache> | null;
    if (!p || typeof p.head !== "string" || !Array.isArray(p.promises)) return { head: "", promises: [] };
    return { head: p.head, promises: p.promises };
  } catch {
    return { head: "", promises: [] };
  }
}

export function saveSweep(cache: SweepCache, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode */ }
}

// True when there is new outgoing mail since the last sweep. The head is the
// newest sent message id; nothing new means no AI call at all.
export function needsSweep(head: string, cache = loadSweep()): boolean {
  return !!head && head !== cache.head;
}

// A promise the user has since acted on drops out on its own: the caller
// passes the threads the commitment catcher already handled.
export function liveSweep(cache: SweepCache, handled: string[]): SweptPromise[] {
  const done = new Set(handled);
  return cache.promises.filter((p) => !done.has(p.threadId));
}
