import { describe, it, expect } from "vitest";
import { medWindowDays } from "./medWindow";
import type { AteBeforeEntry, LightsOutEntry, TookItEntry } from "./types";

describe("medWindowDays", () => {
  it("groups the four facts onto their own date, sorted by time", () => {
    const day = "2026-08-27";
    const tookIt: TookItEntry[] = [{ id: "t1", data: { category: "medication", at: Date.parse(day + "T07:15:00") } }];
    const ateBefore: AteBeforeEntry[] = [{ id: "a1", data: { category: "fuel", date: day, ate: true, at: Date.parse(day + "T14:30:00") } }];
    const lightsOut: LightsOutEntry[] = [{ id: "l1", data: { category: "sleep", at: Date.parse(day + "T22:30:00") } }];
    const rows = medWindowDays(tookIt, ateBefore, [{ date: day, at: Date.parse(day + "T15:30:00"), title: "Practice" }], lightsOut);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe(day);
    expect(rows[0]!.marks.map((m) => m.kind)).toEqual(["dose", "food", "session", "lights_out"]);
  });

  it("never invents a mark for something that was not logged", () => {
    const day = "2026-08-27";
    const tookIt: TookItEntry[] = [{ id: "t1", data: { category: "medication", at: Date.parse(day + "T07:15:00") } }];
    const rows = medWindowDays(tookIt, [], [], []);
    expect(rows[0]!.marks).toHaveLength(1);
  });

  it("drops a 'did not eat' answer from the food mark (only a yes is an event)", () => {
    const day = "2026-08-27";
    const ateBefore: AteBeforeEntry[] = [{ id: "a1", data: { category: "fuel", date: day, ate: false, at: Date.parse(day + "T14:30:00") } }];
    const rows = medWindowDays([], ateBefore, [], []);
    expect(rows).toHaveLength(0);
  });

  it("draws no relationship between marks: rows carry facts only, no derived field", () => {
    const day = "2026-08-27";
    const tookIt: TookItEntry[] = [{ id: "t1", data: { category: "medication", at: Date.parse(day + "T07:15:00") } }];
    const rows = medWindowDays(tookIt, [], [], []);
    for (const mark of rows[0]!.marks) {
      expect(Object.keys(mark).sort()).toEqual(["at", "kind", "label"]);
    }
  });
});
