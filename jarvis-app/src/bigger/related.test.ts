import { describe, it, expect } from "vitest";
import { distinctiveTokens, relatedProjectsForGoal, nextActionOf, isLinkDismissed, dismissLink, type DismissStorage } from "./related";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import type { TaskItem } from "../tasks/TasksService";

// The matcher only earns its place if it is NARROW: it may only speak when
// the user's own naming makes the link obvious, and a dismissed pair must
// never come back. These pin the gate, the ranking, and the memory.

const goal = (id: string, title: string): Goal => ({ id, data: { title, state: "on_track" } });
const proj = (id: string, title: string, goalId?: string): Project =>
  ({ id, data: { title, status: "active", goalId } }) as Project;
const task = (id: string, projectId: string, done = false, due?: string): TaskItem =>
  ({ id, data: { text: "task " + id, done, projectId, due } }) as TaskItem;

function memStorage(): DismissStorage {
  let v: string | null = null;
  return { read: () => v, write: (x) => { v = x; } };
}

describe("distinctiveTokens", () => {
  it("keeps only words that can actually connect things", () => {
    expect(distinctiveTokens("Lock in 5 Bridge Partnerships")).toEqual(new Set(["lock", "bridge", "partnerships"]));
    // stopwords, short words, and bare numbers all drop
    expect(distinctiveTokens("Make a plan to get more work")).toEqual(new Set([]));
    expect(distinctiveTokens("2026 12 999")).toEqual(new Set([]));
  });
});

describe("relatedProjectsForGoal", () => {
  const g = goal("g1", "Lock in 5 Bridge Partnerships");

  it("finds unlinked projects sharing a distinctive word, strongest first", () => {
    const hits = relatedProjectsForGoal(g, [
      proj("p1", "Bridge Golf Event"),
      proj("p2", "Bridge Partnerships Dinner"),
      proj("p3", "Couch to 5k"),
    ]);
    expect(hits.map((p) => p.id)).toEqual(["p2", "p1"]); // p2 shares two words
  });

  it("never suggests already-linked projects, and silence beats a stretch", () => {
    expect(relatedProjectsForGoal(g, [proj("p1", "Bridge Golf Event", "g1")])).toHaveLength(0);
    // semantically related, zero shared tokens: the matcher must stay silent
    expect(relatedProjectsForGoal(goal("g2", "Lose 20 pounds"), [proj("p4", "Couch to 5k")])).toHaveLength(0);
    // a goal made entirely of stopwords can never match anything
    expect(relatedProjectsForGoal(goal("g3", "Get more work"), [proj("p5", "Work Trip")])).toHaveLength(0);
  });
});

describe("nextActionOf", () => {
  it("returns the earliest-due open task; undated after dated; done excluded", () => {
    const tasks = [
      task("a", "p1", true, "2026-08-01"), // done: never the next action
      task("b", "p1", false), // undated
      task("c", "p1", false, "2026-08-05"),
      task("d", "p1", false, "2026-08-02"),
      task("e", "other", false, "2026-01-01"), // different project
    ];
    expect(nextActionOf(tasks, "p1")?.id).toBe("d");
    expect(nextActionOf(tasks, "empty")).toBeNull();
    expect(nextActionOf([task("z", "p2", false)], "p2")?.id).toBe("z");
  });
});

describe("dismissal memory", () => {
  it("a dismissed pair NEVER comes back, and other pairs are untouched", () => {
    const storage = memStorage();
    expect(isLinkDismissed("g1", "p1", storage)).toBe(false);
    dismissLink("g1", "p1", storage);
    expect(isLinkDismissed("g1", "p1", storage)).toBe(true);
    expect(isLinkDismissed("g1", "p2", storage)).toBe(false);
    expect(isLinkDismissed("g2", "p1", storage)).toBe(false);
    dismissLink("g1", "p1", storage); // idempotent
    expect(isLinkDismissed("g1", "p1", storage)).toBe(true);
  });
});
