// Reading an email should not mean reading its plumbing.
//
// A marketing email's plain-text part is mostly tracking URLs, bracketed link
// duplicates, and runs of blank lines used as layout. None of that is content.
// This strips it for DISPLAY only: the original body is never modified, never
// re-sent, and the full text is always one tap away.

const URL_RE = /https?:\/\/[^\s<>]+/gi;

// "<http://grammarly.com/>" and friends: a bare link wrapped in angle brackets,
// which is how plain-text parts smuggle every href in the HTML version.
const BRACKET_LINK_RE = /<\s*https?:\/\/[^>]*>/gi;

const UNSUB_RE = /^(unsubscribe|manage (your )?preferences|view (this )?(email )?in browser|privacy policy|terms of service|you (are )?receiv\w+ this)/i;

export function cleanBody(raw: string): string {
  if (!raw) return "";
  let t = raw.replace(BRACKET_LINK_RE, " ").replace(URL_RE, " ");
  t = t.replace(/[ \t ]+/g, " ");
  const lines = t.split(/\r?\n/).map((l) => l.trim());
  const kept: string[] = [];
  for (const line of lines) {
    if (!line) {
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (UNSUB_RE.test(line)) continue;
    // A line that was nothing but links is now punctuation confetti.
    if (!/[a-z0-9]/i.test(line)) continue;
    kept.push(line);
  }
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return kept.join("\n");
}

export function wordCount(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

// Long enough that dropping it on screen whole is a wall. Deliberately
// generous: short mail should never be folded, that would just add a tap.
export const LONG_WORDS = 120;

export function isLong(body: string): boolean {
  return wordCount(body) > LONG_WORDS;
}

// The opening of a long body, for when there is no AI summary to show. Whole
// sentences only: a snippet cut mid-word reads as breakage.
export function leadIn(body: string, maxChars = 260): string {
  const t = cleanBody(body).replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (stop > 80 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "")) + "…";
}
