import { describe, it, expect } from "vitest";
import { measureState, healthOf, nextMilestone, type MeasureContext, type Measure } from "./measure";
import { checkinText, readCheckin } from "./checkin";
import type { GoalReach } from "./reach";
import type { Goal } from "../life/types";

// C-36 and C-37 (Astra, 2026-09-12).
const NOW = new Date("2026-09-12T12:00:00").getTime();
const TODAY = "2026-09-12";
function ctx(over: Partial<MeasureContext> = {}): MeasureContext {
  const reach: GoalReach = { filedIds: [], taggedIds: [], openTagged: 0, progress: null };
  return { reach, tasks: [], projects: [], samples: [], today: TODAY, now: NOW, ...over };
}
const goal = (over: Partial<Goal["data"]> = {}): Goal => ({ id: "g", data: { title: "Make apartment aesthetic", state: "on_track", ...over } });

describe("the milestones measure (C-36)", () => {
  const m: Measure = { kind: "milestones", items: [
    { id: "a", text: "Pick a paint color", done: "2026-09-01" },
    { id: "b", text: "New couch", done: "2026-09-05" },
    { id: "c", text: "Finish bedroom" },
    { id: "d", text: "Hang art in hallway" },
  ] };

  it("progress is done of total, and the line says so in counts", () => {
    const s = measureState(m, ctx())!;
    expect(s).toMatchObject({ done: 2, target: 4, met: false, pct: 50 });
    expect(s.line).toBe("2 of 4 Milestones");
    expect(measureState({ kind: "milestones", items: [] }, ctx())!.line).toBe("No milestones yet");
  });

  it("the next milestone is the first not yet ticked", () => {
    expect(nextMilestone(m)?.text).toBe("Finish bedroom");
    expect(nextMilestone({ kind: "milestones", items: [{ id: "a", text: "x", done: "2026-09-01" }] })).toBeNull();
    expect(nextMilestone({ kind: "count", target: 3 })).toBeNull();
  });

  it("health: on track while ticking, behind only once the date has passed", () => {
    const s = measureState(m, ctx())!;
    expect(healthOf(goal({ measure: m, by: "2026-10-15" }), s, m, ctx(), 0, false)).toBe("on_track");
    expect(healthOf(goal({ measure: m, by: "2026-09-01" }), s, m, ctx(), 0, false)).toBe("behind");
    const all: Measure = { kind: "milestones", items: m.items.map((i) => ({ ...i, done: i.done ?? TODAY })) };
    expect(healthOf(goal({ measure: all }), measureState(all, ctx()), all, ctx(), 0, false)).toBe("on_track");
  });
});

describe("the check-in strand (C-37)", () => {
  it("round-trips the word and the day through the strand text", () => {
    const t = checkinText("Build massive recruiting network", "on_track", "2026-09-03");
    expect(t).toBe("Build massive recruiting network: On Track as of 2026-09-03");
    expect(readCheckin(t)).toEqual({ word: "on_track", on: "2026-09-03" });
    expect(readCheckin("Gets things done mid morning")).toBeNull();
  });
});
