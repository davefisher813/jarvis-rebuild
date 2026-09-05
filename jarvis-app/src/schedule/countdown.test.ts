import { describe, it, expect } from "vitest";
import { LADDER, rungsFor, ladderBody, buildLadder } from "./countdown";

// THE COUNTDOWN LADDER (B1, approved 2026-08-20). No test file existed for
// this module before S6-Q36 touched ladderBody -- these pin the rungs, the
// tone shift as an event closes, and (S6-Q36) the closing rung naming a
// real first move instead of a placeholder for one.

describe("rungsFor", () => {
  it("keeps only rungs whose lead has not already passed", () => {
    expect(rungsFor(90)).toEqual([60, 30, 15, 5]);
    expect(rungsFor(20)).toEqual([15, 5]);
    expect(rungsFor(3)).toEqual([]);
  });
});

describe("ladderBody", () => {
  it("shifts from information to instruction as the event closes", () => {
    expect(ladderBody(60)).toBe("In an hour");
    expect(ladderBody(30)).toBe("In half an hour");
    expect(ladderBody(15)).toBe("Fifteen minutes");
    expect(ladderBody(5)).toBe("Leave what you're doing");
  });

  it("appends the place when there is one, at every rung", () => {
    expect(ladderBody(60, "Ridgeline Fields")).toBe("In an hour · Ridgeline Fields");
    expect(ladderBody(5, "Ridgeline Fields")).toBe("Leave what you're doing · Ridgeline Fields");
  });

  // S6-Q36 (2026-09-04): "the first move is thrown away, never stored."
  it("names the real first move on the closing rung instead of the generic instruction", () => {
    expect(ladderBody(5, undefined, "Open the invoice template")).toBe("Open the invoice template");
    expect(ladderBody(5, "Ridgeline Fields", "Open the invoice template")).toBe("Open the invoice template · Ridgeline Fields");
  });

  it("never lets a first move leak onto the earlier, informational rungs", () => {
    expect(ladderBody(60, undefined, "Open the invoice template")).toBe("In an hour");
    expect(ladderBody(15, undefined, "Open the invoice template")).toBe("Fifteen minutes");
  });

  it("falls back to the generic instruction when the first move is blank", () => {
    expect(ladderBody(5, undefined, "   ")).toBe("Leave what you're doing");
  });
});

describe("buildLadder", () => {
  it("builds one alert per surviving rung, nearest first, none stacked", () => {
    const now = new Date("2026-08-20T09:00:00").getTime();
    const start = new Date("2026-08-20T10:30:00").getTime(); // 90 min out
    const alerts = buildLadder("Standup", start, now);
    expect(alerts.map((a) => a.leadMin)).toEqual(LADDER as unknown as number[]);
    expect(alerts.every((a) => a.title === "Standup")).toBe(true);
    // Sorted lead-descending means fire-time ascending: 60 fires first.
    expect(alerts[0]!.atMs).toBeLessThan(alerts[alerts.length - 1]!.atMs);
  });

  it("drops rungs whose lead has already passed", () => {
    const now = new Date("2026-08-20T09:50:00").getTime();
    const start = new Date("2026-08-20T10:00:00").getTime(); // 10 min out
    const alerts = buildLadder("Standup", start, now);
    expect(alerts.map((a) => a.leadMin)).toEqual([5]);
  });
});
