import { describe, it, expect } from "vitest";
import { railToneForWaiting, railToneForDeadline, railClass, ageBands, showBandHeads } from "./rows";

// A Tuesday, so named-day ranks are deterministic.
const NOW = new Date("2026-08-25T10:00:00");

describe("the rail's two authorities", () => {
  it("waiting heat is the ladder's tone, translated and nothing more", () => {
    expect(railToneForWaiting("firm")).toBe("hot");
    expect(railToneForWaiting("direct")).toBe("warm");
    expect(railToneForWaiting("gentle")).toBeNull();
    expect(railToneForWaiting("")).toBeNull();
  });

  it("triage heat is the sender's stated deadline, translated", () => {
    expect(railToneForDeadline("today", NOW)).toBe("hot");
    expect(railToneForDeadline("asap", NOW)).toBe("hot");
    expect(railToneForDeadline("tomorrow", NOW)).toBe("hot");
    expect(railToneForDeadline("Friday", NOW)).toBe("warm");
    expect(railToneForDeadline("next week", NOW)).toBeNull();
  });

  it("never invents heat from silence or from 'no rush'", () => {
    expect(railToneForDeadline(undefined, NOW)).toBeNull();
    expect(railToneForDeadline("", NOW)).toBeNull();
    expect(railToneForDeadline("no rush", NOW)).toBeNull();
    expect(railToneForDeadline("some phrase byRank cannot read", NOW)).toBeNull();
  });
});

describe("the rail's paint", () => {
  it("solid means unread or heat, hollow means read and calm", () => {
    expect(railClass(true, null)).toBe("msg-rail on");
    expect(railClass(false, null)).toBe("msg-rail");
    expect(railClass(false, "warm")).toBe("msg-rail on warm");
    expect(railClass(true, "hot")).toBe("msg-rail on hot");
  });
});

describe("age bands", () => {
  const row = (d: number) => ({ d });
  const days = (r: { d: number }) => r.d;

  it("groups by the thresholds Today's notices already use, oldest first", () => {
    const bands = ageBands([row(55), row(46), row(25), row(9), row(2)], days);
    expect(bands.map((b) => b.label)).toEqual(["Over a Month", "Weeks Now", "Past a Week", "Recent"]);
    expect(bands[0]!.rows.map(days)).toEqual([55, 46]);
    expect(bands[1]!.rows.map(days)).toEqual([25]);
  });

  it("skips empty bands instead of rendering hollow heads", () => {
    const bands = ageBands([row(55), row(50)], days);
    expect(bands.map((b) => b.label)).toEqual(["Over a Month"]);
  });

  it("one band means no heads: a label restating the section is decoration", () => {
    expect(showBandHeads(ageBands([row(55), row(50)], days))).toBe(false);
    expect(showBandHeads(ageBands([row(55), row(9)], days))).toBe(true);
  });

  it("every row lands in exactly one band", () => {
    const rows = [row(60), row(30), row(29), row(21), row(20), row(7), row(6), row(0)];
    const bands = ageBands(rows, days);
    expect(bands.flatMap((b) => b.rows)).toHaveLength(rows.length);
  });
});
