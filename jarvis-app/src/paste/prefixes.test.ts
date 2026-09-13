import { describe, it, expect } from "vitest";
import { readPrefix } from "./prefixes";

describe("readPrefix (C-49)", () => {
  it("Remember: a person plus a preference verb is a relationship in people", () => {
    expect(readPrefix("Remember Alberto hates Monday meetings")).toEqual({ kind: "remember", text: "Alberto hates Monday meetings", category: "people", type: "relationship" });
  });
  it("Remember: a time word without a name is routine, plain words are values, both facts", () => {
    expect(readPrefix("Remember: I do admin on Friday afternoons")).toEqual({ kind: "remember", text: "I do admin on Friday afternoons", category: "routine", type: "fact" });
    expect(readPrefix("remember the field gate code is on the clipboard")).toEqual({ kind: "remember", text: "the field gate code is on the clipboard", category: "values", type: "fact" });
  });
  it("Never and Always are rules: routine with a time word, values without", () => {
    expect(readPrefix("Never schedule workouts before noon")).toEqual({ kind: "rule", text: "Never schedule workouts before noon", category: "routine" });
    expect(readPrefix("Always pick Bridge over optional Jarvis work.")).toEqual({ kind: "rule", text: "Always pick Bridge over optional Jarvis work", category: "values" });
    expect(readPrefix("Never again?")).toBeNull();
  });
  it("Decision: and instead-of are decisions, the ruled-out option carried", () => {
    expect(readPrefix("Decision: fall clinics run Saturdays only")).toEqual({ kind: "decision", decision: "fall clinics run Saturdays only" });
    expect(readPrefix("Use Stripe instead of Clover.")).toEqual({ kind: "decision", decision: "Use Stripe instead of Clover", ruledOut: ["Clover"] });
    expect(readPrefix("Stripe instead of Clover?")).toBeNull();
  });
  it("refuses everything else, and anything that is not one line", () => {
    expect(readPrefix("dinner with Marco Thursday 7pm")).toBeNull();
    expect(readPrefix("Remember\nthis")).toBeNull();
    expect(readPrefix("")).toBeNull();
  });
});
