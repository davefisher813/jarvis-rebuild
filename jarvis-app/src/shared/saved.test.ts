import { describe, it, expect } from "vitest";
import { heldText, savedToastText } from "./saved";

// Phase 0 D4 (2026-10-10): the trust checkpoint's one body of words. A door
// says Saved only when the row is on the server; while the write is still on
// this phone the toast says Filed and Will Sync, and the landed copy of every
// door passes through untouched so nothing is restyled.
describe("heldText: the words for a write that is still on this phone", () => {
  it("with nothing to name, the plain filing", () => {
    expect(heldText()).toBe("Filed · Will Sync");
  });

  it("with a place, the filing names it", () => {
    expect(heldText("Philosophy")).toBe("Filed to Philosophy · Will Sync");
    expect(heldText("Contacts")).toBe("Filed to Contacts · Will Sync");
  });

  it("with a count above one, the filing counts", () => {
    expect(heldText(undefined, 3)).toBe("Filed 3 Items · Will Sync");
    expect(heldText("Tasks", 12)).toBe("Filed 12 Items · Will Sync");
  });

  it("a count of one, or none, is a plain filing", () => {
    expect(heldText(undefined, 1)).toBe("Filed · Will Sync");
    expect(heldText("Tasks", 1)).toBe("Filed to Tasks · Will Sync");
    expect(heldText(undefined, 0)).toBe("Filed · Will Sync");
  });

  it("the held form never claims the write landed", () => {
    for (const t of [heldText(), heldText("Philosophy"), heldText(undefined, 3), heldText("Tasks", 2)]) {
      expect(t).not.toMatch(/\bsaved\b/i);
      expect(t).not.toMatch(/\bdone\b/i);
      expect(t).not.toMatch(/\badded\b/i);
      expect(t).toMatch(/Will Sync$/);
    }
  });

  it("the copy obeys the house rules: Title Case, a capital after a number, no em dash, no spaced hyphen", () => {
    for (const t of [heldText(), heldText("Philosophy"), heldText(undefined, 3)]) {
      expect(t).not.toContain(String.fromCharCode(0x2014));
      expect(t).not.toMatch(/ - /);
      for (const word of t.replace(/·/g, " ").split(/\s+/).filter((w) => /^[a-z]/i.test(w))) {
        if (word === "to") continue; // the one short joining word a title keeps lowercase
        expect(word[0]).toBe(word[0]!.toUpperCase());
      }
      const afterNumber = t.match(/\d+\s+(\S+)/);
      if (afterNumber) expect(afterNumber[1]![0]).toBe(afterNumber[1]![0]!.toUpperCase());
    }
  });
});

describe("savedToastText: landed or held, nothing in between", () => {
  it("not pending, the door's own words come back byte for byte", () => {
    expect(savedToastText("Saved to Philosophy ✓", heldText("Philosophy"), false)).toBe("Saved to Philosophy ✓");
    expect(savedToastText("Done", heldText(), false)).toBe("Done");
  });

  it("pending, the held words come back and the landed words are never seen", () => {
    expect(savedToastText("Saved to Philosophy ✓", heldText("Philosophy"), true)).toBe("Filed to Philosophy · Will Sync");
    expect(savedToastText("Saved to Contacts ✓", "Filed to Contacts · Will Sync", true)).not.toMatch(/Saved/);
  });
});
