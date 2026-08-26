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
// One chip may be a short sentence; a chip past this is a paragraph in a
// pill (Dave's screenshot 2026-08-26: three long chips stacked three lines
// tall on the Custom Ink card).
const MAX_CHARS = 28;
// And the ROW has a budget: chips render side by side on a 390px phone, so
// the set must fit one line. Chips are kept in order until the budget is
// spent; the first surviving chip always stays. Fewer chips beat a taller
// card, and the fallback set is only for when the AI offered nothing usable.
const ROW_BUDGET = 36;

export function quickAnswers(generated: string[] | undefined): string[] {
  const clean = (generated ?? [])
    .map((s) => noDashes(String(s || "").trim()))
    .map((s) => s.replace(/^["']|["']$/g, "").trim())
    .filter((s) => s.length > 0 && s.length <= MAX_CHARS)
    .filter((s) => s.split(/\s+/).length <= MAX_WORDS)
    // A chip that asks HIM something is not an answer he can send blind.
    .filter((s) => !s.endsWith("?") || s.split(/\s+/).length <= 4);
  const seen = new Set<string>();
  const out: string[] = [];
  let spent = 0;
  for (const s of clean) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    if (out.length > 0 && spent + s.length > ROW_BUDGET) continue;
    seen.add(k);
    out.push(s);
    spent += s.length;
    if (out.length >= MAX_CHIPS) break;
  }
  return out.length > 0 ? out : DEFAULT_ANSWERS;
}
