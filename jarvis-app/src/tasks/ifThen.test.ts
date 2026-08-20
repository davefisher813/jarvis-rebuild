import { describe, it, expect } from "vitest";
import {
  cueIsDetectable, responseIsUsable, isUsable, whyWeak, sentence, cueLine,
  cueKey, findClash, clashLine, planFromBlock, shortenToResponse, words,
  RESPONSE_MAX_WORDS, type IfThen,
} from "./ifThen";

const plan = (over: Partial<IfThen> = {}): IfThen => ({
  cue: { kind: "after", what: "made coffee" }, then: "send the invoice", ...over,
});

describe("the cue must be detectable", () => {
  it("takes a real time, a real place, a real preceding action", () => {
    expect(cueIsDetectable({ kind: "time", what: "13:00" })).toBe(true);
    expect(cueIsDetectable({ kind: "place", what: "at my desk" })).toBe(true);
    expect(cueIsDetectable({ kind: "after", what: "made coffee" })).toBe(true);
  });

  it("rejects the phrases that FEEL like a plan and carry no effect", () => {
    for (const w of ["when I get a chance", "later", "sometime", "soon", "eventually", "when I can"]) {
      expect(cueIsDetectable({ kind: "after", what: w })).toBe(false);
    }
  });

  it("rejects a time that is not a time", () => {
    expect(cueIsDetectable({ kind: "time", what: "afternoon" })).toBe(false);
    expect(cueIsDetectable({ kind: "time", what: "25:00" })).toBe(false);
    expect(cueIsDetectable({ kind: "time", what: "9:00" })).toBe(true);
  });

  it("rejects an empty cue", () => {
    expect(cueIsDetectable({ kind: "place", what: "   " })).toBe(false);
  });
});

describe("the response must be short and observable", () => {
  it("caps at five words, per the research", () => {
    expect(RESPONSE_MAX_WORDS).toBe(5);
    expect(responseIsUsable("send the invoice")).toBe(true);
    expect(responseIsUsable("send the invoice to Wei today please")).toBe(false);
  });

  it("rejects nothing at all", () => {
    expect(responseIsUsable("  ")).toBe(false);
  });

  it("counts words, not characters", () => {
    expect(words("  send   the invoice ")).toBe(3);
    expect(words("")).toBe(0);
  });
});

describe("saying why it is weak, in his terms", () => {
  it("is silent when the plan is good", () => {
    expect(whyWeak(plan())).toBeNull();
  });
  it("names the missing half", () => {
    expect(whyWeak(plan({ cue: { kind: "after", what: "" } }))).toBe("Name when or where");
    expect(whyWeak(plan({ then: "" }))).toBe("Name the first move");
  });
  it("names vagueness and length specifically", () => {
    expect(whyWeak(plan({ cue: { kind: "after", what: "later" } }))).toBe("Too vague to notice");
    expect(whyWeak(plan({ cue: { kind: "time", what: "morning" } }))).toBe("Pick a real time");
    expect(whyWeak(plan({ then: "one two three four five six" }))).toContain("Shorter");
  });
});

describe("the sentence", () => {
  it("reads like something a person says to themselves", () => {
    expect(sentence(plan())).toBe("If I've made coffee, then I'll send the invoice");
    expect(sentence(plan({ cue: { kind: "time", what: "13:00" } }))).toBe("If it's 1:00 PM, then I'll send the invoice");
    expect(sentence(plan({ cue: { kind: "place", what: "at my desk" } }))).toBe("If I'm at my desk, then I'll send the invoice");
  });

  it("has a short form for a row", () => {
    expect(cueLine(plan({ cue: { kind: "time", what: "09:30" } }))).toBe("9:30 AM");
    expect(cueLine(plan({ cue: { kind: "after", what: "made coffee" } }))).toBe("After made coffee");
    expect(cueLine(plan({ cue: { kind: "place", what: "at my desk" } }))).toBe("at my desk");
  });

  it("says 12 for noon and midnight, not 0", () => {
    expect(sentence(plan({ cue: { kind: "time", what: "12:00" } }))).toContain("12:00 PM");
    expect(sentence(plan({ cue: { kind: "time", what: "00:30" } }))).toContain("12:30 AM");
  });
});

describe("one cue, one plan", () => {
  it("treats the same trigger as the same trigger whatever the spacing or case", () => {
    expect(cueKey({ kind: "after", what: "After  Lunch " })).toBe(cueKey({ kind: "after", what: "after lunch" }));
  });

  it("finds the task already sitting on that cue", () => {
    const items = [{ id: "a", plan: plan({ cue: { kind: "after", what: "lunch" } }) }, { id: "b" }];
    expect(findClash(items, { kind: "after", what: "Lunch" })?.id).toBe("a");
    expect(findClash(items, { kind: "after", what: "dinner" })).toBeNull();
  });

  it("does not report a task clashing with itself", () => {
    const items = [{ id: "a", plan: plan({ cue: { kind: "after", what: "lunch" } }) }];
    expect(findClash(items, { kind: "after", what: "lunch" }, "a")).toBeNull();
  });

  it("a different KIND of cue is a different trigger", () => {
    const items = [{ id: "a", plan: plan({ cue: { kind: "place", what: "desk" } }) }];
    expect(findClash(items, { kind: "after", what: "desk" })).toBeNull();
  });

  it("says which task owns the cue", () => {
    expect(clashLine("Pay the ticket")).toBe('"Pay the ticket" already starts there');
  });
});

describe("writing the plan from a committed block", () => {
  it("uses the block's own time as the cue", () => {
    const p = planFromBlock("Draft the coach onboarding email", "13:00");
    expect(p.cue).toEqual({ kind: "time", what: "13:00" });
    expect(isUsable(p)).toBe(true);
  });

  it("trims the title into an observable response", () => {
    expect(shortenToResponse("Draft the coach onboarding email")).toBe("draft the coach onboarding email");
    expect(shortenToResponse("Draft the coach onboarding email today")).toBe("draft the coach onboarding email");
    expect(shortenToResponse("Send the invoice")).toBe("send the invoice");
  });

  it("drops leading filler before it starts cutting real words", () => {
    expect(shortenToResponse("The quick brown fox jumps over lazy dogs")).toBe("quick brown fox jumps over");
  });

  it("never invents a verb the user did not write", () => {
    expect(shortenToResponse("Invoice")).toBe("invoice");
  });

  it("always produces something usable from a real title", () => {
    for (const t of ["Pay Ticket", "Reply to Wei re: Invoice", "Book PG 17U Travel"]) {
      expect(responseIsUsable(shortenToResponse(t))).toBe(true);
    }
  });
});
