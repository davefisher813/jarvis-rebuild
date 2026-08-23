// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { clearedToday, bumpCleared, closeOut } from "./cleared";

const TODAY = "2026-08-23";
const YESTERDAY = "2026-08-22";

beforeEach(() => localStorage.clear());

describe("the daily count", () => {
  it("starts at zero and counts real actions", () => {
    expect(clearedToday(TODAY)).toBe(0);
    expect(bumpCleared(TODAY)).toBe(1);
    expect(bumpCleared(TODAY, 5)).toBe(6);
    expect(clearedToday(TODAY)).toBe(6);
  });

  it("does not carry yesterday's number into today", () => {
    bumpCleared(YESTERDAY, 9);
    expect(clearedToday(YESTERDAY)).toBe(9);
    expect(clearedToday(TODAY)).toBe(0);
  });

  it("a bump on a new date replaces rather than adds", () => {
    bumpCleared(YESTERDAY, 9);
    expect(bumpCleared(TODAY, 2)).toBe(2);
  });

  it("ignores a nonsense increment instead of corrupting the count", () => {
    bumpCleared(TODAY, 3);
    expect(bumpCleared(TODAY, 0)).toBe(3);
    expect(bumpCleared(TODAY, -4)).toBe(3);
    expect(bumpCleared(TODAY, NaN)).toBe(3);
  });

  it("survives a garbage or half-written store", () => {
    localStorage.setItem("jarvis.mail.cleared.v1", "{not json");
    expect(clearedToday(TODAY)).toBe(0);
    localStorage.setItem("jarvis.mail.cleared.v1", JSON.stringify({ date: TODAY }));
    expect(clearedToday(TODAY)).toBe(0);
    localStorage.setItem("jarvis.mail.cleared.v1", JSON.stringify({ date: TODAY, n: -2 }));
    expect(clearedToday(TODAY)).toBe(0);
  });
});

describe("the close-out line", () => {
  it("leads with the achievement when there is one", () => {
    expect(closeOut(6, 14, 0)).toEqual({ title: "6 Cleared Today", sub: "14 In the inbox · Nothing urgent" });
  });

  it("never dresses up a zero", () => {
    expect(closeOut(0, 14, 0).title).toBe("Nothing Needs You");
  });

  it("says what is still waiting rather than claiming calm it cannot see", () => {
    expect(closeOut(3, 14, 2).sub).toBe("14 In the inbox · 2 Still need you");
    expect(closeOut(3, 14, 1).sub).toBe("14 In the inbox · 1 Still needs you");
  });

  it("handles the singular and the truly empty", () => {
    expect(closeOut(1, 1, 0)).toEqual({ title: "1 Cleared Today", sub: "1 In the inbox · Nothing urgent" });
    expect(closeOut(0, 0, 0).sub).toBe("Inbox empty · Nothing urgent");
  });
});
