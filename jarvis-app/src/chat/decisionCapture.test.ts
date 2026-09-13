import { describe, it, expect } from "vitest";
import { detectDecision } from "./answers";

const user = (text: string) => ({ role: "user" as const, text });
const jarvis = (text: string) => ({ role: "assistant" as const, text });

describe("detectDecision (C-52)", () => {
  it("reads the four stated shapes, and carries the option ruled out", () => {
    expect(detectDecision(user("Let's use Stripe instead of Clover."), null)).toEqual({ decision: "Use Stripe instead of Clover", ruledOut: ["Clover"] });
    expect(detectDecision(user("we're going with Ridgeline"), null)).toEqual({ decision: "Going with Ridgeline" });
    expect(detectDecision(user("decided: fall clinics run Saturdays only"), null)).toEqual({ decision: "fall clinics run Saturdays only" });
    expect(detectDecision(user("Decision: drop Open Media LLC"), null)).toEqual({ decision: "drop Open Media LLC" });
  });

  it("takes the assistant's one-line reason as the why when it gave one for that option", () => {
    const prev = jarvis("Stripe. It already runs the booking payments, so one ledger, one reconciliation. Clover only wins if you need its hardware.");
    expect(detectDecision(user("Let's use Stripe instead of Clover"), prev)).toEqual({
      decision: "Use Stripe instead of Clover", ruledOut: ["Clover"],
      why: "It already runs the booking payments, so one ledger, one reconciliation",
    });
    // A previous turn about something else records no reason.
    expect(detectDecision(user("Let's use Stripe instead of Clover"), jarvis("3 events · 2 tasks due"))).toEqual({ decision: "Use Stripe instead of Clover", ruledOut: ["Clover"] });
  });

  it("a pick answering the X or Y the assistant asked is a decision, the other ruled out", () => {
    expect(detectDecision(user("Stripe"), jarvis("Stripe or Clover?"))).toEqual({ decision: "Stripe", ruledOut: ["Clover"] });
    expect(detectDecision(user("clover."), jarvis("Do you want Stripe or Clover?"))).toEqual({ decision: "Clover", ruledOut: ["Stripe"] });
    expect(detectDecision(user("neither"), jarvis("Stripe or Clover?"))).toBeNull();
  });

  it("never fires on an assistant turn, on a question, or on ordinary text", () => {
    expect(detectDecision(jarvis("Let's use Stripe instead of Clover"), null)).toBeNull();
    expect(detectDecision(user("Should we use Stripe instead of Clover?"), null)).toBeNull();
    expect(detectDecision(user("dinner with Marco Thursday 7pm"), null)).toBeNull();
    expect(detectDecision(user("Stripe"), null)).toBeNull();
  });

  it("never says anything about strength: a decision is a record, not a rule", () => {
    const d = detectDecision(user("going with Stripe"), null)!;
    expect(Object.keys(d)).not.toContain("strength");
  });
});
