import { describe, it, expect } from "vitest";
import { dayLabel, dotParts, timeOf, whenFacts, whenLine } from "./format";

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
  // 2026-10-05 (catalog gate): the dotted `facts(...)` builder is gone. A moment
  // is two small-caps date facts and the stylesheet draws the dot between them.
  it("a moment is two date facts, never one string with a dot in it", () => {
    const w = whenFacts(new Date(2026, 9, 3, 9, 12).toISOString(), now);
    expect(w.map((f) => f.tone)).toEqual(["date", "date"]);
    expect(w[0]!.text).toBe("Today");
    expect(w[1]!.text).toMatch(/^9:12\s?AM$/);
    expect(w.some((f) => f.text.includes("\u00b7"))).toBe(false);
    expect(whenFacts("garbage", now)).toEqual([]);
  });
  it("the clock is 12-hour with AM or PM whatever the device's locale says", () => {
    const orig = Date.prototype.toLocaleTimeString;
    // A 24-hour device: the old call (`[]` locales) followed this and drew "21:05".
    Date.prototype.toLocaleTimeString = function (loc?: string | string[], o?: Intl.DateTimeFormatOptions) { return orig.call(this, Array.isArray(loc) && loc.length === 0 ? "en-GB" : loc, o); };
    try {
      expect(timeOf(new Date(2026, 9, 3, 21, 5).toISOString())).toMatch(/^9:05\s?PM$/);
      expect(timeOf(new Date(2026, 9, 3, 0, 7).toISOString())).toMatch(/^12:07\s?AM$/);
    } finally { Date.prototype.toLocaleTimeString = orig; }
  });
  it("a string another layer joined with a dot is cut back into its parts", () => {
    expect(dotParts("Suggested by Claude \u00b7 Approved by You")).toEqual(["Suggested by Claude", "Approved by You"]);
    expect(dotParts(null)).toEqual([]);
  });
});
