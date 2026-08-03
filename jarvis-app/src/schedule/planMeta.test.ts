import { describe, it, expect } from "vitest";
import { goalTitleOf, workWindowOf } from "./planMeta";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import type { Category } from "../categories/types";

const projects = [
  { id: "p1", data: { title: "Golf", status: "active", goalId: "g1" } },
  { id: "p2", data: { title: "Loose", status: "active" } },
] as Project[];
const goals = [{ id: "g1", data: { title: "Bridge Partnerships", state: "on_track" } }] as Goal[];
const cats = [
  { id: "work", data: { name: "Work", color: "blue", order: 0, kind: "org", workHours: true } },
  { id: "home", data: { name: "Personal", color: "sky", order: 1 } },
] as Category[];
const routine = { workStartMin: 9 * 60, workEndMin: 17 * 60 };

describe("goalTitleOf", () => {
  it("follows task -> project -> goal, and stays silent off the chain", () => {
    expect(goalTitleOf(projects, goals, "p1")).toBe("Bridge Partnerships");
    expect(goalTitleOf(projects, goals, "p2")).toBeNull(); // project without a goal
    expect(goalTitleOf(projects, goals, "missing")).toBeNull();
    expect(goalTitleOf(projects, goals, undefined)).toBeNull();
  });
});

describe("workWindowOf", () => {
  it("pins work-hours categories to the routine window, nothing else", () => {
    expect(workWindowOf(cats, "work", routine)).toEqual({ s: 540, e: 1020 });
    expect(workWindowOf(cats, "home", routine)).toBeNull();
    expect(workWindowOf(cats, "", routine)).toBeNull();
    expect(workWindowOf(cats, "work", null)).toBeNull();
    // a degenerate routine window is ignored rather than trusted
    expect(workWindowOf(cats, "work", { workStartMin: 600, workEndMin: 600 })).toBeNull();
  });
});
