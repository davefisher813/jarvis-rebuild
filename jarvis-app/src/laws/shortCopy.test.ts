// LAW (Dave, 2026-08-15): the app never talks in long sentences. Lists and
// meta lines are FACTS: short fragments, joined with a middle dot, values on
// the right, actions as buttons. The enforceable core: no rendered string
// literal contains a sentence boundary (". " followed by a capital), which
// is what multi-sentence prose always has and fact fragments never do.
//
// Exemptions, each deliberate:
// - Legal pages (Privacy, Terms, Support, LegalScreen): legally prose.
// - Onboarding (steps.ts, OnboardingFlow.tsx): the one surface where JARVIS
//   talks conversationally, by design (pending Dave's word to fragment it).
// - AI prompt builders: model instructions, not UI.
// - Comment lines, tests, bench, spec harnesses.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

const EXEMPT_FILES = new Set([
  // Demo seed prose is simulated USER content for previews, not UI copy.
  "data/seedNotes.ts",
  "settings/PrivacyPage.tsx",
  "settings/TermsPage.tsx",
  "settings/SupportPage.tsx",
  "settings/LegalScreen.tsx",
  "onboarding/steps.ts",
  "onboarding/OnboardingFlow.tsx",
  // Prompt-heavy files: their sentences go to the model, not the screen.
  // Their few UI strings are individually short-copy compliant; the file
  // stays here because the scanner cannot tell a prompt from a label.
  "ai/voice.ts",
  "chat/chatPrompt.ts",
  "tasks/breakdown.ts",
  "ai/capture.ts",
  "ai/suggestions.ts",
  "ai/context.ts",
  "messages/triage.ts",
  "messages/deck.ts",
  "messages/waiting.ts",
  "messages/sentSweep.ts",
  "messages/cardDraft.ts",
  "messages/brief.ts",
  "messages/handoff.ts",
  "messages/commitments.ts",
  "messages/bodyText.ts",
  "people/messageDraft.ts",
  "people/lastContact.ts",
  "tasks/firstStep.ts",
  "gym/extract.ts",
  "schedule/planDayAI.ts",
  "schedule/scheduleExtract.ts",
  "brain/docs/BrainDocPage.tsx",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");

describe("law: no long sentences in the UI", () => {
  it("no rendered string literal carries a sentence boundary", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const r = rel(f);
      if (EXEMPT_FILES.has(r) || r.startsWith("bench/") || r.startsWith("testpanel/") || /Spec\.ts$|notesSpec|tasksSpec/.test(r)) continue;
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        // String literals on this line (double-quoted or template), with a
        // sentence boundary inside: ". " then a capital letter.
        for (const m of line.matchAll(/["`]((?:[^"`\\\n]|\\.)*?\. [A-Z](?:[^"`\\\n]|\\.)*?)["`]/g)) {
          // Abbreviation-shaped false positives stay legal: "e.g. Rent",
          // version-ish "v2. X" does not occur in copy.
          if (/\b(e\.g|i\.e|vs|etc)\. [A-Z]/.test(m[1]!)) continue;
          // Middle initials in names ("Joseph T. Pareres") are not sentences.
          if (/\b[A-Z]\. [A-Z]/.test(m[1]!)) continue;
          offenders.push(`${r}:${i + 1} :: ${m[1]!.slice(0, 70)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
