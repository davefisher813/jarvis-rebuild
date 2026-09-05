// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bus } from "./index";
import { settleDuePlans, startEventPipeline } from "./pipeline";
import type { JarvisEvent } from "./types";

// PLUMB-F-17 (2026-09-05): "yesterday's plan is only scored at cold start."
// resolvePendingPlans had tests for its logic and none for WHEN it runs, which
// is the half that was wrong: the app stays resident across midnight on iOS,
// so plan.outcome for yesterday's picks waited for the next full relaunch.

const PENDING_KEY = "jarvis.plan.pending.v1";

function pendingPlanFor(day: string, picks: string[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify([{ day, picks }]));
}

describe("settling due plans", () => {
  let seen: JarvisEvent[] = [];
  let off: () => void;

  beforeEach(() => {
    localStorage.clear();
    seen = [];
    off = bus.subscribe((e) => { if (e.type === "plan.outcome") seen.push(e); });
    vi.useFakeTimers();
  });
  afterEach(() => {
    off();
    vi.useRealTimers();
  });

  it("scores yesterday's picks when the app comes back to the foreground on a new day", () => {
    // 11 PM: today's plan is committed and is not due yet.
    vi.setSystemTime(new Date(2026, 8, 5, 23, 0, 0));
    pendingPlanFor("2026-09-05", ["t1", "t2"]);
    startEventPipeline(null);
    expect(seen.length).toBe(0);

    // Midnight passes with the app still alive, then he picks the phone up.
    vi.setSystemTime(new Date(2026, 8, 6, 7, 30, 0));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(seen.map((e) => e.entityId)).toEqual(["t1", "t2"]);
    expect(seen[0]!.props?.day).toBe("2026-09-05");
    expect(seen[0]!.props?.n).toBe(1);
    // Nothing was done that day and nothing pretends otherwise.
    expect(seen[0]!.props?.flag).toBe(false);
  });

  // The "last settled day" marker lives for the life of the module, which is
  // the point of it, so each test below works on days of its own rather than
  // reaching in to reset it.
  it("settles once a day, however many times the app is foregrounded", () => {
    vi.setSystemTime(new Date(2026, 8, 9, 9, 0, 0));
    pendingPlanFor("2026-09-08", ["t1"]);
    expect(settleDuePlans()).toBe(1);
    pendingPlanFor("2026-09-08", ["t1"]);
    expect(settleDuePlans()).toBe(0);
    expect(seen.length).toBe(1);
  });

  it("settles again once the day itself has changed", () => {
    vi.setSystemTime(new Date(2026, 8, 12, 9, 0, 0));
    pendingPlanFor("2026-09-11", ["t1"]);
    settleDuePlans();
    vi.setSystemTime(new Date(2026, 8, 13, 9, 0, 0));
    pendingPlanFor("2026-09-12", ["t2"]);
    expect(settleDuePlans()).toBe(1);
    expect(seen.map((e) => e.entityId)).toEqual(["t1", "t2"]);
  });
});
