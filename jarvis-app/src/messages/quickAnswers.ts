import { noDashes } from "../ai/suggestions";

// THREE-WORD ANSWERS AS BUTTONS (U2, Dave 2026-08-20).
//
// Most replies are one of three things, and JARVIS already generates exactly
// that set for the Email tab (brief.ts). Putting them on the home card means
// the common case costs one tap and zero typing, which is the closest this
// app gets to an inbox that handles itself.
//
// Laws:
//   - A chip is a WHOLE reply, not a fragment to finish. "Yes" sends "Yes".
//   - Never more than three. A row of six choices is a decision, and removing
//     decisions is the entire point.
//   - The fallback set is generic and safe. A generated chip that is long,
//     empty, or a question back at him is dropped rather than shown.

export const DEFAULT_ANSWERS = ["Thanks", "Got it", "Will do"];
const MAX_WORDS = 6;
const MAX_CHIPS = 3;

export function quickAnswers(generated: string[] | undefined): string[] {
  const clean = (generated ?? [])
    .map((s) => noDashes(String(s || "").trim()))
    .map((s) => s.replace(/^["']|["']$/g, "").trim())
    .filter((s) => s.length > 0 && s.length <= 60)
    .filter((s) => s.split(/\s+/).length <= MAX_WORDS)
    // A chip that asks HIM something is not an answer he can send blind.
    .filter((s) => !s.endsWith("?") || s.split(/\s+/).length <= 4);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of clean) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= MAX_CHIPS) break;
  }
  return out.length > 0 ? out : DEFAULT_ANSWERS;
}
