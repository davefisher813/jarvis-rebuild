import { describe, it, expect } from "vitest";
import { sortPicks, matchesPick } from "./pickerSort";

// THE PICKER'S ORDER (Dave's pass-off, 2026-09-26): current pick first, then
// by area, then by name; no area last.
describe("sortPicks", () => {
  const items = [
    { id: "z", title: "Zeta", area: "Work" },
    { id: "n", title: "No Area" },
    { id: "b", title: "beta", area: "Family" },
    { id: "a", title: "Alpha", area: "Work" },
    { id: "g", title: "Gamma", area: "Family" },
  ];
  it("groups by area, then names inside it, case-insensitively", () => {
    expect(sortPicks(items).map((i) => i.id)).toEqual(["b", "g", "a", "z", "n"]);
  });
  it("puts the current pick first, whatever its area", () => {
    expect(sortPicks(items, "z").map((i) => i.id)).toEqual(["z", "b", "g", "a", "n"]);
  });
  it("leaves the input alone", () => {
    const before = items.map((i) => i.id);
    sortPicks(items, "a");
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe("matchesPick", () => {
  it("is a contains match that ignores case and edge spaces", () => {
    expect(matchesPick("Rebuild Bridge App", " bridge ")).toBe(true);
    expect(matchesPick("Rebuild Bridge App", "BRIDGE")).toBe(true);
    expect(matchesPick("Rebuild Bridge App", "golf")).toBe(false);
  });
  it("an empty query keeps everything", () => {
    expect(matchesPick("Anything", "")).toBe(true);
    expect(matchesPick("Anything", "   ")).toBe(true);
  });
});
