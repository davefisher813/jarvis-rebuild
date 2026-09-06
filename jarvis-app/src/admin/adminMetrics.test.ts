import { describe, it, expect } from "vitest";
import { computeMetrics, retention, activeSince, dayPlus, pct, type OpenRow } from "./adminMetrics";

// UP-LAUNCH-17 (2026-09-05), option A. The numbers the milestones are written
// in, computed from event_log and ai_usage. The rule under every test here:
// a number that cannot be computed honestly is null, never zero.

const opens = (rows: [string, string][]): OpenRow[] => rows.map(([owner_id, day]) => ({ owner_id, day }));

describe("local day arithmetic", () => {
  it("steps days, including across a month and a leap day", () => {
    expect(dayPlus("2026-09-05", 1)).toBe("2026-09-06");
    expect(dayPlus("2026-09-30", 1)).toBe("2026-10-01");
    expect(dayPlus("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayPlus("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("retention", () => {
  it("counts the people who came back on that exact day", () => {
    const r = retention(opens([
      ["a", "2026-09-01"], ["a", "2026-09-02"],   // came back on day 1
      ["b", "2026-09-01"],                          // did not
      ["c", "2026-09-01"], ["c", "2026-09-03"],   // came back, but on day 2
    ]), 1, "2026-09-10");
    expect(r).toEqual({ rate: 1 / 3, basis: 3 });
  });

  it("is the exact day, not 'within', which is the flattering version", () => {
    // A person who opened the app once on day one and came back on day three
    // is not a D7 retained user, and every dashboard that says otherwise is
    // measuring something it cannot act on.
    const r = retention(opens([["a", "2026-09-01"], ["a", "2026-09-04"]]), 7, "2026-09-30");
    expect(r).toEqual({ rate: 0, basis: 1 });
  });

  it("leaves out a cohort that has not had the chance yet", () => {
    // Somebody who signed up yesterday cannot have failed to come back on
    // day seven. Counting them as a miss is how a launch week reads as a
    // disaster.
    const r = retention(opens([["a", "2026-09-01"], ["a", "2026-09-08"], ["b", "2026-09-09"]]), 7, "2026-09-10");
    expect(r).toEqual({ rate: 1, basis: 1 });
  });

  it("has no answer at all when nobody is old enough", () => {
    expect(retention(opens([["a", "2026-09-10"]]), 7, "2026-09-10")).toEqual({ rate: null, basis: 0 });
  });
});

describe("active users", () => {
  it("counts people, not opens", () => {
    expect(activeSince(opens([["a", "2026-09-05"], ["a", "2026-09-06"], ["b", "2026-09-06"]]), "2026-09-01")).toBe(2);
  });
  it("ignores anything before the window", () => {
    expect(activeSince(opens([["a", "2026-08-01"]]), "2026-09-01")).toBe(0);
  });
});

describe("the whole set", () => {
  const base = {
    users: [{ created_at: "2026-09-04T10:00:00Z" }, { created_at: "2026-07-01T10:00:00Z" }],
    opens: opens([["a", "2026-09-04"], ["a", "2026-09-05"], ["b", "2026-09-01"]]),
    funnel: { started: 4, finished: 3, skipped: 1 },
    aiCalls7d: 9,
    truncated: false,
    today: "2026-09-05",
    now: new Date("2026-09-05T12:00:00Z").getTime(),
  };

  it("answers the three questions the milestones are written in", () => {
    const m = computeMetrics(base);
    expect(m.signups7d).toBe(1);
    expect(m.signups30d).toBe(1);
    expect(m.weeklyActive).toBe(2);
    expect(m.onboardingRate).toBe(0.75);
    expect(m.d1).toBe(0.5); // a came back the next day, b did not
    expect(m.aiCallsPerActive).toBe(4.5);
  });

  it("says nothing rather than zero when there is nobody to count", () => {
    const m = computeMetrics({ ...base, users: [], opens: [], funnel: { started: 0, finished: 0, skipped: 0 }, aiCalls7d: 0 });
    expect(m.onboardingRate).toBeNull();
    expect(m.aiCallsPerActive).toBeNull();
    expect(m.d1).toBeNull();
    expect(m.d7).toBeNull();
    expect(m.weeklyActive).toBe(0);
  });

  it("withholds the return numbers rather than computing them from half a history", () => {
    // The row query has a ceiling. Past it the retention walk would be
    // reading a partial history and would quietly under-report, which is the
    // one failure a retention number must not have.
    const m = computeMetrics({ ...base, truncated: true });
    expect(m.d1).toBeNull();
    expect(m.d7).toBeNull();
    expect(m.truncated).toBe(true);
    // Everything that does not depend on the walk still answers.
    expect(m.onboardingRate).toBe(0.75);
    expect(m.weeklyActive).toBe(2);
  });

  it("shows how many people a rate is about, so 100% of one person reads as one person", () => {
    const m = computeMetrics(base);
    expect(m.d1Basis).toBe(2);
  });
});

describe("the panel's own formatting", () => {
  it("renders a rate as a percentage and an absent one as a dash", () => {
    expect(pct(0.6667)).toBe("67%");
    expect(pct(0)).toBe("0%");
    expect(pct(null)).toBe("-");
  });
});
