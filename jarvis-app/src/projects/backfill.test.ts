import { describe, it, expect } from "vitest";
import { normalizeProject, needsRepair, areaFromTasks, DEFAULT_STATUS } from "./backfill";
import type { ProjectData } from "./types";

const P = (d: Partial<ProjectData>) => d as ProjectData;

describe("older projects, repaired on read", () => {
  // The worst case was never a missing feature. It was a crash:
  // PROJECT_META[undefined].cls white-screened the detail page, with no way
  // back in to fix the record.
  it("gives a statusless project a status", () => {
    expect(normalizeProject(P({ title: "Old One" })).status).toBe(DEFAULT_STATUS);
  });

  it("rejects a status that is not one of ours", () => {
    expect(normalizeProject(P({ title: "X", status: "archived" as never })).status).toBe(DEFAULT_STATUS);
  });

  it("gives it a real order instead of sorting by NaN", () => {
    expect(normalizeProject(P({ title: "X", status: "active" }), 4).order).toBe(4);
  });

  it("collapses empty strings to absent, so one shape reaches every conditional", () => {
    const out = normalizeProject(P({ title: "X", status: "active", order: 0, category: "", goalId: "" }));
    expect("category" in out).toBe(false);
    expect("goalId" in out).toBe(false);
  });

  it("never touches a record that is already right", () => {
    const good = P({ title: "Fine", status: "active", order: 2 });
    expect(normalizeProject(good, 2)).toBe(good);
    expect(needsRepair(good, 2)).toBe(false);
  });

  // An Area JARVIS chose and never mentioned is worse than no Area.
  it("never invents an Area or a Goal", () => {
    const out = normalizeProject(P({ title: "X", status: "active", order: 0 }));
    expect(out.category).toBeUndefined();
    expect(out.goalId).toBeUndefined();
  });
});

describe("the Area its own steps agree on", () => {
  it("reads a clear majority", () => {
    expect(areaFromTasks([{ category: "work" }, { category: "work" }, { category: "home" }])).toBe("work");
  });

  it("refuses a tie", () => {
    expect(areaFromTasks([{ category: "work" }, { category: "home" }])).toBeNull();
  });

  it("refuses a plurality that is not a majority", () => {
    expect(areaFromTasks([
      { category: "work" }, { category: "work" },
      { category: "home" }, { category: "money" },
    ])).toBeNull();
  });

  it("one task is not a pattern", () => {
    expect(areaFromTasks([{ category: "work" }])).toBeNull();
  });

  it("ignores steps with no category at all", () => {
    expect(areaFromTasks([{ category: "work" }, { category: "work" }, {}, { category: "" }])).toBe("work");
  });
});
