import { describe, it, expect } from "vitest";
import { stalledCandidate, isProjStepDismissed, dismissProjStep, type DismissStore } from "./stalled";
import type { Project } from "../projects/types";
import type { TaskItem } from "../tasks/TasksService";

// The stalled-project offer: active + nothing open = stuck by definition.
// One at a time; a dismissal stays quiet for 7 days.

const T = "2026-08-03";
const proj = (id: string, status: "active" | "on_hold" | "done" = "active"): Project =>
  ({ id, data: { title: "P" + id, status } }) as Project;
const task = (projectId: string, done = false): TaskItem =>
  ({ id: "t" + projectId + (done ? "d" : "o"), data: { text: "x", category: "", done, projectId } }) as TaskItem;

function mem(): DismissStore {
  let v: string | null = null;
  return { read: () => v, write: (x) => { v = x; } };
}

describe("stalledCandidate", () => {
  it("offers only on active projects with nothing open under them", () => {
    const s = mem();
    expect(stalledCandidate([proj("a")], [], T, s)!.id).toBe("a"); // no tasks at all
    expect(stalledCandidate([proj("a")], [task("a", true)], T, s)!.id).toBe("a"); // only done work
    expect(stalledCandidate([proj("a")], [task("a")], T, s)).toBeNull(); // has a next action
    expect(stalledCandidate([proj("a", "on_hold")], [], T, s)).toBeNull(); // on hold is deliberate
    expect(stalledCandidate([proj("a", "done")], [], T, s)).toBeNull();
  });

  it("one at a time, and dismissal quiets a project for 7 days", () => {
    const s = mem();
    const ps = [proj("a"), proj("b")];
    expect(stalledCandidate(ps, [], T, s)!.id).toBe("a");
    dismissProjStep("a", T, s);
    expect(isProjStepDismissed("a", T, s)).toBe(true);
    expect(stalledCandidate(ps, [], T, s)!.id).toBe("b"); // next stuck project steps up
    dismissProjStep("b", T, s);
    expect(stalledCandidate(ps, [], T, s)).toBeNull();
    // 7 days later the offer may return
    expect(isProjStepDismissed("a", "2026-08-10", s)).toBe(false);
    expect(stalledCandidate(ps, [], "2026-08-10", s)!.id).toBe("a");
  });
});
