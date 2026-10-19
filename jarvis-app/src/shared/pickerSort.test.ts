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
  // RECENTS NEXT (research standard, rule 11, 2026-10-19): what he picked lately follows the current pick, newest first, ahead of the area groups.
  it("puts the recents after the current pick, newest first, then the rest in area order", () => {
    expect(sortPicks(items, null, ["g", "z"]).map((i) => i.id)).toEqual(["g", "z", "b", "a", "n"]);
    expect(sortPicks(items, "a", ["g", "z"]).map((i) => i.id)).toEqual(["a", "g", "z", "b", "n"]);
    expect(sortPicks(items, null, ["gone"]).map((i) => i.id), "an id that is no longer there changes nothing").toEqual(["b", "g", "a", "z", "n"]);
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
