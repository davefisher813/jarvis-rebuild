// What "Log It" prefills from a chat message (Brain, 2026-09-29).
//
// The sheet is a place to EDIT, so the prefill is the message as it was said
// and nothing cleverer. No model call, no summary, no paraphrase: a memory
// that reads differently from the words it came from is a memory nobody can
// trust.
//
// Dave's own message goes in byte for byte. JARVIS's message may carry the
// small stock lines a chat model wraps an answer in ("Sure!", "Let me know if
// you need anything else."). Those are not what anyone would file, so they
// come off, but ONLY when a whole line matches this allowlist exactly, and
// ONLY at the very start or very end of the message. A sentence that merely
// begins the same way is left alone, and so is anything in the middle. The
// list is short on purpose and every entry is pinned by a test: growing it is
// a decision, not a tweak.

export type ChatFilingRole = "user" | "jarvis" | "assistant";

// Compared after trimming, lower-casing, folding curly apostrophes, collapsing
// spaces and dropping trailing sentence marks, so "Sure!" and "sure." are one.
const LEADING_BOILERPLATE: readonly string[] = [
  "sure",
  "sure thing",
  "certainly",
  "of course",
  "absolutely",
  "great question",
  "here you go",
  "here's what i found",
  "here is what i found",
];

const TRAILING_BOILERPLATE: readonly string[] = [
  "let me know if you need anything else",
  "let me know if you have any questions",
  "let me know if you have any other questions",
  "let me know if there's anything else you need",
  "hope that helps",
  "is there anything else i can help with",
  "is there anything else i can help you with",
];

/** The allowlists, exported so the test pins every entry. */
export const CHAT_BOILERPLATE = { leading: LEADING_BOILERPLATE, trailing: TRAILING_BOILERPLATE } as const;

function fold(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.!:]+$/, "");
}

export function chatFilingText(role: ChatFilingRole, text: string): string {
  if (role === "user") return text;
  const lines = text.split("\n");
  let start = 0;
  let end = lines.length - 1;
  // Blank lines at an edge do not count as content, so boilerplate behind
  // them is still at the edge.
  const skipBlankFront = () => { while (start <= end && lines[start]!.trim() === "") start++; };
  const skipBlankBack = () => { while (end >= start && lines[end]!.trim() === "") end--; };
  let stripped = false;
  skipBlankFront();
  while (start <= end && LEADING_BOILERPLATE.includes(fold(lines[start]!))) {
    start++;
    stripped = true;
    skipBlankFront();
  }
  skipBlankBack();
  while (end >= start && TRAILING_BOILERPLATE.includes(fold(lines[end]!))) {
    end--;
    stripped = true;
    skipBlankBack();
  }
  if (!stripped) return text;
  const out = lines.slice(start, end + 1).join("\n");
  // Cleanup that empties the message is not cleanup: use what was said.
  return out.trim() === "" ? text : out;
}
