import { describe, it, expect } from "vitest";
import { tuningsFrom, tuningAllows, tuningWeight, tuningLine, tuningScope, TUNING_BOOST } from "./tuning";
import type { LearnedRule } from "./LearnedRulesService";

const rule = (name: string, to: string): LearnedRule => ({
  id: "r-" + name,
  data: { kind: "tuning", scope: tuningScope(name), from: "frequency", to, evidence: ["a card"], createdAt: "2026-09-05" },
});

// UP-CORE-14 (2026-09-05): the rule kind and the doctrine existed from the
// start (rules/types.ts names automation tunings outright) and exactly two
// tuning rules were ever written, both from the planner. These pin what each
// of the three choices means.
describe("automation tunings", () => {
  it("reads only frequency tunings, and ignores every other rule", () => {
    const t = tuningsFrom([
      rule("goal-nudge", "less"),
      { id: "a", data: { kind: "alias", scope: "capture.category", from: "practice", to: "c1", evidence: [], createdAt: "" } },
      { id: "b", data: { kind: "tuning", scope: "plan.duration", from: "c1", to: "45", evidence: [], createdAt: "" } },
      { id: "c", data: { kind: "tuning", scope: tuningScope("x"), from: "frequency", to: "sometimes", evidence: [], createdAt: "" } },
    ]);
    expect(t).toEqual({ "goal-nudge": "less" });
  });

  it("Never means never, until the rule is deleted", () => {
    const t = tuningsFrom([rule("momentum", "never")]);
    expect(tuningAllows(t, "momentum", "2026-09-05")).toBe(false);
    expect(tuningAllows(t, "momentum", "2026-09-06")).toBe(false);
    // A producer nobody has tuned speaks exactly as it always did.
    expect(tuningAllows(t, "goal-nudge", "2026-09-05")).toBe(true);
    expect(tuningAllows({}, "momentum", "2026-09-05")).toBe(true);
  });

  it("Less means alternate days, by arithmetic on the date and nothing stored", () => {
    const t = tuningsFrom([rule("goal-nudge", "less")]);
    const a = tuningAllows(t, "goal-nudge", "2026-09-05");
    const b = tuningAllows(t, "goal-nudge", "2026-09-06");
    expect(a).not.toBe(b);
    // Same answer for the same day, every time and on every device.
    expect(tuningAllows(t, "goal-nudge", "2026-09-05")).toBe(a);
  });

  it("More lifts the card and never invents one", () => {
    const t = tuningsFrom([rule("momentum", "more")]);
    expect(tuningWeight(t, "momentum", 50)).toBe(50 + TUNING_BOOST);
    expect(tuningWeight(t, "goal-nudge", 50)).toBe(50);
    // It is still gated on the producer having something to say.
    expect(tuningAllows(t, "momentum", "2026-09-05")).toBe(true);
  });

  it("says itself in words on What JARVIS Learned", () => {
    expect(tuningLine(rule("goal-nudge", "never"))).toBe("Goal Nudges · Never show");
    expect(tuningLine(rule("gap-fill", "less"))).toBe("Gap Fill · Show less often");
    expect(tuningLine(rule("momentum", "more"))).toBe("Keep Going · Show more often");
    // Not a tuning: the page keeps the sentence it already had.
    expect(tuningLine({ id: "a", data: { kind: "alias", scope: "capture.category", from: "x", to: "y", evidence: [], createdAt: "" } })).toBeNull();
  });
});
