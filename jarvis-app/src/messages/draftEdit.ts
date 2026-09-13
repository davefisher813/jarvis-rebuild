// THE DRAFT, THE SENT TEXT, AND WHAT CHANGED (C-56, UP-MIND-25; Astra,
// 2026-09-12). On send from a JARVIS draft surface the draft the model
// produced is diffed against the text that went out, on device, and the
// edit is classified into a closed set. Only the kind ever leaves this
// function: bodies are never stored by it, never logged, never sent
// anywhere. Two identical kinds make a voice rule (LearnedRulesService,
// scope draft.edit); the rule's first use proposes a writing strand in
// Needs You, where That's Right accepts it.
//
// The kinds double as the event vocabulary on email.deck_sent (section 5),
// so every one of them fits the sink's kind gate: lowercase, underscores,
// at most 24 characters.
export type DraftEditKind =
  | "dropped_greeting"
  | "dropped_signoff"
  | "shortened_opening"
  | "removed_just"
  | "removed_kindly"
  | "removed_please_advise"
  | "shortened_overall"
  | "formal_to_casual"
  | "casual_to_formal";

export const DRAFT_EDIT_KINDS: DraftEditKind[] = [
  "dropped_greeting", "dropped_signoff", "shortened_opening", "removed_just", "removed_kindly",
  "removed_please_advise", "shortened_overall", "formal_to_casual", "casual_to_formal",
];

/** The writing strand each kind becomes when he confirms it. */
export const DRAFT_EDIT_SENTENCE: Record<DraftEditKind, string> = {
  dropped_greeting: "Drops formal greetings in email",
  dropped_signoff: "Drops the sign-off in email",
  shortened_opening: "Cuts the first paragraph in half",
  removed_just: "Never says just",
  removed_kindly: "Never says kindly",
  removed_please_advise: "Never says please advise",
  shortened_overall: "Writes shorter than the draft",
  formal_to_casual: "Writes more casually than the draft",
  casual_to_formal: "Writes more formally than the draft",
};

const GREETING = /^\s*(hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^\n]*\n/i;
const SIGNOFF = /\n\s*(best|best regards|regards|kind regards|warm regards|thanks|thank you|many thanks|cheers|sincerely|warmly|talk soon)[,.!]?\s*(\n[^\n]*)?\s*$/i;
const FORMAL = [/\bdear\b/i, /\bsincerely\b/i, /\bregards\b/i, /\bi would like to\b/i, /\bplease find\b/i, /\bkindly\b/i, /\bplease advise\b/i, /\bat your earliest convenience\b/i, /\bper our\b/i];
const CASUAL = [/^\s*hey\b/i, /^\s*hi\b/i, /\bthanks!/i, /\bcheers\b/i, /\btalk soon\b/i, /\bsounds good\b/i, /\bno worries\b/i, /\byep\b/i, /\bgonna\b/i];

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
// The opening is the first paragraph AFTER a greeting line, when there is
// one: "Hi Marco," is not the opening, it is the greeting.
const firstParagraph = (s: string) => norm(s).replace(GREETING, "").trim().split(/\n\s*\n/)[0] ?? "";
const score = (s: string, rxs: RegExp[]) => rxs.reduce((n, rx) => n + (rx.test(s) ? 1 : 0), 0);

export function classifyDraftEdit(draft: string, sent: string): DraftEditKind | null {
  const d = norm(draft); const s = norm(sent);
  if (!d || !s || d === s) return null;

  // The register first: a draft that went from Dear to Hey usually lost its
  // sign-off on the way, and the register is the bigger fact.
  const df = score(d, FORMAL) - score(d, CASUAL);
  const sf = score(s, FORMAL) - score(s, CASUAL);
  if (df - sf >= 2) return "formal_to_casual";
  if (sf - df >= 2) return "casual_to_formal";

  if (GREETING.test(d) && !GREETING.test(s)) return "dropped_greeting";
  if (SIGNOFF.test(d) && !SIGNOFF.test(s)) return "dropped_signoff";
  if (/\bplease advise\b/i.test(d) && !/\bplease advise\b/i.test(s)) return "removed_please_advise";
  if (/\bkindly\b/i.test(d) && !/\bkindly\b/i.test(s)) return "removed_kindly";
  if (/\bjust\b/i.test(d) && !/\bjust\b/i.test(s)) return "removed_just";

  // The opening alone, or the whole thing: an opening cut in half with the
  // rest left standing is the first; anything else that lost a third is the
  // second.
  const dp = firstParagraph(d).length; const sp = firstParagraph(s).length;
  const restD = d.length - dp; const restS = s.length - sp;
  if (dp > 40 && sp > 0 && sp <= dp * 0.6 && restD > 0 && restS >= restD * 0.8) return "shortened_opening";
  if (s.length <= d.length * 0.7) return "shortened_overall";
  return null;
}
