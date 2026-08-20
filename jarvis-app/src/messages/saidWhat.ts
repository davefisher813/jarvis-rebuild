import { noDashes } from "../ai/suggestions";

// WHAT DID I TELL THEM? (N11, Dave 2026-08-20).
//
// Before a call, the question is never "show me the thread". It is "what did
// I say I'd do about the invoice". The thread is the raw material; the
// sentence he wrote is the answer.
//
// Laws:
//   - It quotes HIM. Every answer is a line he actually wrote, with the date
//     he wrote it, and the model is told to quote rather than summarise. A
//     paraphrase of a commitment is how you walk into a call wrong.
//   - No match is a real answer. "You didn't say anything about that" is
//     useful; a confident invention is a disaster.
//   - Search is server-side over sent mail, so it covers everything, not just
//     what happens to be cached.

export interface SaidHit {
  quote: string;
  dateISO: string;
  subject: string;
  threadId: string;
}

export const SAID_SYSTEM = [
  "You are given messages the user SENT and a question about what they said.",
  "Find the sentences the user actually wrote that answer the question.",
  "QUOTE them verbatim. Never paraphrase, never summarise, never combine two sentences into one.",
  "Reply with ONLY a JSON array. Each item: {\"i\": <index of the message>, \"quote\": \"<verbatim sentence>\"}.",
  "If nothing they wrote answers the question, reply with an empty array. An empty array is a correct answer.",
].join("\n");

export function saidQuery(person: string, about: string): string {
  const who = person.trim() ? ` to:${person.trim()}` : "";
  const what = about.trim() ? " " + about.trim() : "";
  return `in:sent${who}${what}`.trim();
}

export function saidPrompt(
  question: string,
  items: { subject: string; dateISO: string; body: string }[],
): string {
  const lines = items.map((m, i) => `[${i}] ${m.dateISO} · ${m.subject}\n${m.body.slice(0, 900)}`);
  return `Question: ${question}\n\n` + lines.join("\n\n---\n\n");
}

export function parseSaid(
  raw: string,
  items: { subject: string; dateISO: string; threadId: string; body: string }[],
): SaidHit[] {
  const a = raw.indexOf("[");
  const b = raw.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  let arr: unknown;
  try { arr = JSON.parse(raw.slice(a, b + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: SaidHit[] = [];
  for (const row of arr) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as { i?: unknown; quote?: unknown };
    const i = typeof r.i === "number" ? r.i : parseInt(String(r.i ?? ""), 10);
    const item = items[i];
    if (!item) continue;
    const quote = noDashes(String(r.quote ?? "").trim());
    if (!quote || quote.length > 400) continue;
    // The quote has to actually BE in what he wrote. A model that drifts one
    // word has invented a commitment, and this is the check that catches it.
    const hay = item.body.replace(/\s+/g, " ").toLowerCase();
    if (!hay.includes(quote.replace(/\s+/g, " ").toLowerCase().slice(0, 60))) continue;
    out.push({ quote, dateISO: item.dateISO, subject: item.subject, threadId: item.threadId });
    if (out.length >= 4) break;
  }
  return out;
}

export function saidEmpty(person: string): string {
  return person.trim() ? `Nothing you wrote to ${person.trim()} covers that` : "Nothing you wrote covers that";
}
