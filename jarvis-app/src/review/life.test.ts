import { describe, it, expect } from "vitest";
import { goalEvidenceDays, areaPulse, areaWord, comebackLine, heavyWord, restingNow, FED_DAYS, STARVED_DAYS } from "./life";
import type { Area, Goal } from "../life/types";

const T = "2026-08-25";
const DAY = 86400000;
const ms = (iso: string) => new Date(iso + "T12:00:00").getTime();

const area = (over: Partial<Area["data"]> = {}): Area => ({ id: "a1", data: { name: "Health", state: "steady", ...over } });
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

describe("areaPulse and its word", () => {
  it("fed inside the window, quiet past it, and only chosen areas starve", () => {
    const fedP = areaPulse(area(), [["2026-08-20"]], T);
    expect(fedP.fed).toBe(true);
    expect(areaWord(fedP)).toBe("Fed");

    const old = `2026-0${8 - 1}-${25 - (STARVED_DAYS - 28) || 1}`; // ~a month back
    const quietUnchosen = areaPulse(area(), [["2026-07-20"]], T);
    expect(quietUnchosen.starved).toBe(false); // unchosen: silence
    expect(areaWord(quietUnchosen)).toBeNull();
    void old;

    const quietChosen = areaPulse(area({ chosen: true }), [["2026-07-20"]], T);
    expect(quietChosen.starved).toBe(true);
    expect(areaWord(quietChosen)).toBe("Quiet a while");
  });

  it("resting is an exit, not a lapse: it silences starvation", () => {
    const resting = areaPulse(area({ chosen: true, restingUntil: "2026-11-01" }), [], T);
    expect(resting.resting).toBe(true);
    expect(resting.starved).toBe(false);
    expect(areaWord(resting)).toBe("Resting");
    expect(restingNow(area({ restingUntil: "2026-08-24" }), T)).toBe(false); // expired
  });

  it("an area with no evidence at all only speaks if chosen", () => {
    expect(areaPulse(area(), [], T).starved).toBe(false);
    expect(areaPulse(area({ chosen: true }), [], T).starved).toBe(true);
  });

  it("FED_DAYS is the boundary", () => {
    const edge = new Date(ms(T) - FED_DAYS * DAY).toISOString().slice(0, 10);
    expect(areaPulse(area(), [[edge]], T).fed).toBe(true);
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
