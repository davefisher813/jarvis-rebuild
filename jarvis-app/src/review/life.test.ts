import { describe, it, expect } from "vitest";
import { goalEvidenceDays, comebackLine, heavyWord } from "./life";
import type { Goal } from "../life/types";

const T = "2026-08-25";
const ms = (iso: string) => new Date(iso + "T12:00:00").getTime();

const goal = (over: Partial<Goal["data"]> = {}): Goal => ({ id: "g1", data: { title: "G", state: "on_track", ...over } as Goal["data"] });
const reach = (filed: string[], tagged: string[] = []) => ({
  filedIds: filed, taggedIds: tagged, openTagged: 0,
  progress: filed.length ? { done: 0, total: filed.length, pct: 0 } : null,
});

describe("goalEvidenceDays", () => {
  it("collects seen completion days for reached tasks plus savings days", () => {
    const days = goalEvidenceDays(
      goal({ saved: [{ d: "2026-08-20", amount: 50 }] }),
      reach(["t1"], ["t2"]),
      [{ id: "t1", t: ms("2026-08-22") }, { id: "t2", t: ms("2026-08-23") }, { id: "zz", t: ms("2026-08-24") }],
    );
    expect(days).toEqual(["2026-08-20", "2026-08-22", "2026-08-23"]);
  });
});

describe("comebackLine (the return is a win)", () => {
  it("names a return after a real gap with a real run behind it", () => {
    const days = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-25"];
    expect(comebackLine(days, T)).toBe("Back at it after 12 quiet days");
  });
  it("stays silent with no gap, no run, or a stale return", () => {
    expect(comebackLine(["2026-08-22", "2026-08-25"], T)).toBeNull(); // run of 1 before gap
    expect(comebackLine(["2026-08-23", "2026-08-24", "2026-08-25"], T)).toBeNull(); // no gap
    expect(comebackLine(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-15"], T)).toBeNull(); // return is old news
    expect(comebackLine([], T)).toBeNull();
  });
});

describe("heavyWord (difficulty reads as weight, never failure)", () => {
  it("speaks only for behind or idle with open work", () => {
    expect(heavyWord("behind", true)).toBe("Heavy right now");
    expect(heavyWord("idle", true)).toBe("Heavy right now");
    expect(heavyWord("behind", false)).toBeNull();
    expect(heavyWord("on_track", true)).toBeNull();
  });
});
