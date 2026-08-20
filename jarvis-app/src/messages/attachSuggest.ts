// THE ATTACHMENT YOU MEANT TO SEND (N15, Dave 2026-08-20).
//
// They asked for the waiver. He has a waiver. Every mail client on earth
// waits until he hits send, notices the word "attached", and asks if he
// forgot; none of them offers the file he actually has.
//
// Laws:
//   - It only offers something he ALREADY has, by name. It never generates,
//     never guesses at a file it has not seen, and never attaches anything on
//     its own.
//   - It reads the message being REPLIED TO for the ask, and his own draft
//     for whether he has already promised it. Both are needed: "send me the
//     waiver" plus "here it is" with nothing attached is the actual failure.
//   - Silence is the common case. A prompt on every compose is noise.

export interface Candidate {
  id: string;
  name: string;   // what the user calls it
  kind: string;   // "note", "file"
}

const ASK = /\b(send|share|forward|attach|email)\s+(me\s+)?(the|a|your|that)?\s*([a-z][\w '-]{2,40}?)\b/gi;
const PROMISE = /\b(attached|here'?s|here is|enclosed|sending|i'?ve attached)\b/i;

// What they asked for, in their words. Lowercased, deduped, short.
export function asksIn(text: string): string[] {
  ASK.lastIndex = 0;
  const out: string[] = [];
  for (const m of (text || "").matchAll(ASK)) {
    const thing = (m[4] ?? "").trim().toLowerCase();
    if (!thing || thing.length < 3) continue;
    if (/^(you|it|this|that|one|them|us|me|know|over|back|along)$/.test(thing)) continue;
    if (!out.includes(thing)) out.push(thing);
    if (out.length >= 4) break;
  }
  return out;
}

export function promisedAttachment(draftBody: string): boolean {
  return PROMISE.test(draftBody || "");
}

export interface AttachSuggestion {
  candidate: Candidate;
  asked: string;
}

// Match the ask to something he owns. Whole-word containment both ways, so
// "waiver" finds "Tucci Waiver 2026" and "Tucci Waiver 2026" is found by
// "waiver", but "invoice" never matches "voice memo".
export function suggestAttachment(
  incomingBody: string,
  draftBody: string,
  candidates: Candidate[],
): AttachSuggestion | null {
  if (candidates.length === 0) return null;
  const asks = asksIn(incomingBody);
  if (asks.length === 0) return null;
  // Only when he has NOT already attached something, and only when the reply
  // reads like it is meant to carry a file.
  if (!promisedAttachment(draftBody)) return null;

  for (const ask of asks) {
    const words = ask.split(/\s+/).filter((w) => w.length >= 4);
    if (words.length === 0) continue;
    const hit = candidates.find((c) => {
      const name = c.name.toLowerCase();
      return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(name));
    });
    if (hit) return { candidate: hit, asked: ask };
  }
  return null;
}

export function suggestLine(s: AttachSuggestion): string {
  return `They asked for the ${s.asked}. You have "${s.candidate.name}".`;
}
