// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { patternObservation, isPatternDismissed, dismissPattern, readPatternDismissals } from "./patterns";

// Build a checkin map from [isoDate, mood] pairs.
const ck = (pairs: [string, string][]) => Object.fromEntries(pairs.map(([d, m]) => [d, { mood: m }]));

// A run of consecutive dates ending 2026-07-28, oldest first.
const seq = (moods: string[], endIso = "2026-07-28"): [string, string][] => {
  const end = new Date(endIso + "T12:00:00");
  return moods.map((m, i) => {
    const d = new Date(end);
    d.setDate(d.getDate() - (moods.length - 1 - i));
    return [d.toISOString().slice(0, 10), m] as [string, string];
  });
};

const TODAY = "2026-07-29";

describe("patternObservation", () => {
  it("says nothing without data", () => {
    expect(patternObservation(undefined, TODAY)).toBeNull();
    expect(patternObservation({}, TODAY)).toBeNull();
    expect(patternObservation(ck(seq(["fire", "meh"])), TODAY)).toBeNull();
  });

  it("notices a heavy streak of 3+ consecutive underwater days, kindly", () => {
    const o = patternObservation(ck(seq(["fire", "under", "under", "under"])), TODAY);
    expect(o?.id).toBe("under-streak");
    expect(o?.text).not.toMatch(/fail|behind|should have|lazy/i);
    expect(o?.text).not.toContain("\u2014");
  });

  it("a streak with a missing day in the middle is not a streak", () => {
    const entries = seq(["under", "under"], "2026-07-28");
    // add an older 'under' two days before the pair starts (gap of 2)
    const first = entries[0]![0];
    const d = new Date(first + "T12:00:00");
    d.setDate(d.getDate() - 2);
    const withGap = ck([[d.toISOString().slice(0, 10), "under"], ...entries]);
    expect(patternObservation(withGap, TODAY)).toBeNull();
  });

  it("names a weekday that always runs heavy, with enough evidence", () => {
    // 2026-07-16 and 2026-07-23 are Thursdays; both underwater, plus 4 fine days.
    const data = ck([
      ["2026-07-16", "under"], ["2026-07-17", "fire"], ["2026-07-20", "meh"],
      ["2026-07-22", "fire"], ["2026-07-23", "under"], ["2026-07-24", "fire"],
    ]);
    const o = patternObservation(data, TODAY);
    expect(o?.id).toBe("heavy-4");
    expect(o?.text).toContain("Thursdays");
  });

  it("does not call a weekday heavy on one bad instance or thin data", () => {
    // only one Thursday underwater and only 5 entries total
    const data = ck([
      ["2026-07-23", "under"], ["2026-07-24", "fire"], ["2026-07-25", "fire"],
      ["2026-07-26", "meh"], ["2026-07-27", "fire"],
    ]);
    expect(patternObservation(data, TODAY)).toBeNull();
  });

  it("celebrates a 3+ day flow streak", () => {
    const o = patternObservation(ck(seq(["meh", "fire", "fire", "fire"])), TODAY);
    expect(o?.id).toBe("fire-streak");
    expect(o?.text).toContain("3 days");
  });

  it("a heavy streak outranks a heavy weekday", () => {
    // Thursdays 7/16 and 7/23 under AND last 3 days under (7/26, 7/27, 7/28)
    const data = ck([
      ["2026-07-16", "under"], ["2026-07-17", "fire"], ["2026-07-23", "under"],
      ["2026-07-26", "under"], ["2026-07-27", "under"], ["2026-07-28", "under"],
    ]);
    expect(patternObservation(data, TODAY)?.id).toBe("under-streak");
  });
});

describe("pattern dismissals", () => {
  beforeEach(() => localStorage.clear());

  it("a dismissed observation stays hidden for 7 days, then can return", () => {
    dismissPattern("heavy-4", "2026-07-20");
    expect(isPatternDismissed("heavy-4", "2026-07-24")).toBe(true);
    expect(isPatternDismissed("heavy-4", "2026-07-27")).toBe(false);
    expect(isPatternDismissed("under-streak", "2026-07-24")).toBe(false);
  });

  it("survives serialization round-trips", () => {
    dismissPattern("a", "2026-07-01");
    dismissPattern("b", "2026-07-02");
    expect(readPatternDismissals()).toEqual({ a: "2026-07-01", b: "2026-07-02" });
  });
});
