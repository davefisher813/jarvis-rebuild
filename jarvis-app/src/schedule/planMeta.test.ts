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

// Candidate ranking (2026-08-09): daily tasks and goals reach the pick list.
import { isSuggested, rankCandidates } from "./planMeta";

describe("isSuggested", () => {
  it("suggests anything due today or before, exactly as before", () => {
    expect(isSuggested("2026-08-09", "2026-08-09")).toBe(true);
    expect(isSuggested("2026-08-01", "2026-08-09")).toBe(true);
    expect(isSuggested("2026-08-10", "2026-08-09")).toBe(false);
  });

  it("suggests a daily task even with no due date: rhythm is part of the day", () => {
    expect(isSuggested("", "2026-08-09", "daily")).toBe(true);
    expect(isSuggested("", "2026-08-09", "weekly")).toBe(false);
    expect(isSuggested("", "2026-08-09")).toBe(false);
  });
});

describe("rankCandidates", () => {
  it("suggested beats not, a goal beats no goal, then earliest due", () => {
    const rows = [
      { id: "later", suggested: false, goal: null, due: "2026-08-20" },
      { id: "due-nogoal", suggested: true, goal: null, due: "2026-08-08" },
      { id: "due-goal", suggested: true, goal: "Ship JARVIS", due: "2026-08-09" },
      { id: "sameday-goal", suggested: false, goal: "Get healthy", due: "" },
    ].sort(rankCandidates).map((r) => r.id);
    // A due task that moves a stated goal outranks a due task that moves
    // nothing, even with a later due date: pick order is placement priority.
    expect(rows).toEqual(["due-goal", "due-nogoal", "sameday-goal", "later"]);
  });
});
