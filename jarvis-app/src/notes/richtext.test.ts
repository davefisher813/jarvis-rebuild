// The rich-text core (deep writing pass, 2026-08-19). Storage is plain
// text with markers; these laws pin the parse, the caret math, and the
// wrap/unwrap so the canvas can trust them.
import { describe, it, expect } from "vitest";
import { parseRich, hasRich, displayToRawOffset, wrapRange, countWords } from "./richtext";

describe("parseRich", () => {
  it("splits bold, italic, highlight, and strike out of plain runs", () => {
    const segs = parseRich("Ask **Rob** about *the board* and ==10k== ~~maybe~~");
    expect(segs.map((s) => s.cls)).toEqual([undefined, "t-b", undefined, "t-i", undefined, "t-hl", undefined, "t-strike"]);
    expect(segs.map((s) => s.text).join("")).toBe("Ask Rob about the board and 10k maybe");
  });

  it("leaves plain text alone", () => {
    const segs = parseRich("Nothing fancy here");
    expect(segs).toHaveLength(1);
    expect(segs[0]!.cls).toBeUndefined();
    expect(hasRich("Nothing fancy here")).toBe(false);
    expect(hasRich("But **this** is")).toBe(true);
  });
});

describe("displayToRawOffset", () => {
  it("maps a tap on formatted text past the hidden markers", () => {
    const raw = "Say **hi** now";
    // Display: "Say hi now". Tapping between h and i (display 5) lands
    // inside the bold run, after the two leading stars (raw 7).
    expect(displayToRawOffset(raw, 5)).toBe(7);
    // Tapping in the plain lead maps straight through.
    expect(displayToRawOffset(raw, 2)).toBe(2);
    // Past the end clamps to the raw end.
    expect(displayToRawOffset(raw, 99)).toBe(raw.length);
  });
});

describe("wrapRange", () => {
  it("wraps a selection in markers", () => {
    expect(wrapRange("make it bold", 8, 12, "**").text).toBe("make it **bold**");
  });
  it("unwraps when the selection already carries that marker", () => {
    expect(wrapRange("make it **bold**", 10, 14, "**").text).toBe("make it bold");
  });
});

describe("countWords", () => {
  it("counts across chunks with markers stripped", () => {
    expect(countWords(["**Two** words", "and ==three== more"])).toBe(5);
    expect(countWords([""])).toBe(0);
  });
});
