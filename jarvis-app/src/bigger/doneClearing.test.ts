// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readDoneClearing, clearsDoneAutomatically } from "./doneClearing";
import { writeMirror, clearMirror, SETTING_DONE_CLEARING } from "../data/SettingsService";
import { bucketOf } from "./progress";
import { healthOf } from "./measure";
import type { Goal } from "../life/types";
import type { MeasureState } from "./measure";

// WHO SAYS A THING IS DONE (Dave 2026-09-09 "a done confirmation should be
// MANDATORY to clear items", 2026-09-12 "the user should be able to decide if
// it automatically clears or needs permission"). Ask First is the ruling and
// the default; Clear Automatically hands the decision back to the arithmetic.

beforeEach(() => { clearMirror(SETTING_DONE_CLEARING); });

describe("the setting itself", () => {
  it("is Ask First until he says otherwise, and on a phone that has never synced", () => {
    expect(readDoneClearing()).toBe("ask");
    expect(clearsDoneAutomatically()).toBe(false);
  });

  it("reads what he chose", () => {
    writeMirror(SETTING_DONE_CLEARING, { value: "auto", updatedAt: 1 });
    expect(readDoneClearing()).toBe("auto");
    expect(clearsDoneAutomatically()).toBe(true);
    writeMirror(SETTING_DONE_CLEARING, { value: "ask", updatedAt: 2 });
    expect(clearsDoneAutomatically()).toBe(false);
  });

  it("treats a stored value it does not recognise as Ask First, never as auto", () => {
    writeMirror(SETTING_DONE_CLEARING, { value: "yes please", updatedAt: 1 });
    expect(readDoneClearing()).toBe("ask");
  });
});

describe("what the surfaces do with it", () => {
  const row = (done: number, total: number) => ({
    project: { id: "p", data: { title: "P", status: "active" } } as never,
    progress: { done, total, pct: Math.round((done / total) * 100) },
    stalled: false, lastAt: null,
  });
  const goal = { id: "g", data: { title: "G", state: "active" } } as unknown as Goal;
  const met = { done: 12, target: 12, pct: 100, met: true } as unknown as MeasureState;
  const ctx = { today: "2026-09-12" } as never;

  it("a project reads the setting when nobody passes one", () => {
    expect(bucketOf(row(4, 4))).toBe("moving");
    writeMirror(SETTING_DONE_CLEARING, { value: "auto", updatedAt: 1 });
    expect(bucketOf(row(4, 4))).toBe("done");
  });

  it("a met goal is on track under Ask First and done under Clear Automatically", () => {
    expect(healthOf(goal, met, undefined, ctx, 0)).toBe("on_track");
    writeMirror(SETTING_DONE_CLEARING, { value: "auto", updatedAt: 1 });
    expect(healthOf(goal, met, undefined, ctx, 0)).toBe("done");
  });

  it("a goal he marked achieved is done either way: that one is his own tap", () => {
    const achieved = { id: "g", data: { title: "G", state: "achieved" } } as unknown as Goal;
    expect(healthOf(achieved, null, undefined, ctx, 0)).toBe("done");
  });
});
