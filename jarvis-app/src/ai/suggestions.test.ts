import { describe, it, expect } from "vitest";
import { parseSuggestions, scrubStyle, suggestionsSystemPrompt } from "./suggestions";

describe("parseSuggestions", () => {
  it("parses a JSON array of strings", () => {
    expect(parseSuggestions('["Email Sam","Call Maya"]')).toEqual([{ text: "Email Sam", task: null }, { text: "Call Maya", task: null }]);
  });
  it("handles code fences and caps at two", () => {
    expect(parseSuggestions('```json\n["a","b","c"]\n```')).toEqual([{ text: "A", task: null }, { text: "B", task: null }]);
  });
  it("returns empty for non-array or junk", () => {
    expect(parseSuggestions("no idea")).toEqual([]);
    expect(parseSuggestions('{"x":1}')).toEqual([]);
    expect(parseSuggestions("[]")).toEqual([]);
  });
});

describe("scrubStyle", () => {
  it("removes em dashes and trailing periods from AI text", () => {
    expect(scrubStyle("Clean Out Apartment \u2014 Make Progress Today.")).toBe("Clean Out Apartment: Make Progress Today");
    // Casing is NORMALISED, not trusted: the model over-applies Title Case to
    // small words, and the app has one implementation that knows the rule.
    expect(scrubStyle("Set Up Stripe Tap To Pay.")).toBe("Set Up Stripe Tap to Pay");
    expect(scrubStyle("Plain One")).toBe("Plain One");
  });
});


describe("actionable suggestions", () => {
  it("parses object suggestions with a linked task", () => {
    const r = parseSuggestions('[{"text":"Finish The Deck Today","task":"Finish deck"},{"text":"Take A Walk","task":null}]');
    expect(r).toEqual([
      { text: "Finish the Deck Today", task: "Finish deck" },
      { text: "Take a Walk", task: null },
    ]);
  });
  it("includes the avoid list in the prompt", () => {
    const ctx = { name: "Dave", template: "personal", people: [], categories: [], openTasks: [], events: [], birthdays: [] } as never;
    const p = suggestionsSystemPrompt(ctx, "2026-07-28", ["Old One"]);
    expect(p).toContain("Old One");
    expect(p).toContain("do NOT repeat".toLowerCase().replace("do not", "Do NOT"));
  });
});
