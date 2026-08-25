// Reading an email should not mean reading its plumbing.
//
// A marketing email's plain-text part is mostly tracking URLs, bracketed link
// duplicates, and runs of blank lines used as layout. None of that is content.
// This strips it for DISPLAY only: the original body is never modified, never
// re-sent, and the full text is always one tap away.

// Every scheme, not just http (Dave 2026-08-25, on a RushOrderTees blast).
// The old rule took https:// and left everything else, so his screen read
// "Call (267) 332-4101 ( tel:2673324101 )".
const URL_RE = /\b(?:https?|mailto|tel|sms|ftp|callto):[^\s<>)\]]+/gi;

// "<http://grammarly.com/>" and friends: a bare link wrapped in angle brackets,
// which is how plain-text parts smuggle every href in the HTML version.
const BRACKET_LINK_RE = /<\s*(?:https?|mailto|tel|sms):[^>]*>/gi;

// WHAT THE URL LEAVES BEHIND (Dave 2026-08-25). A plain-text part writes a
// link as `Premium Brands ( https://... )`. Removing the URL turned that into
// "Premium Brands ( )", and his screenshots were a column of them: "Nike ( )",
// "front ( )", "back ( )", "Unsubscribe ( )".
//
// The brackets go and the LABEL STAYS. Dropping the whole line would be
// tidier and would also delete "Call (267) 332-4101", which is the one piece
// of that footer worth having.
const EMPTY_BRACKETS = /[([<{]\s*[)\]>}]/g;

// The footer every bulk sender appends. None of it is the message.
const FOOTER_RE = new RegExp([
  "^(unsubscribe|manage (your )?preferences|view (this )?(email )?in browser)",
  "^(privacy policy|terms of service|terms and conditions)",
  "^(you (are )?receiv\\w+ this|this (message|email) was sent to)",
  "^(no longer interested)",
  "^(copyright )?\\u00A9 ?\\d{4}",
  "\\ball rights reserved\\b",
  "^add (us|our email) to your",
  "^sent (with|by|via) ",
].join("|"), "i");

// A US mailing address line, which bulk senders are legally obliged to
// include and which is never the point of the email. Conservative on purpose:
// it has to look like "1234 Something St, City, ST 19154" to match, so a
// sentence that happens to contain a number survives.
const ADDRESS_RE = /^\d+\s+[\w.'-]+(\s+[\w.'-]+){0,5},?\s+[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?$/;

// A LABEL WHOSE LINK IS GONE POINTS NOWHERE (Dave 2026-08-25). Stripping the
// URLs left his screen as a column of dead navigation: "Products", "front",
// "back", "Premium Brands", "RushOrderTees Logo". A website's menu, flattened
// into the middle of the message.
//
// Three conditions, all required, because the same shape carries real
// content:
//   - the line HELD a link, so it was chrome and not prose
//   - four words or fewer
//   - no digit and no sentence punctuation
// "Call (267) 332-4101" has digits and survives. "Free Shipping on All
// Orders!" has punctuation and was never a link. Nothing with a sentence in
// it can be caught by this.
const DEAD_LABEL = /^[\p{L}\p{M}'&.\s"-]{1,40}$/u;
function isDeadLabel(line: string, hadLink: boolean): boolean {
  if (!hadLink) return false;
  if (/[0-9]/.test(line)) return false;
  if (/[.!?:;]$/.test(line)) return false;
  if (line.split(/\s+/).length > 4) return false;
  return DEAD_LABEL.test(line);
}

export function cleanBody(raw: string): string {
  if (!raw) return "";
  const kept: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    // Per line, so the cleaner knows which lines HELD a link. Doing it across
    // the whole body loses that, and it is the fact that separates a website
    // menu from a sentence.
    BRACKET_LINK_RE.lastIndex = 0;
    URL_RE.lastIndex = 0;
    const hadLink = BRACKET_LINK_RE.test(rawLine) || URL_RE.test(rawLine);
    BRACKET_LINK_RE.lastIndex = 0;
    URL_RE.lastIndex = 0;
    const line = rawLine
      .replace(BRACKET_LINK_RE, " ")
      .replace(URL_RE, " ")
      .replace(EMPTY_BRACKETS, " ")
      .replace(/[ \t ]+/g, " ")
      .trim();
    if (!line) {
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (FOOTER_RE.test(line)) continue;
    if (ADDRESS_RE.test(line)) continue;
    if (isDeadLabel(line, hadLink)) continue;
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
