import { noDashes } from "../ai/suggestions";
import { HOSTILE_CLAUSE, untrustedBlock, untrustedText } from "./untrusted";

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
  HOSTILE_CLAUSE,
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
  // UP-MIND-06 (2026-09-05): a sent message quotes what was sent to it, so
  // the body is still outside text. The index and date stay outside the
  // fence: parseSaid resolves the quote against the item at that index.
  const lines = items.map((m, i) => `[${i}] ${m.dateISO} · ${untrustedText(m.subject)}\n${untrustedBlock(m.body.slice(0, 900))}`);
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

// ASKING FROM ANYWHERE (UP-MIND-21, 2026-09-05).
//
// The fetch-and-parse lived inside MessagesFlow, so the one feature that
// answers "what did I tell Marco about the invoice" was reachable only from
// the Email tab's search box, and only if you thought to look for it there.
// It is a question, and questions go in the box people already ask in.
//
// This is that pass, unchanged in what it does and now callable from Chat
// too. It keeps every law above: it quotes HIM, verbatim or not at all, and
// no match is a real answer.
//
// The email handoff bans a chatbot panel INSIDE Email. This keeps Email
// panel-free: the Email tab still owns its own button, and the second caller
// is the app-wide Chat that A23 decided on, not a panel bolted into mail.

export interface SaidThread { id: string; subject: string; messages: { dateMs: number; body: string }[] }

export interface AskSaidDeps {
  /** One entry per connected mail account, already scoped by the caller. */
  search: (query: string, cap: number) => Promise<SaidThread[]>;
  complete: (messages: { role: string; content: string }[], system: string) => Promise<string>;
  /** The app's local-day function, handed in so this module needs no clock. */
  localDay: (d: Date) => string;
  /** Strips display plumbing out of a body, the same way the reader does. */
  clean: (body: string) => string;
  cap?: number;
}

/** The sentences the user actually wrote that answer the question, or an
 *  empty array, which is a real answer. Never throws. */
export async function askSaid(
  person: string,
  about: string,
  deps: AskSaidDeps,
): Promise<SaidHit[]> {
  const cap = deps.cap ?? 8;
  try {
    const threads = await deps.search(saidQuery(person, about), cap);
    const items = threads
      .map((full) => {
        const mine = full.messages[full.messages.length - 1];
        if (!mine) return null;
        return {
          subject: full.subject,
          // The INSTANT, read as a LOCAL calendar day: the same rule the tab
          // learned the hard way when an 8:40 PM message filed as tomorrow.
          dateISO: deps.localDay(mine.dateMs ? new Date(mine.dateMs) : new Date()),
          threadId: full.id,
          body: deps.clean(mine.body),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (items.length === 0) return [];
    const question = about.trim() || `what did I tell ${person.trim() || "them"}`;
    const raw = await deps.complete(
      [{ role: "user", content: saidPrompt(question, items.map((i) => ({ subject: i.subject, dateISO: i.dateISO, body: i.body }))) }],
      SAID_SYSTEM,
    );
    return parseSaid(raw, items);
  } catch {
    return [];
  }
}
