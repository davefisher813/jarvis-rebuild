import { describe, it, expect } from "vitest";
import { aliasTrigger } from "./triggers";

// Record-only mode exists so Dave can see whether the rules WOULD have been
// any good before letting them act. That makes this heuristic the thing
// actually on trial, so its refusals matter as much as its hits.

describe("aliasTrigger", () => {
  it("keys on the proper noun, which is what decides the category", () => {
    expect(aliasTrigger("Elite Squad practice on Tuesday")).toBe("Elite Squad");
  });

  it("takes the longest name, not the first capitalised thing it sees", () => {
    expect(aliasTrigger("Call Elite Squad about Tuesday")).toBe("Elite Squad");
  });

  it("finds a name in the middle of a lowercase sentence", () => {
    expect(aliasTrigger("send the invoice to Northline Partners")).toBe("Northline Partners");
  });

  // The first word of a capture is capitalised out of habit whatever it is,
  // so it clears the same bar as every other word rather than getting a pass.
  it("does not key on a capitalised opening verb", () => {
    expect(aliasTrigger("Book the flights")).toBeNull();
    expect(aliasTrigger("Pay the electric bill")).toBeNull();
  });

  it("does not key on a weekday or a month", () => {
    expect(aliasTrigger("Tuesday morning gym")).toBeNull();
    expect(aliasTrigger("September invoices")).toBeNull();
  });

  // Nothing here guesses. A capture with no name in it teaches JARVIS
  // nothing, which is the correct outcome: a shaky rule is worse than none.
  it("refuses rather than inventing a trigger", () => {
    expect(aliasTrigger("pick up milk")).toBeNull();
    expect(aliasTrigger("")).toBeNull();
    expect(aliasTrigger("   ")).toBeNull();
  });

  it("keeps a name that carries punctuation, without the punctuation", () => {
    expect(aliasTrigger("Ridgeline Fields: 4pm")).toBe("Ridgeline Fields");
    expect(aliasTrigger("call Northline, urgent")).toBe("Northline");
  });

  // Two names of equal length is a tie, and the first one wins. Arbitrary,
  // but it has to be SOMETHING and stability is what matters: the same text
  // must produce the same trigger every time or no rule is ever born.
  it("breaks a tie on the first name, consistently", () => {
    expect(aliasTrigger("Reply to Harper v Northline")).toBe("Harper");
    expect(aliasTrigger("Reply to Harper v Northline again")).toBe("Harper");
  });

  it("keeps an apostrophe, which is part of a name", () => {
    expect(aliasTrigger("dinner at Rocco's Kitchen")).toBe("Rocco's Kitchen");
  });

  it("ignores a single stray capital letter", () => {
    expect(aliasTrigger("buy A batteries")).toBeNull();
  });

  // Same text in, same trigger out, or the two corrections that make a rule
  // would never match each other.
  it("is stable, which is the whole basis of the two-correction rule", () => {
    const a = aliasTrigger("Elite Squad practice on Tuesday");
    const b = aliasTrigger("Elite Squad practice on Thursday");
    expect(a).toBe(b);
    expect(a).toBe("Elite Squad");
  });
});
