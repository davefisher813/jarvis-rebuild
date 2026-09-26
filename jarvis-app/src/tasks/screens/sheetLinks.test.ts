import { describe, it, expect } from "vitest";
import { sheetProjects, sheetPeople } from "./sheetLinks";
import type { Project } from "../../projects/types";
import type { Goal } from "../../life/types";
import type { Person } from "../../people/types";

const proj = (id: string, over: Partial<Project["data"]> = {}): Project => ({ id, data: { title: id, status: "active", ...over } });
const goal = (id: string, over: Partial<Goal["data"]> = {}): Goal => ({ id, data: { title: "Goal " + id, state: "on_track", ...over } });

// THE ONE BUILDER (Dave 2026-09-16 "same 5 options"; pass-off 2026-09-26).
describe("sheetProjects", () => {
  const goals = [goal("g1"), goal("done", { state: "achieved" }), goal("gone", { dropped: { on: "2026-09-01" } })];
  it("carries the area and the live goal a project climbs to", () => {
    const [p] = sheetProjects([proj("p1", { category: "work", goalId: "g1" })], goals);
    expect(p).toEqual({ id: "p1", title: "p1", category: "work", goalId: "g1", goalTitle: "Goal g1" });
  });
  it("offers no goal that is achieved, dropped or missing", () => {
    const out = sheetProjects([proj("a", { goalId: "done" }), proj("b", { goalId: "gone" }), proj("c", { goalId: "nope" }), proj("d")], goals);
    for (const p of out) { expect(p.goalId).toBeUndefined(); expect(p.goalTitle).toBeUndefined(); }
    expect(out[3]!.category).toBeUndefined();
  });
});

describe("sheetPeople", () => {
  it("is the id and the name, nothing else", () => {
    const people = [{ id: "m", data: { name: "Marco" } } as Person];
    expect(sheetPeople(people)).toEqual([{ id: "m", name: "Marco" }]);
  });
});
