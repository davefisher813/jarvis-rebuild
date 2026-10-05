// THE HUB'S ONE FACTS LINE (2026-10-05, the visual-catalog gate; RULEBOOK R1,
// R3, R5, R6, R8).
//
// Every Hub screen used to build a row's second line with `facts(a, b, c)`,
// which joined the parts with a middle dot and drew the whole string inside
// one .fact or .conn-meta: one grey run, the separator baked into the text,
// and a date, a count and a caveat all the same grey. That is the drift Dave
// photographed on the Email card. A line is a LIST of facts now, each its own
// span, and the stylesheet draws the dot between them.
//
//   - at most one fact is the line's grey (R1, R5). Everything else is a key
//     colour (good, warn, red, est), a neutral date in small caps (date), or
//     a white number (strong). The line enforces K.3 as `Facts` does: the
//     first colour keeps its colour and a later one is dropped to the grey,
//     which the tests below treat as a bug in the caller, never a feature.
//   - a line with nothing to say renders NOTHING, not a placeholder.
//   - `wrap` (the default) is a .conn-meta: every fact shows, nothing is
//     clipped, and the CSS draws the dots. The Hub's lines are receipts,
//     reviews and previews, whose job is to show every fact. `wrap={false}`
//     is the one-line .facts for a list row whose last fact is long free
//     text that may take the ellipsis.

import type { ReactNode } from "react";
import type { FactTone } from "../messages/factsLine";

/** `strong` is a number or measure with no state that must stand out: white (R3), drawn as a <b> the stylesheet already brightens. */
export interface HubFact { text: string; tone?: FactTone; strong?: boolean }
/** `""` is allowed so a caller can write `name && { text: name }` without a ternary. */
export type HubFactInput = HubFact | null | undefined | false | "";

/** The facts that would draw, empties dropped. Exported so a test (and a caller deciding whether to draw a row's line at all) reads the same list. */
export function liveFacts(facts: HubFactInput[]): HubFact[] {
  return facts.filter((f): f is HubFact => !!f && f.text.trim().length > 0);
}

export default function HubFacts({ facts, wrap = true }: { facts: HubFactInput[]; wrap?: boolean }): ReactNode {
  const list = liveFacts(facts);
  if (list.length === 0) return null;
  let toned = false;
  const spans = list.map((f, i) => {
    if (f.tone === "date") return <span key={i} className="fact date">{f.text}</span>;
    const tone = f.tone && !toned ? f.tone : undefined;
    if (tone) toned = true;
    return <span key={i} className={"fact" + (tone ? " " + tone : "")}>{f.strong ? <b>{f.text}</b> : f.text}</span>;
  });
  return <div className={wrap ? "conn-meta" : "facts"}>{spans}</div>;
}
