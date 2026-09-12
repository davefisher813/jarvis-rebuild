import { describe, it, expect } from "vitest";
import { projectProgress, isStalled, rankProjects, progressLabel, lastActivity, STALE_DAYS,
  bucketOf, closable, rankGoals, projectPace } from "./progress";
import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";

const NOW = new Date("2026-08-02T12:00:00Z").getTime();
const daysAgo = (n: number) => NOW - n * 86400000;

function task(id: string, projectId?: string, done = false): TaskItem {
  return { id, data: { text: id, category: "", done, ...(projectId ? { projectId } : {}) } };
}
function proj(id: string, over: Partial<Project["data"]> = {}): Project {
  return { id, data: { title: id, status: "active", ...over } };
}

describe("projectProgress", () => {
  it("counts only its own tasks", () => {
    const tasks = [task("a", "p1", true), task("b", "p1"), task("c", "p2", true), task("d")];
    expect(projectProgress(tasks, "p1")).toEqual({ done: 1, total: 2, pct: 50 });
  });
  it("returns null with no tasks, never a fake zero", () => {
    expect(projectProgress([task("x")], "p1")).toBeNull();
    expect(progressLabel(null, false)).toBe("No tasks yet");
  });
});

describe("isStalled", () => {
  const tasks = [task("a", "p1", true), task("b", "p1")];
  it("fires only with evidence of real neglect", () => {
    const old = [{ id: "a", t: daysAgo(STALE_DAYS + 5) }];
    expect(isStalled(tasks, old, "p1", NOW)).toBe(true);
  });
  it("stays quiet on recent activity", () => {
    expect(isStalled(tasks, [{ id: "a", t: daysAgo(3) }], "p1", NOW)).toBe(false);
  });
  it("stays quiet when we have no evidence at all (silence is not neglect)", () => {
    expect(isStalled(tasks, [], "p1", NOW)).toBe(false);
    expect(isStalled(tasks, [{ id: "other", t: daysAgo(99) }], "p1", NOW)).toBe(false);
  });
  it("finished work is never stalled", () => {
    const allDone = [task("a", "p1", true)];
    expect(isStalled(allDone, [{ id: "a", t: daysAgo(99) }], "p1", NOW)).toBe(false);
  });
  it("ignores samples with no task id", () => {
    expect(lastActivity([{ t: daysAgo(1) }], ["a"])).toBeNull();
  });
});

describe("rankProjects", () => {
  it("puts recently touched first and sinks finished projects", () => {
    const projects = [proj("cold"), proj("hot"), proj("finished", { status: "done" })];
    const tasks = [task("t1", "cold"), task("t2", "hot")];
    const samples = [{ id: "t1", t: daysAgo(30) }, { id: "t2", t: daysAgo(1) }];
    expect(rankProjects(projects, tasks, samples, NOW).map((r) => r.project.id)).toEqual(["hot", "cold", "finished"]);
  });
});

describe("progressLabel", () => {
  it("speaks plainly and flags a stall only when told to", () => {
    expect(progressLabel({ done: 3, total: 7, pct: 43 }, false)).toBe("3 of 7 Done");
    expect(progressLabel({ done: 3, total: 7, pct: 43 }, true)).toBe("3 of 7 Done · Stalled");
    expect(progressLabel({ done: 4, total: 4, pct: 100 }, false)).toBe("All 4 done");
  });
});

describe("wave 1: sections are derived, not typed", () => {
  const R = (status: string, done: number, total: number, stalled = false) => ({
    project: { id: "p", data: { title: "P", status } } as never,
    progress: total ? { done, total, pct: Math.round((done / total) * 100) } : null,
    stalled, lastAt: null,
  });

  // 2026-09-12 (Dave: "the user should be able to decide if it automatically
  // clears or needs permission"). This used to be unconditional, which is what
  // he objected to on 09-09: the app folding a project away as finished on its
  // own. Under Ask First, 23 of 23 ticked means READY, and the row keeps
  // reading On Track until someone taps Mark Done; under Clear Automatically
  // the arithmetic closes it, exactly as it did before.
  it("a project whose tasks are all done closes itself only when he asked it to", () => {
    expect(bucketOf(R("active", 23, 23), true)).toBe("done");
    expect(bucketOf(R("active", 23, 23), false)).toBe("moving");
    // Closed by hand is Done under either setting: that one is his own mark.
    expect(bucketOf(R("done", 23, 23), false)).toBe("done");
    expect(bucketOf(R("done", 2, 23), false)).toBe("done");
  });

  it("a project with no tasks has not started, it is not moving", () => {
    expect(bucketOf(R("active", 0, 0))).toBe("unstarted");
  });

  it("a stalled project is never filed under Moving", () => {
    expect(bucketOf(R("active", 1, 3, true))).toBe("stalled");
  });

  it("real work in progress is Moving", () => {
    expect(bucketOf(R("active", 1, 3))).toBe("moving");
  });

  it("a closed project stays Done whatever its tasks say", () => {
    expect(bucketOf(R("done", 0, 3))).toBe("done");
  });

  // Pick 6: the offer only appears where it is true, which is the exact
  // inverse of what shipped (loud on an unfinished project, silent on a
  // finished one).
  it("offers to close only when the work is finished and the project is not", () => {
    expect(closable(R("active", 23, 23))).toBe(true);
    expect(closable(R("done", 23, 23))).toBe(false);
    expect(closable(R("active", 1, 3))).toBe(false);
    expect(closable(R("active", 0, 0))).toBe(false);
  });
});

describe("wave 1: goals order by what is true", () => {
  const G = (id: string, done: number | null, total = 0) => ({
    id, progress: done === null ? null : { done, total, pct: Math.round((done / total) * 100) },
  });

  it("nearest to finishing leads", () => {
    const out = rankGoals([G("far", 1, 10), G("near", 8, 10)]).map((g) => g.id);
    expect(out).toEqual(["near", "far"]);
  });

  it("a finished goal sinks below live work", () => {
    const out = rankGoals([G("done", 5, 5), G("live", 1, 10)]).map((g) => g.id);
    expect(out).toEqual(["live", "done"]);
  });

  it("goals with nothing to measure sit between live and finished", () => {
    const out = rankGoals([G("done", 5, 5), G("empty", null), G("live", 1, 10)]).map((g) => g.id);
    expect(out).toEqual(["live", "empty", "done"]);
  });

  it("never sorts by title, which is what put B first", () => {
    const out = rankGoals([G("Zebra", 9, 10), G("Apple", 1, 10)]).map((g) => g.id);
    expect(out).toEqual(["Zebra", "Apple"]);
  });
});

// UP-CORE-18 (2026-09-05): a school project due Friday and a client
// deliverable due the 30th are the same shape, and a project could hold a
// status, an order, a goal and a hold date and no deadline at all. The
// arithmetic is the one goals have had since PICK 14 (measure.ts's paceLine).
describe("projectPace", () => {
  const p = (done: number, total: number) => ({ done, total, pct: Math.round((done / total) * 100) });

  it("says what is left and whether the pace is real", () => {
    // 6 left over 3 days: two a day from here. The rate leads with a word,
    // the same trick paceLine uses to keep the number-lead casing readable.
    expect(projectPace(p(2, 8), "2026-09-08", "2026-09-05")).toBe("6 of 8 Left · About 2 a day from here");
    // Fewer left than days: one a day is more than enough, so it says when.
    expect(projectPace(p(5, 8), "2026-09-15", "2026-09-05")).toBe("3 of 8 Left · Due in 10 days");
  });

  it("says today, tomorrow and past in words", () => {
    expect(projectPace(p(7, 8), "2026-09-05", "2026-09-05")).toBe("1 of 8 Left · Due today");
    expect(projectPace(p(7, 8), "2026-09-06", "2026-09-05")).toBe("1 of 8 Left · Due tomorrow");
    expect(projectPace(p(7, 8), "2026-09-01", "2026-09-05")).toBe("1 of 8 Left · Past its date");
  });

  it("says nothing when there is nothing to pace", () => {
    expect(projectPace(p(2, 8), undefined, "2026-09-05")).toBeNull();
    expect(projectPace(null, "2026-09-08", "2026-09-05")).toBeNull();
    // Finished: a pace for work that is done is a number about nothing.
    expect(projectPace(p(8, 8), "2026-09-08", "2026-09-05")).toBeNull();
  });
});
