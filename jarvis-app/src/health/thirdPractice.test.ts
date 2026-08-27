import { describe, it, expect } from "vitest";
import { thirdPracticeDays, thirdPracticeOffers } from "./thirdPractice";
import type { SportSession } from "./loadCandidates";

describe("thirdPracticeDays", () => {
  it("flags a day with two different orgs", () => {
    const sessions: SportSession[] = [
      { date: "2026-08-27", org: "School Team" },
      { date: "2026-08-27", org: "Travel Team" },
    ];
    const days = thirdPracticeDays(sessions);
    expect(days).toHaveLength(1);
    expect(days[0]!.orgs).toEqual(["School Team", "Travel Team"]);
    expect(days[0]!.count).toBe(2);
  });

  it("does not flag two sessions from the SAME org on one day", () => {
    const sessions: SportSession[] = [
      { date: "2026-08-27", org: "School Team" },
      { date: "2026-08-27", org: "School Team" },
    ];
    expect(thirdPracticeDays(sessions)).toHaveLength(0);
  });

  it("does not flag a single session", () => {
    expect(thirdPracticeDays([{ date: "2026-08-27", org: "School Team" }])).toHaveLength(0);
  });

  it("flags three orgs the same as two, without escalating the shape", () => {
    const sessions: SportSession[] = [
      { date: "2026-08-27", org: "School Team" },
      { date: "2026-08-27", org: "Travel Team" },
      { date: "2026-08-27", org: "Private Trainer" },
    ];
    expect(thirdPracticeDays(sessions)[0]!.count).toBe(3);
  });
});

describe("thirdPracticeOffers", () => {
  it("states the fact once per day and pairs it with an offer, never a warning word", () => {
    const sessions: SportSession[] = [
      { date: "2026-08-27", org: "School Team" },
      { date: "2026-08-27", org: "Travel Team" },
    ];
    const offers = thirdPracticeOffers(sessions);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.line).not.toMatch(/warning|danger|too much/i);
    expect(offers[0]!.action).toBe("protect_gap");
  });
});
