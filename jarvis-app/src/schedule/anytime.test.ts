import { describe, it, expect } from "vitest";
import { anytimeTasksForDay } from "./anytime";
import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "./types";

const DAY = "2026-07-30";

function task(id: string, over: Partial<TaskItem["data"]> = {}): TaskItem {
  return { id, data: { text: id, category: "", done: false, ...over } };
}
function evt(id: string, over: Partial<EventItem["data"]> = {}): EventItem {
  return { id, data: { title: id, date: DAY, start: "10:00", category: "", ...over } };
}

describe("anytimeTasksForDay", () => {
  it("includes undated open tasks and tasks due on/before the day", () => {
    const tasks = [
      task("undated"),
      task("dueToday", { due: DAY }),
      task("overdue", { due: "2026-07-01" }),
      task("future", { due: "2026-08-15" }),
    ];
    const ids = anytimeTasksForDay(tasks, [], DAY).map((t) => t.id);
    expect(ids).toContain("undated");
    expect(ids).toContain("dueToday");
    expect(ids).toContain("overdue");
    expect(ids).not.toContain("future");
  });

  it("excludes done tasks and tasks already given a time that day", () => {
    const tasks = [task("open"), task("done", { done: true }), task("scheduled")];
    const events = [evt("e1", { sourceTaskId: "scheduled" })];
    const ids = anytimeTasksForDay(tasks, events, DAY).map((t) => t.id);
    expect(ids).toEqual(["open"]);
  });

  it("sorts soonest due first, undated last", () => {
    const tasks = [
      task("undated"),
      task("later", { due: "2026-07-29" }),
      task("earlier", { due: "2026-07-10" }),
    ];
    const ids = anytimeTasksForDay(tasks, [], DAY).map((t) => t.id);
    expect(ids).toEqual(["earlier", "later", "undated"]);
  });

  it("is empty when nothing qualifies", () => {
    const tasks = [task("done", { done: true }), task("future", { due: "2030-01-01" })];
    expect(anytimeTasksForDay(tasks, [], DAY)).toHaveLength(0);
  });
});

// NO REPETITION ON ANY PAGE (blend phase 3, 2026-08-22). A proposal has no
// event yet, so without the claimed set a proposed task drew as a dashed row
// in the day AND again in the Anytime strip above it.
describe("a proposed task leaves the Anytime strip", () => {
  const t = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, data: { text: id, done: false, ...over } }) as never;

  it("a task the proposal holds is not offered as Anytime as well", () => {
    const out = anytimeTasksForDay([t("t1"), t("t2")], [], "2026-08-22", new Set(["t1"]));
    expect(out.map((x) => x.id)).toEqual(["t2"]);
  });

  it("[edge] no proposal standing: nothing is withheld", () => {
    const out = anytimeTasksForDay([t("t1"), t("t2")], [], "2026-08-22");
    expect(out.map((x) => x.id).sort()).toEqual(["t1", "t2"]);
  });

  it("committed work is still excluded by its own event, as before", () => {
    const ev = { id: "e1", data: { title: "x", start: "09:00", sourceTaskId: "t1" } } as never;
    const out = anytimeTasksForDay([t("t1"), t("t2")], [ev], "2026-08-22");
    expect(out.map((x) => x.id)).toEqual(["t2"]);
  });
});
