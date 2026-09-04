import { describe, it, expect } from "vitest";
import { seedQuestions, factsFrom } from "./seeds";
import type { TemplateKey } from "../categories/defaults";

// ONBOARDING SEEDS (handoff item 4, decision x4, option A). The thing worth
// pinning here is not that the arrays exist, it is the two refusals: an escape
// answer writes no fact, and a seed is never told-rank.

const TEMPLATES: TemplateKey[] = ["personal", "business", "student"];

describe("the questions themselves", () => {
  it("gives every template exactly five, the item's own budget", () => {
    for (const t of TEMPLATES) expect(seedQuestions(t)).toHaveLength(5);
  });

  it("asks each template something different", () => {
    // A generic set would produce generic facts. "What eats your week" is not
    // a question you ask a sixteen-year-old with practice at four.
    const ids = TEMPLATES.map((t) => seedQuestions(t).map((q) => q.id).join("|"));
    expect(new Set(ids).size).toBe(3);
  });

  it("never asks the same question twice inside one template", () => {
    for (const t of TEMPLATES) {
      const qs = seedQuestions(t);
      expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    }
  });

  it("offers at least three ways to answer, so no question is a single door", () => {
    for (const t of TEMPLATES) for (const q of seedQuestions(t)) expect(q.options.length).toBeGreaterThanOrEqual(3);
  });

  it("writes facts in the user's voice, never about the app or the intake", () => {
    for (const t of TEMPLATES) {
      for (const q of seedQuestions(t)) {
        for (const o of q.options) {
          if (!o.text) continue;
          expect(o.text.toLowerCase()).not.toContain("jarvis");
          expect(o.text.toLowerCase()).not.toContain("you ");
          expect(o.text[0]).toBe(o.text[0]!.toUpperCase());
        }
      }
    }
  });
});

describe("what the answers write", () => {
  it("writes nothing at all when nothing was tapped", () => {
    for (const t of TEMPLATES) expect(factsFrom(t, {})).toEqual([]);
  });

  it("writes one fact per answered question, with its category", () => {
    const qs = seedQuestions("student");
    const picked = { [qs[0]!.id]: 2, [qs[3]!.id]: 0 };
    const out = factsFrom("student", picked);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe(qs[0]!.options[2]!.text);
    expect(out[0]!.category).toBe(qs[0]!.category);
    expect(out[1]!.category).toBe(qs[3]!.category);
  });

  it("an escape answer is an answer and is not a fact", () => {
    // "Nothing yet" means the question was read and answered honestly.
    // Turning it into "nothing is non-negotiable for me" would put a sentence
    // in the Brain the user never agreed to.
    const q = seedQuestions("personal").find((x) => x.options.some((o) => o.text === ""))!;
    const i = q.options.findIndex((o) => o.text === "");
    expect(factsFrom("personal", { [q.id]: i })).toEqual([]);
  });

  it("ignores an index that is not on the question", () => {
    const q = seedQuestions("business")[0]!;
    expect(factsFrom("business", { [q.id]: 99 })).toEqual([]);
    expect(factsFrom("business", { "not-a-question": 0 })).toEqual([]);
  });
});
