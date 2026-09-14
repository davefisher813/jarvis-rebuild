import type { AIService } from "../ai/AIService";
import type { Evidence } from "../gym/insights";
import { noDashes } from "../ai/suggestions";

// EXPLAIN, NEVER INVENT (Part 3 wave 3, 2026-09-13; Dave's answer 11a: the
// foundation for AI on Insights, only over verified facts). The model is
// handed the finding's evidence rows and nothing else, and told what it may
// not do: add a number, a cause, a confidence, or advice. The answer is two
// plain sentences at most. Deterministic calculations made the finding; this
// only puts it into words.
export const EXPLAIN_SYSTEM = [
  "You explain one finding from a person's own training log, in plain words, two sentences at most.",
  "Use only the rows you are given. Do not add a number, a percentage, a cause, a diagnosis, a confidence, or advice.",
  "Do not tell the person what to do. Say what the finding shows and what it does not.",
  "No em dashes.",
].join("\n");

export function evidenceText(ev: Evidence): string {
  return [
    `Kind: ${ev.label}`,
    `Range: ${ev.from} to ${ev.to}`,
    `Records: ${ev.records}`,
    `Method: ${ev.method}`,
    `Shows: ${ev.supports}`,
    `Does not show: ${ev.doesNot}`,
    ev.minimum ? `Minimum cleared: ${ev.minimum.name} ${ev.minimum.value} (${ev.minimum.reason})` : "",
  ].filter(Boolean).join("\n");
}

export async function explainEvidence(ai: AIService, ev: Evidence): Promise<string> {
  const out = await ai.complete([{ role: "user", content: evidenceText(ev) }], EXPLAIN_SYSTEM, { tier: "write", kind: "insight" });
  return noDashes(out.trim());
}
