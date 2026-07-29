import { describe, it, expect } from "vitest";
import { daySizing, FULL_DAY } from "./daySizing";

describe("daySizing", () => {
  it("lightens the day after an underwater day", () => {
    const s = daySizing("under");
    expect(s.light).toBe(true);
    expect(s.maxBlocks).toBe(4);
    expect(s.extraSlackMin).toBeGreaterThan(0);
    expect(s.note).toBeTruthy();
  });

  it("plans a normal day after fire, meh, or no answer", () => {
    expect(daySizing("fire")).toEqual(FULL_DAY);
    expect(daySizing("meh")).toEqual(FULL_DAY);
    expect(daySizing(undefined)).toEqual(FULL_DAY);
  });

  it("never guilts: the note acknowledges without blame", () => {
    const note = daySizing("under").note ?? "";
    expect(note).not.toMatch(/fail|behind|should|lazy/i);
    expect(note).not.toContain("—"); // no em dash, ever
  });
});
