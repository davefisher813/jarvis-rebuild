import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "./TasksService";
import { NotesService } from "../notes/NotesService";
import { STEPS, TODAY, addDays, type Ctx } from "./tasksSpec";
import { groupFor, urgencyFor, todayISO } from "./grouping";
import type { TaskData } from "../notes/types";

describe("Tasks behavior contract (approved harness)", () => {
  const store = new Store(new InMemoryAdapter());
  const tasks = new TasksService(store, "user1");
  const notes = new NotesService(store, "user1");
  const ctx: Ctx = { ids: {} };

  for (const step of STEPS) {
    it(`[${step.kind}] ${step.label}`, async () => {
      const r = await step.run(tasks, notes, ctx);
      expect(r.ok, r.msg).toBe(true);
    });
  }
});

describe("grouping logic", () => {
  const mk = (over: Partial<TaskData>): TaskData => ({ text: "x", category: "brain", done: false, ...over });

  it("done tasks group as done regardless of due date", () => {
    expect(groupFor(mk({ done: true, due: TODAY }), TODAY)).toBe("done");
  });
  it("no due date groups as upcoming with no urgency", () => {
    const t = mk({});
    expect(groupFor(t, TODAY)).toBe("upcoming");
    expect(urgencyFor(t, TODAY)).toBeNull();
  });
  it("due today groups as today with a TODAY tag", () => {
    const t = mk({ due: TODAY });
    expect(groupFor(t, TODAY)).toBe("today");
    expect(urgencyFor(t, TODAY)).toEqual({ label: "TODAY", kind: "today" });
  });
  it("overdue groups as today with an OVERDUE tag", () => {
    const t = mk({ due: addDays(TODAY, -2) });
    expect(groupFor(t, TODAY)).toBe("today");
    expect(urgencyFor(t, TODAY)?.kind).toBe("overdue");
  });
  it("within a week shows a weekday tag", () => {
    expect(urgencyFor(mk({ due: addDays(TODAY, 3) }), TODAY)).toEqual({ label: "TUE", kind: "soon" });
  });
  it("further out shows a month-day tag", () => {
    expect(urgencyFor(mk({ due: addDays(TODAY, 20) }), TODAY)).toEqual({ label: "JUN 12", kind: "soon" });
  });
  it("todayISO formats as YYYY-MM-DD", () => {
    expect(todayISO(new Date("2026-05-23T15:00:00"))).toBe("2026-05-23");
  });
});

import { partition, filterOf } from "./filters";

describe("filter partitioning (chips)", () => {
  const mk = (over: Partial<TaskData>): TaskData => ({ text: "x", category: "brain", done: false, ...over });
  it("splits overdue out of today", () => {
    expect(filterOf(mk({ due: TODAY }), TODAY)).toBe("today");
    expect(filterOf(mk({ due: addDays(TODAY, -1) }), TODAY)).toBe("overdue");
    expect(filterOf(mk({ due: addDays(TODAY, 5) }), TODAY)).toBe("upcoming");
    expect(filterOf(mk({}), TODAY)).toBe("upcoming");
    expect(filterOf(mk({ done: true, due: TODAY }), TODAY)).toBe("done");
  });
  it("partition counts each chip", () => {
    const items = [
      { id: "1", data: mk({ due: TODAY }) },
      { id: "2", data: mk({ due: addDays(TODAY, -1) }) },
      { id: "3", data: mk({ due: addDays(TODAY, 3) }) },
      { id: "4", data: mk({}) },
      { id: "5", data: mk({ done: true }) },
    ];
    const p = partition(items, TODAY);
    expect(p.today.length).toBe(1);
    expect(p.overdue.length).toBe(1);
    expect(p.upcoming.length).toBe(2);
    expect(p.done.length).toBe(1);
  });
});
