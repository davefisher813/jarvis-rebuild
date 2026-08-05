// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadEnvelopes, saveEnvelopes, setAsideTotal, leftToSpend, leftSub,
  shortLine, daysUntil, perDayLine, envelopeId,
} from "./budget";

const env = (id: string, name: string, amount: number) => ({ id, name, amount });

describe("set aside is a plan, never a spend claim", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips and totals", () => {
    saveEnvelopes([env("a", "Groceries", 300), env("b", "Gas", 120)]);
    expect(loadEnvelopes()).toHaveLength(2);
    expect(setAsideTotal(loadEnvelopes())).toBe(420);
  });

  it("drops the empty and the meaningless rather than storing junk", () => {
    const out = saveEnvelopes([env("a", "  ", 300), env("b", "Gas", 0), env("c", "Food", 50)]);
    expect(out.map((e) => e.name)).toEqual(["Food"]);
  });

  it("survives a corrupt store and ignores garbage rows", () => {
    localStorage.setItem("jarvis.money.envelopes.v1", "[not json");
    expect(loadEnvelopes()).toEqual([]);
    localStorage.setItem("jarvis.money.envelopes.v1", JSON.stringify([{ id: 1 }, null, env("a", "Gas", 20)]));
    expect(loadEnvelopes()).toEqual([env("a", "Gas", 20)]);
  });

  it("ids are stable and unique per seed", () => {
    expect(envelopeId(1)).not.toBe(envelopeId(2));
  });
});

describe("what is actually yours", () => {
  it("is paycheck minus bills minus what you reserved", () => {
    const l = leftToSpend(2102, 1240, 450);
    expect(l.amount).toBe(412);
    expect(l.short).toBe(false);
  });

  it("states the arithmetic without claiming anything was spent", () => {
    const sub = leftSub(leftToSpend(2102, 1240, 450));
    expect(sub).toBe("After $1,240 of bills and $450 set aside");
    expect(sub.toLowerCase()).not.toContain("spent");
    expect(sub.toLowerCase()).not.toContain("left of");
  });

  it("says only what is true when there is nothing set aside", () => {
    expect(leftSub(leftToSpend(2102, 1240, 0))).toBe("After $1,240 of bills");
    expect(leftSub(leftToSpend(2102, 0, 0))).toBe("");
  });

  it("names a shortfall in words, and never when there is none", () => {
    expect(shortLine(leftToSpend(1000, 1200, 0))).toBe("$200 more than this paycheck covers.");
    expect(shortLine(leftToSpend(2102, 1240, 450))).toBe("");
  });

  it("knows when the bills alone are the problem", () => {
    expect(leftToSpend(1000, 1200, 0).short).toBe(true);
    expect(leftToSpend(1000, 900, 300).short).toBe(false); // the reserves did that, not the bills
  });
});

describe("per day", () => {
  it("counts the days that are left, today included", () => {
    expect(daysUntil("2026-08-05", "2026-08-19")).toBe(14);
    expect(daysUntil("2026-08-05", "2026-08-05")).toBe(0);
    expect(daysUntil("nonsense", "2026-08-19")).toBe(0);
  });

  it("offers a daily number only when it is real", () => {
    expect(perDayLine(leftToSpend(2102, 1240, 450), 14)).toBe("14 days, about $29 a day");
    expect(perDayLine(leftToSpend(2102, 1240, 450), 1)).toBe("");
    expect(perDayLine(leftToSpend(1000, 1200, 0), 14)).toBe("");   // never divide a shortfall
    expect(perDayLine(leftToSpend(1005, 1000, 0), 30)).toBe("");   // under a dollar a day says nothing
  });

  it("never scolds with arithmetic", () => {
    const line = perDayLine(leftToSpend(2102, 1240, 450), 14).toLowerCase();
    for (const w of ["only", "just", "careful", "tight", "cannot", "afford"]) {
      expect(line).not.toContain(w);
    }
  });
});
