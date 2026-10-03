import { describe, it, expect } from "vitest";
import { dayLabel, facts, timeOf, whenLine } from "./format";

const now = new Date(2026, 9, 3, 15, 0, 0); // 3 October 2026, 3 PM local

describe("the Hub's facts", () => {
  it("days are Today, Yesterday, then the short date", () => {
    expect(dayLabel(new Date(2026, 9, 3, 9, 12).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 2, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 8, 30, 9, 0).toISOString(), now)).not.toMatch(/Today|Yesterday/);
    expect(dayLabel("garbage", now)).toBe("");
  });
  it("times are 12-hour", () => {
    expect(timeOf(new Date(2026, 9, 3, 21, 5).toISOString())).toMatch(/9:05/);
    expect(timeOf(new Date(2026, 9, 3, 21, 5).toISOString())).not.toMatch(/21:05/);
  });
  it("the when line joins the two with a dot", () => {
    expect(whenLine(new Date(2026, 9, 3, 9, 12).toISOString(), now)).toMatch(/^Today · 9:12/);
  });
  it("facts drop empties and join with a dot", () => {
    expect(facts("Help Me", null, "", undefined, false, "Summer Travel")).toBe("Help Me · Summer Travel");
    expect(facts()).toBe("");
  });
});
